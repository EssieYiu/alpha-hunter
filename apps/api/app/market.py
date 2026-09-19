"""Eastmoney public research adapter. No synthetic or ETF proxy fallback."""
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo
from threading import Lock
from time import monotonic
import os
import httpx
from fastapi import HTTPException
from .catalog import BY_ID,TENCENT_SYMBOLS
from .indicators import calculate

_NASDAQ_HISTORY_CACHE={}
_NASDAQ_HISTORY_LOCK=Lock()
_NASDAQ_HISTORY_TTL_SECONDS=600
_YAHOO_US_SYMBOLS={'sp500':'%5EGSPC','nasdaq':'%5EIXIC','dow':'%5EDJI'}
_TENCENT_HISTORY_CACHE={}
_TENCENT_HISTORY_LOCK=Lock()
_INDICATOR_GROUPS={
    'MA':{'MA20','MA60'},'EMA':{'EMA20'},
    'BOLL':{'BOLL_MIDDLE','BOLL_UPPER','BOLL_LOWER'},
    'MACD':{'DIF','DEA','MACD'},'RSI':{'RSI'},'KDJ':{'K','D','J'},
}

def selected_indicators(bars,groups=None):
    calculated=calculate(bars)
    if groups is None:return calculated
    allowed=set().union(*(_INDICATOR_GROUPS[group] for group in groups)) if groups else set()
    return {key:value for key,value in calculated.items() if key in allowed}

def aggregate(bars,period):
    if period not in ('week','month'):return bars
    groups={}
    for b in bars:
        day=date.fromisoformat(b['session_date']);key=day.isocalendar()[:2] if period=='week' else (day.year,day.month)
        groups.setdefault(key,[]).append(b)
    out=[]
    for group in groups.values():
        out.append({**group[0],'high':str(max(float(b['high']) for b in group)),'low':str(min(float(b['low']) for b in group)),'close':group[-1]['close'],'volume':sum(b['volume'] for b in group) if all(b['volume'] is not None for b in group) else None,'end_time':group[-1]['time'],'end_session_date':group[-1]['session_date'],'is_final':all(b['is_final'] for b in group)})
    # Last partial week/month cannot produce a completed-period signal.
    if out:
        last=date.fromisoformat(bars[-1]['session_date']);today=date.today()
        if (period=='week' and last.isocalendar()[:2]==today.isocalendar()[:2]) or (period=='month' and (last.year,last.month)==(today.year,today.month)):out[-1]['is_final']=False
    return out

def _bar(index, day, values, fetched):
    tz=ZoneInfo('America/New_York' if index['market']=='美股' else 'Asia/Shanghai')
    dt=datetime.fromisoformat(day).replace(hour=16 if index['market']!='A 股' else 15,tzinfo=tz)
    o,c,h,l=map(float,values[:4])
    if min(o,c,h,l)<=0 or l>min(o,c) or h<max(o,c):return None
    volume=float(values[4]) if len(values)>4 and values[4] not in ('','-') else None
    return {'time':int(dt.timestamp()),'session_date':day,'open':str(values[0]),'close':str(values[1]),
            'high':str(values[2]),'low':str(values[3]),'volume':volume,
            'is_final':dt.date()<fetched.astimezone(tz).date()}

