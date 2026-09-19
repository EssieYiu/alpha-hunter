import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select
from .models import Account,Position,Ledger,Strategy,StrategyVersion,Backtest
from .schemas import StrategyInput,CodeStrategyInput,BacktestInput
from .catalog import PRODUCTS
from .market import get_bars
from .backtest import simulate
from .code_strategy import run_signals,CodeStrategyError

def strategy_dict(row):return {'id':row.id,'version':row.version,**row.config}
def list_strategies(db):return [strategy_dict(r) for r in db.scalars(select(Strategy))]
def create_strategy(db,payload:StrategyInput):
    row=Strategy(config=payload.model_dump(mode='json'));db.add(row);db.flush()
    db.add(StrategyVersion(id=f'{row.id}:{row.version}',snapshot=strategy_dict(row)));db.commit();return strategy_dict(row)
def create_code_strategy(db,payload:CodeStrategyInput):
    row=Strategy(config=payload.model_dump(mode='json'));db.add(row);db.flush()
    db.add(StrategyVersion(id=f'{row.id}:{row.version}',snapshot=strategy_dict(row)));db.commit();return strategy_dict(row)
def update_strategy(db,id,payload):
    row=db.scalar(select(Strategy).where(Strategy.id==id).with_for_update())
    if not row:raise HTTPException(404,'策略不存在')
    if row.config.get('type')=='CODE':raise HTTPException(422,'代码策略请使用代码策略接口编辑')
    row.version+=1;row.config=payload.model_dump(mode='json');db.add(StrategyVersion(id=f'{id}:{row.version}',snapshot=strategy_dict(row)));db.commit();return strategy_dict(row)

def update_code_strategy(db,id,payload:CodeStrategyInput):
    row=db.scalar(select(Strategy).where(Strategy.id==id).with_for_update())
    if not row:raise HTTPException(404,'策略不存在')
    if row.config.get('type')!='CODE':raise HTTPException(422,'模板策略请使用模板策略接口编辑')
    row.version+=1;row.config=payload.model_dump(mode='json')
    db.add(StrategyVersion(id=f'{id}:{row.version}',snapshot=strategy_dict(row)));db.commit();return strategy_dict(row)

def get_account(db):
    row=db.get(Account,1)
    if row is None:raise HTTPException(503,'账户未初始化，请运行数据库迁移')
    return {'cash':str(row.cash),'currency':'CNY','positions':[{'ticker':p.ticker,'quantity':str(p.quantity),'cost':str(p.cost)} for p in db.scalars(select(Position)) if p.quantity>0],'ledger':[{'id':r.id,**r.payload,'created_at':r.created_at.isoformat()} for r in db.scalars(select(Ledger).order_by(Ledger.created_at.desc()).limit(500))]}

def execute_trade(db,payload):
    if payload.ticker not in PRODUCTS:raise HTTPException(422,'仅支持目录内人民币 ETF 模拟记账')
    account=db.scalar(select(Account).where(Account.id==1).with_for_update())
    if account is None:raise HTTPException(503,'账户尚未初始化')
    body=payload.model_dump(mode='json');prior=db.scalar(select(Ledger).where(Ledger.idempotency_key==payload.idempotency_key))
    if prior:
        if prior.payload!=body:raise HTTPException(409,'幂等键已用于不同交易')
        return get_account(db)
    position=db.get(Position,payload.ticker)
    if position is None:position=Position(ticker=payload.ticker,quantity=Decimal(0),cost=Decimal(0));db.add(position)
    amount=payload.quantity*payload.price
    if payload.side=='buy':
        if account.cash<amount+payload.fee:raise HTTPException(422,'可用现金不足')
        position.cost=(position.cost*position.quantity+amount+payload.fee)/(position.quantity+payload.quantity)
        position.quantity+=payload.quantity;account.cash-=amount+payload.fee
    else:
        if position.quantity<payload.quantity:raise HTTPException(422,'持仓不足，不能超卖')
        if account.cash+amount<payload.fee:raise HTTPException(422,'现金不足以支付费用')
        position.quantity-=payload.quantity;account.cash+=amount-payload.fee
        if position.quantity==0:position.cost=Decimal(0)
    db.add(Ledger(idempotency_key=payload.idempotency_key,payload=body));db.commit();return get_account(db)

