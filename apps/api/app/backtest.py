"""Long-only fractional index portfolio, signals on close, fills next open."""
from decimal import Decimal
from .indicators import sma, ema, rsi

def simulate(bars, strategy, capital, fee, slippage, start, end):
    capital=Decimal(str(capital));fee=Decimal(str(fee))/100;slippage=Decimal(str(slippage))/100
    cash=capital;qty=Decimal(0);pending=None;peak=capital;equity=[];trades=[];total_fees=Decimal(0)
    closes=[float(b['close']) for b in bars]
    typ=strategy['type'];f=(ema if typ=='EMA' else sma)(closes,strategy['fast']);s=(ema if typ=='EMA' else sma)(closes,strategy['slow']);rs=rsi(closes,strategy['fast'])
    benchmark_start=None;max_dd=Decimal(0)
    for i,b in enumerate(bars):
        in_range=start<=b['session_date']<=end
        if not in_range:continue
        op=Decimal(str(b['open']));close=Decimal(str(b['close']))
        if benchmark_start is None:benchmark_start=op
        if pending=='buy' and qty==0:
            price=op*(1+slippage);qty=cash/(price*(1+fee));cost=qty*price;commission=cost*fee;cash-=cost+commission;total_fees+=commission
            trades.append({'time':b['time'],'side':'buy','price':str(price),'quantity':str(qty),'fee':str(commission)})
        elif pending=='sell' and qty>0:
            price=op*(1-slippage);proceeds=qty*price;commission=proceeds*fee;cash+=proceeds-commission;total_fees+=commission
            trades.append({'time':b['time'],'side':'sell','price':str(price),'quantity':str(qty),'fee':str(commission)});qty=Decimal(0)
        pending=None
        value=cash+qty*close;peak=max(peak,value);dd=(peak-value)/peak*100;max_dd=max(max_dd,dd)
        equity.append({'time':b['time'],'equity':str(value),'benchmark':str(capital*close/benchmark_start),'drawdown':float(dd)})
        if not b.get('is_final',True):continue
        if typ=='RSI' and rs[i] is not None:
            if rs[i]<strategy['lower'] and qty==0:pending='buy'
            elif rs[i]>strategy['upper'] and qty>0:pending='sell'
        elif typ in ('MA','EMA') and i>0 and s[i] is not None and s[i-1] is not None:
            if f[i]>s[i] and f[i-1]<=s[i-1] and qty==0:pending='buy'
            elif f[i]<s[i] and f[i-1]>=s[i-1] and qty>0:pending='sell'
    if len(equity)<2:raise ValueError('有效样本不足，无法计算回测')
    return {'metrics':{'total_return':float((Decimal(equity[-1]['equity'])/capital-1)*100),'benchmark_return':float((Decimal(equity[-1]['benchmark'])/capital-1)*100),'max_drawdown':float(max_dd),'trade_count':len(trades),'total_fees':str(total_fees)},'equity':equity,'trades':trades,'unrealized_quantity':str(qty),'warnings':['指数点位理论组合，允许分数份额；非 ETF 成交回测','末期持仓按收盘估值，不强制卖出']+(['区间内没有成交'] if not trades else [])}