def tencent_bars(index_id,interval,start,end,fetched):
    symbol=TENCENT_SYMBOLS.get(index_id)
    if not symbol:return None
    index=BY_ID[index_id]
    headers={'User-Agent':'Mozilla/5.0 Alpha-Hunter/0.1'}
    if interval=='minute':
        response=httpx.get('https://web.ifzq.gtimg.cn/appstock/app/minute/query',params={'code':symbol},headers=headers,timeout=12)
        response.raise_for_status(); payload=response.json(); root=payload.get('data')
        entry=root.get(symbol) if isinstance(root,dict) else None
        minute_data=entry.get('data') if isinstance(entry,dict) else None
        rows=minute_data.get('data') if isinstance(minute_data,dict) else None
        if not rows:return None
        tz=ZoneInfo('America/New_York' if index['market']=='美股' else 'Asia/Shanghai')
        label=str(minute_data.get('date') or fetched.astimezone(tz).date().strftime('%Y%m%d'))
        session=datetime.strptime(label[:8],'%Y%m%d').date()
        bars=[];previous_volume=0.0
        for raw in rows:
            parts=raw.split();
            if len(parts)<2:continue
            dt=datetime.combine(session,datetime.strptime(parts[0],'%H%M').time(),tzinfo=tz)
            price=float(parts[1]);cumulative=float(parts[2]) if len(parts)>2 else previous_volume
            volume=max(0,cumulative-previous_volume);previous_volume=cumulative
            bars.append({'time':int(dt.timestamp()),'session_date':session.isoformat(),'open':str(price),'close':str(price),
                         'high':str(price),'low':str(price),'volume':volume,
                         'is_final':dt.astimezone(timezone.utc)+timedelta(minutes=1)<fetched})
        return bars or None
    begin=start or date.today()-timedelta(days=7305);finish=end or date.today()
    cache_key=(index_id,begin,finish)
    cached=_TENCENT_HISTORY_CACHE.get(cache_key)
    if cached and monotonic()-cached[0]<_NASDAQ_HISTORY_TTL_SECONDS:
        return [dict(bar) for bar in cached[1]]
    with _TENCENT_HISTORY_LOCK:
        cached=_TENCENT_HISTORY_CACHE.get(cache_key)
        if cached and monotonic()-cached[0]<_NASDAQ_HISTORY_TTL_SECONDS:
            return [dict(bar) for bar in cached[1]]
        rows_by_day={};cursor=begin
        # The upstream endpoint rejects counts above 2000. Six-year calendar
        # windows stay below that limit while allowing a 20-year research span.
        while cursor<=finish:
            chunk_end=min(finish,cursor+timedelta(days=6*365))
            param=f'{symbol},day,{cursor.isoformat()},{chunk_end.isoformat()},2000,qfq'
            response=httpx.get('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',params={'param':param},headers=headers,timeout=15)
            response.raise_for_status(); payload=response.json();root=payload.get('data')
            entry=root.get(symbol) if isinstance(root,dict) else None
            rows=(entry.get('day') or entry.get('qfqday')) if isinstance(entry,dict) else None
            for raw in rows or []:
                if len(raw)>=6 and begin.isoformat()<=raw[0]<=finish.isoformat():rows_by_day[raw[0]]=raw
            cursor=chunk_end+timedelta(days=1)
        bars=[]
        for raw in (rows_by_day[key] for key in sorted(rows_by_day)):
            item=_bar(index,raw[0],raw[1:6],fetched)
            if item:bars.append(item)
        if bars:_TENCENT_HISTORY_CACHE[cache_key]=(monotonic(),tuple(dict(bar) for bar in bars))
        return bars or None

def yahoo_us_history(index_id,start,end,fetched):
    """Return unambiguous Yahoo daily history for the three broad US indices.

    Tencent's quote/minute symbol ``usIXIC`` is valid, but its kline endpoint
    currently returns only the latest session for that symbol.  Keep Tencent
    for intraday data and use Yahoo's explicit ``^IXIC`` chart symbol for the
    daily history instead of substituting the Nasdaq-100.
    """
    begin=start or date.today()-timedelta(days=7305)
    finish=end or date.today()
    cache_key=(index_id,begin,finish)
    cached=_NASDAQ_HISTORY_CACHE.get(cache_key)
    if cached and monotonic()-cached[0]<_NASDAQ_HISTORY_TTL_SECONDS:
        return [dict(bar) for bar in cached[1]]
    # All day/week/month tabs use the same daily history. Serialize a cold
    # refresh so rapid tab switches do not send three identical upstream calls.
    with _NASDAQ_HISTORY_LOCK:
        cached=_NASDAQ_HISTORY_CACHE.get(cache_key)
        if cached and monotonic()-cached[0]<_NASDAQ_HISTORY_TTL_SECONDS:
            return [dict(bar) for bar in cached[1]]
        response=httpx.get(
            f'https://query1.finance.yahoo.com/v8/finance/chart/{_YAHOO_US_SYMBOLS[index_id]}',
            params={
                'period1':int(datetime.combine(begin,datetime.min.time(),tzinfo=timezone.utc).timestamp()),
                'period2':int(datetime.combine(finish+timedelta(days=1),datetime.min.time(),tzinfo=timezone.utc).timestamp()),
                'interval':'1d','events':'history',
            },
            headers={'User-Agent':'Mozilla/5.0 Alpha-Hunter/0.1'},timeout=15,
        )
        response.raise_for_status(); payload=response.json().get('chart',{})
        if payload.get('error'):return None
        results=payload.get('result') or []
        if not results:return None
        root=results[0]; timestamps=root.get('timestamp') or []
        quotes=((root.get('indicators') or {}).get('quote') or [])
        if not quotes:return None
        quote=quotes[0]; tz=ZoneInfo('America/New_York'); bars=[]
        fields=('open','close','high','low')
        series={key:quote.get(key) or [] for key in (*fields,'volume')}
        for position,stamp in enumerate(timestamps):
            try:
                values=[series[key][position] for key in fields]
                if any(value is None for value in values):continue
                day=datetime.fromtimestamp(stamp,tz).date()
                if day<begin or day>finish:continue
                item=_bar(BY_ID[index_id],day.isoformat(),values+[series['volume'][position] if position<len(series['volume']) else None],fetched)
                if item:bars.append(item)
            except (IndexError,TypeError,ValueError,OverflowError):
                continue
        if bars:_NASDAQ_HISTORY_CACHE[cache_key]=(monotonic(),tuple(dict(bar) for bar in bars))
        return bars or None