def adjust_position(db,payload):
    if payload.ticker not in PRODUCTS:raise HTTPException(422,'仅支持目录内人民币 ETF')
    db.scalar(select(Account).where(Account.id==1).with_for_update())
    position=db.get(Position,payload.ticker)
    old={'quantity':str(position.quantity),'cost':str(position.cost)} if position else {'quantity':'0','cost':'0'}
    if position is None:position=Position(ticker=payload.ticker);db.add(position)
    position.quantity=payload.quantity;position.cost=payload.cost if payload.quantity else Decimal(0)
    db.add(Ledger(idempotency_key=str(uuid4()),payload={**payload.model_dump(mode='json'),'side':'adjust','price':str(payload.cost),'fee':'0','previous':old}));db.commit();return get_account(db)

def get_backtest(db,id):
    row=db.get(Backtest,id)
    if not row:raise HTTPException(404,'回测不存在')
    return {'id':row.id,'status':row.status,'result':row.result}

def completed_backtest_bars(bars,period,end):
    if period=='day':return bars,False
    end_label=end.isoformat()
    # An observed next period proves the preceding weekly/monthly bar closed.
    # The first period might be truncated by the warmup query, while the last
    # might be truncated by the end query or missing supplier data.
    completed=[bar for bar in bars[1:-1] if bar.get('end_session_date',bar['session_date'])<=end_label]
    uncertain_last=bool(bars and bars[-1].get('end_session_date',bars[-1]['session_date'])<=end_label)
    partial_at_end=any(bar['session_date']<=end_label<bar.get('end_session_date',bar['session_date']) for bar in bars)
    return completed,uncertain_last or partial_at_end

def run_backtest(db,payload:BacktestInput):
    strategy=db.get(Strategy,payload.strategy_id)
    if not strategy:raise HTTPException(404,'策略不存在')
    snapshot=strategy_dict(strategy)
    # Warmup uses only prior data. All points are frozen into this run.
    lookback=(snapshot['lookback'] if snapshot['type']=='CODE' else
              snapshot['fast'] if snapshot['type']=='RSI' else snapshot['slow'])
    days_per_bar={'day':2,'week':9,'month':32}[snapshot['period']]
    warmup=payload.start-timedelta(days=min(7300,lookback*days_per_bar+(35 if snapshot['period']!='day' else 0)))
    market_end=min(date.today(),payload.end+timedelta(days=35)) if snapshot['period']!='day' else payload.end
    market=get_bars(payload.index_id,snapshot['period'],warmup,market_end,indicator_groups=[])
    if market['unavailable_reason']:raise HTTPException(503,market['unavailable_reason'])
    bars,excluded_end=completed_backtest_bars(market['bars'],snapshot['period'],payload.end)
    if len(bars)>6000:raise HTTPException(422,'超过同步回测6000根K线限制')
    try:
        signals=run_signals(snapshot['source'],bars) if snapshot['type']=='CODE' else None
        result=simulate(bars,snapshot,payload.capital,payload.fee,payload.slippage,payload.start.isoformat(),payload.end.isoformat(),signals=signals)
    except CodeStrategyError as e:raise HTTPException(422,str(e)) from None
    except ValueError as e:raise HTTPException(422,str(e)) from None
    if excluded_end:result['warnings'].append('区间末尾未完成或无法确认完成的周/月 K 线已排除')
    as_of=(datetime.fromtimestamp(bars[-1].get('end_time',bars[-1]['time']),timezone.utc).isoformat()
           if bars and snapshot['period']!='day' else market['as_of'])
    result.update(strategy_snapshot=snapshot,request=payload.model_dump(mode='json'),data_snapshot=bars,data_hash=hashlib.sha256(json.dumps(bars,sort_keys=True).encode()).hexdigest(),provider=market['provider'],as_of=as_of,engine_version='next-open-v2',execution='synchronous')
    row=Backtest(status='completed',result=result);db.add(row);db.commit();return get_backtest(db,row.id)
