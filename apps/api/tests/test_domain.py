from datetime import date,datetime,timedelta,timezone
from decimal import Decimal
import pytest
from pydantic import ValidationError
from app.schemas import StrategyInput,TradeInput
from app.indicators import sma,ema,rsi,calculate
from app.backtest import simulate
from app import market

def fixture_bars(values):
    return [dict(time=1700000000+i*86400,session_date=(date(2024,1,1)+timedelta(days=i)).isoformat(),open=str(v+1),close=str(v),high=str(v+2),low=str(v-1),volume=None,is_final=True) for i,v in enumerate(values)]

def test_indicator_warmup_and_wilder():
    assert sma([1,2,3,4],3)==[None,None,2,3]
    assert ema([1,2,3,4],3)==[None,None,2,3]
    assert rsi([1]*20)[14]==50
    assert rsi(list(range(20)))[14]==100
    assert set(calculate(fixture_bars(list(range(1,70)))))>={'MA20','MACD','RSI','K','D','J'}
    selected=market.selected_indicators(fixture_bars(list(range(1,70))),['MA','RSI'])
    assert set(selected)=={'MA20','MA60','RSI'}

def test_validation():
    with pytest.raises(ValidationError):StrategyInput(name='x',type='MA',fast=60,slow=20)
    with pytest.raises(ValidationError):TradeInput(idempotency_key='12345678',ticker='510300',side='buy',quantity='NaN',price='1')
    with pytest.raises(ValidationError):StrategyInput(name='x',type='python')

def test_next_open_and_no_future():
    bars=fixture_bars([8,7,6,5,8,10,11,5,4,3])
    strategy=StrategyInput(name='test',type='MA',fast=2,slow=3).model_dump()
    result=simulate(bars,strategy,'1000','0.1','0.2','2024-01-01','2024-01-10')
    assert result['trades'][0]['time']==bars[5]['time']
    assert Decimal(result['trades'][0]['price'])==Decimal(bars[5]['open'])*Decimal('1.002')
    prefix=simulate(bars[:7],strategy,'1000','0.1','0.2','2024-01-01','2024-01-10')
    assert prefix['equity']==result['equity'][:7]
    assert Decimal(result['metrics']['total_fees'])>0

def test_unfinished_signal_not_executed():
    bars=fixture_bars([8,7,6,5,8,10,11]);bars[4]['is_final']=False
    strategy=StrategyInput(name='test',type='MA',fast=2,slow=3).model_dump()
    assert simulate(bars,strategy,1000,0,0,'2024-01-01','2024-01-10')['trades']==[]

def test_tencent_daily_and_minute_payloads(monkeypatch):
    class Response:
        def __init__(self,payload):self.payload=payload
        def raise_for_status(self):return None
        def json(self):return self.payload
    daily={'data':{'sh000300':{'day':[['2026-09-11','10','11','12','9','100'],['2026-09-12','11','12','13','10','120']]}}}
    minute={'data':{'sh000300':{'data':{'date':'20260912','data':['0930 11.00 100 1000','0931 11.20 160 1700']}}}}
    market._TENCENT_HISTORY_CACHE.clear()
    monkeypatch.setattr(market.httpx,'get',lambda url,**kwargs:Response(minute if 'minute/query' in url else daily))
    fetched=datetime(2026,9,13,tzinfo=timezone.utc)
    bars=market.tencent_bars('csi300','day',date(2026,9,11),date(2026,9,12),fetched)
    assert len(bars)==2 and bars[0]['open']=='10' and bars[-1]['close']=='12' and bars[-1]['volume']==120
    intraday=market.tencent_bars('csi300','minute',None,None,fetched)
    assert len(intraday)==2 and intraday[-1]['close']=='11.2' and intraday[-1]['volume']==60

def test_nasdaq_history_uses_unambiguous_ixic_symbol(monkeypatch):
    class Response:
        def raise_for_status(self):return None
        def json(self):
            return {'chart':{'result':[{
                'timestamp':[1726234200,1726493400],
                'indicators':{'quote':[{
                    'open':[17600.0,17650.0],'close':[17683.98,17628.06],
                    'high':[17700.0,17700.0],'low':[17500.0,17550.0],
                    'volume':[5100000000,4900000000],
                }]},
            }],'error':None}}
    def fake_get(url,**kwargs):
        calls.append(url)
        assert '%5EIXIC' in url
        assert kwargs['params']['interval']=='1d'
        return Response()
    calls=[]
    market._NASDAQ_HISTORY_CACHE.clear()
    monkeypatch.setattr(market.httpx,'get',fake_get)
    fetched=datetime(2024,9,18,tzinfo=timezone.utc)
    bars=market.yahoo_nasdaq_history(date(2024,9,1),date(2024,9,30),fetched)
    cached=market.yahoo_nasdaq_history(date(2024,9,1),date(2024,9,30),fetched)
    assert [bar['session_date'] for bar in bars]==['2024-09-13','2024-09-16']
    assert bars[-1]['close']=='17628.06'
    assert bars[-1]['volume']==4900000000
    assert cached==bars and len(calls)==1