def yahoo_nasdaq_history(start,end,fetched):
    return yahoo_us_history('nasdaq',start,end,fetched)

def get_bars(index_id,interval='day',start=None,end=None,indicator_groups=None):
    if index_id not in BY_ID:raise HTTPException(404,'指数不存在')
    if interval not in ('minute','day','week','month'):raise HTTPException(422,'不支持的行情周期')
    index=BY_ID[index_id]; fetched=datetime.now(timezone.utc)
    result={'bars':[],'provider':'腾讯证券公开接口（研究用途）','as_of':None,'fetched_at':fetched.isoformat(),'unavailable_reason':None,'freshness':'unverified','indicators':{},'volume_unit':'供应商原始单位，未核验'}
    if index_id in _YAHOO_US_SYMBOLS and interval!='minute':
        try:
            bars=yahoo_us_history(index_id,start,end,fetched)
            if bars:
                result['provider']='Yahoo Finance 图表接口（研究用途）'
                result['as_of']=datetime.fromtimestamp(bars[-1]['time'],timezone.utc).isoformat()
                result['freshness_reason']='日线为供应商历史数据；最新交易日状态尚未完成交易日历核验，不能作为实时报价'
                result['bars']=aggregate(bars,interval);result['indicators']=selected_indicators(result['bars'],indicator_groups);return result
        except (httpx.HTTPError,ValueError,KeyError,TypeError,IndexError):
            pass
    try:
        bars=tencent_bars(index_id,interval,start,end,fetched)
        if bars:
            result['as_of']=datetime.fromtimestamp(bars[-1]['time'],timezone.utc).isoformat()
            result['freshness_reason']='供应商时间戳及交易日历尚未完成逐标的核验，不能承诺十分钟内行情'
            result['bars']=aggregate(bars,interval);result['indicators']=selected_indicators(result['bars'],indicator_groups);return result
    except (httpx.HTTPError,ValueError,KeyError,TypeError,IndexError):
        pass
    if os.getenv('EASTMONEY_FALLBACK','false').lower()!='true':
        result['unavailable_reason']='主数据源暂不可用或没有返回该指数历史；未使用 ETF 或其他指数代替'
        return result
    if not index['provider_symbol']:
        result['unavailable_reason']='主数据源没有返回该指数历史，备用映射也尚未核验；未使用 ETF 或其他指数代替';return result
    result['provider']='东方财富公开接口（研究备用）'
    tz=ZoneInfo('America/New_York' if index['market']=='美股' else 'Asia/Shanghai')
    try:
        params={'secid':index['provider_symbol'],'fields1':'f1,f2,f3,f4,f5,f6','fields2':'f51,f52,f53,f54,f55,f56','klt':'1' if interval=='minute' else '101','fqt':'0','beg':str(start or (date.today()-timedelta(days=7305))).replace('-',''),'end':str(end or date.today()).replace('-',''),'lmt':6000}
        response=httpx.get('https://push2his.eastmoney.com/api/qt/stock/kline/get',params=params,headers={'User-Agent':'Mozilla/5.0 Alpha-Hunter/0.1'},timeout=12)
        response.raise_for_status(); data=response.json().get('data')
        if not data or not data.get('klines'):raise ValueError('empty')
        bars=[]
        for raw in data['klines']:
            parts=raw.split(','); dt=datetime.fromisoformat(parts[0]).replace(tzinfo=tz)
            if interval!='minute':dt=dt.replace(hour=16 if index['market']!='A 股' else 15)
            o,c,h,l=map(float,parts[1:5])
            if min(o,c,h,l)<=0 or l>min(o,c) or h<max(o,c):continue
            bars.append({'time':int(dt.timestamp()),'session_date':dt.date().isoformat(),'open':parts[1],'close':parts[2],'high':parts[3],'low':parts[4],'volume':float(parts[5]) if parts[5] not in ('','-') else None,'is_final':dt.astimezone(timezone.utc)+timedelta(minutes=1)<fetched})
        bars.sort(key=lambda b:b['time'])
        result['as_of']=datetime.fromtimestamp(bars[-1]['time'],timezone.utc).isoformat() if bars else None
        # Daily timestamps are session labels, not verified quote timestamps.
        result['freshness']='unverified'
        result['freshness_reason']='供应商时间戳及交易日历尚未完成逐标的核验，不能承诺十分钟内行情'
        result['bars']=aggregate(bars,interval);result['indicators']=selected_indicators(result['bars'],indicator_groups)
    except (httpx.HTTPError,ValueError,KeyError,TypeError,IndexError):
        result['unavailable_reason']='行情供应商暂不可用或未返回有效数据，请稍后重试'
    return result
