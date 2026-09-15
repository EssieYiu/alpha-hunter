from math import sqrt

def sma(values, n):
    return [None if i<n-1 else sum(values[i-n+1:i+1])/n for i in range(len(values))]

def ema(values,n):
    out=[None]*len(values)
    if len(values)<n:return out
    out[n-1]=sum(values[:n])/n
    for i in range(n,len(values)):out[i]=values[i]*2/(n+1)+out[i-1]*(1-2/(n+1))
    return out

def rsi(values,n=14):
    out=[None]*len(values)
    if len(values)<=n:return out
    changes=[values[i]-values[i-1] for i in range(1,len(values))]
    gain=sum(max(c,0) for c in changes[:n])/n;loss=sum(max(-c,0) for c in changes[:n])/n
    for i in range(n,len(values)):
        if i>n:gain=(gain*(n-1)+max(changes[i-1],0))/n;loss=(loss*(n-1)+max(-changes[i-1],0))/n
        out[i]=100-100/(1+gain/loss) if loss else (100 if gain else 50)
    return out

def calculate(bars):
    values=[float(b['close']) for b in bars]; mid=sma(values,20)
    e12=ema(values,12);e26=ema(values,26)
    dif=[None if b is None else a-b for a,b in zip(e12,e26)]
    dea=[None]*25+ema([v for v in dif if v is not None],9) if len(values)>=26 else [None]*len(values)
    k=d=50.;ks=[];ds=[];js=[]
    for i,b in enumerate(bars):
        if i<8:ks.append(None);ds.append(None);js.append(None);continue
        low=min(float(x['low']) for x in bars[i-8:i+1]); high=max(float(x['high']) for x in bars[i-8:i+1])
        rsv=100*(values[i]-low)/(high-low) if high!=low else 50
        k=2*k/3+rsv/3;d=2*d/3+k/3;ks.append(k);ds.append(d);js.append(3*k-2*d)
    std=[None if m is None else sqrt(sum((v-m)**2 for v in values[i-19:i+1])/20) for i,m in enumerate(mid)]
    series={'MA20':mid,'MA60':sma(values,60),'EMA20':ema(values,20),'BOLL_MIDDLE':mid,'BOLL_UPPER':[None if m is None else m+2*s for m,s in zip(mid,std)],'BOLL_LOWER':[None if m is None else m-2*s for m,s in zip(mid,std)],'DIF':dif,'DEA':dea,'MACD':[None if d is None else 2*(f-d) for f,d in zip(dif,dea)],'RSI':rsi(values),'K':ks,'D':ds,'J':js}
    return {key:[{'time':b['time'],'value':v} for b,v in zip(bars,arr) if v is not None] for key,arr in series.items()}
