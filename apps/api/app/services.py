import hashlib
import json
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select
from .models import Account,Position,Ledger,Strategy,StrategyVersion,Backtest
from .schemas import StrategyInput,BacktestInput
from .catalog import PRODUCTS
from .market import get_bars
from .backtest import simulate

def strategy_dict(row):return {'id':row.id,'version':row.version,**row.config}
def list_strategies(db):return [strategy_dict(r) for r in db.scalars(select(Strategy))]
def create_strategy(db,payload:StrategyInput):
    row=Strategy(config=payload.model_dump(mode='json'));db.add(row);db.flush()
    db.add(StrategyVersion(id=f'{row.id}:{row.version}',snapshot=strategy_dict(row)));db.commit();return strategy_dict(row)
def update_strategy(db,id,payload):
    row=db.scalar(select(Strategy).where(Strategy.id==id).with_for_update())
    if not row:raise HTTPException(404,'策略不存在')
    row.version+=1;row.config=payload.model_dump(mode='json');db.add(StrategyVersion(id=f'{id}:{row.version}',snapshot=strategy_dict(row)));db.commit();return strategy_dict(row)

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

def run_backtest(db,payload:BacktestInput):
    strategy=db.get(Strategy,payload.strategy_id)
    if not strategy:raise HTTPException(404,'策略不存在')
    snapshot=strategy_dict(strategy)
    # Warmup uses only prior data. All points are frozen into this run.
    warmup=payload.start-timedelta(days=min(7300,snapshot['slow']*32 if snapshot['period']=='month' else snapshot['slow']*8))
    market=get_bars(payload.index_id,snapshot['period'],warmup,payload.end,indicator_groups=[])
    if market['unavailable_reason']:raise HTTPException(503,market['unavailable_reason'])
    bars=market['bars']
    if len(bars)>6000:raise HTTPException(422,'超过同步回测6000根K线限制')
    try:result=simulate(bars,snapshot,payload.capital,payload.fee,payload.slippage,payload.start.isoformat(),payload.end.isoformat())
    except ValueError as e:raise HTTPException(422,str(e)) from None
    result.update(strategy_snapshot=snapshot,request=payload.model_dump(mode='json'),data_snapshot=bars,data_hash=hashlib.sha256(json.dumps(bars,sort_keys=True).encode()).hexdigest(),provider=market['provider'],as_of=market['as_of'],engine_version='next-open-v1',execution='synchronous')
    row=Backtest(status='completed',result=result);db.add(row);db.commit();return get_backtest(db,row.id)
