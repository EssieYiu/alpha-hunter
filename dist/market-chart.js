/* Deterministic demo OHLC + indicators. No network requests or live quotes. */
(function (root) {
  'use strict';
  const END = '2026-09-10';
  const DAY = 86400000;
  const colors = { price:'#167d67', MA5:'#b97814', MA10:'#825ac7', MA20:'#2178ba', MA60:'#b44b81', MA120:'#607d3e', EMA12:'#d06432', EMA26:'#3f7d93', BOLL:'#7b72b4', AVG:'#b97814', PREV:'#7b8790' };
  const periodNames = { minute:'分时', day:'日线', week:'周线', month:'月线' };
  const preferences = { period:'day', range:180, overlays:new Set(['MA5','MA10','MA20']), lower:'VOL', cursor:null };
  const cache = new Map();
  const number = (v, decimals=2) => Number.isFinite(v) ? v.toLocaleString('zh-CN',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}) : '—';
  const date = v => new Date(v).toISOString().slice(0,10);

  function dailyData(index) {
    if (cache.has(index.id)) return cache.get(index.id);
    let seed = [...index.id].reduce((n,c)=>n*31+c.charCodeAt(0),7) >>> 0;
    const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
    const bars=[];
    let previous=100;
    for(let t=Date.parse('2008-01-01');t<=Date.parse(END);t+=DAY){
      if([0,6].includes(new Date(t).getUTCDay())) continue;
      const open=previous*(1+(random()-.5)*.008);
      const close=open*Math.exp((random()-.48)*.026+Math.sin(bars.length/27)*.001);
      bars.push({date:date(t),open,close,high:Math.max(open,close)*(1+random()*.009),low:Math.min(open,close)*(1-random()*.009),volume:Math.round((.3+random())*1e8)});
      previous=close;
    }
    const scale=index.value/bars.at(-1).close;
    bars.forEach(b=>{for(const key of ['open','high','low','close'])b[key]*=scale;});
    // Align the last synthetic session with the quote shown in the prototype.
    const last=bars.at(-1), prior=bars.at(-2), previousClose=index.value/(1+index.change/100);
    prior.close=previousClose; prior.high=Math.max(prior.high,previousClose); prior.low=Math.min(prior.low,previousClose);
    last.open=previousClose*(1+(random()-.5)*.004);
    last.high=Math.max(last.open,last.close)*1.006;
    last.low=Math.min(last.open,last.close)*.994;
    cache.set(index.id,bars);
    return bars;
  }

  function aggregate(bars, period) {
    if(period==='day') return bars;
    const result=[];
    let currentKey;
    for(const bar of bars){
      const d=new Date(bar.date);
      const key=period==='month'?bar.date.slice(0,7):date(d.getTime()-((d.getUTCDay()+6)%7)*DAY);
      if(key!==currentKey){result.push({...bar,start:bar.date});currentKey=key;}
      else {const b=result.at(-1);b.high=Math.max(b.high,bar.high);b.low=Math.min(b.low,bar.low);b.close=bar.close;b.volume+=bar.volume;b.date=bar.date;}
    }
    return result;
  }

  function minuteData(index) {
    const sessions=index.market==='美股'?[[570,960]]:index.market==='港股'?[[570,720],[780,960]]:[[570,690],[780,900]];
    const minutes=sessions.flatMap(([a,b])=>Array.from({length:b-a+1},(_,i)=>a+i));
    const last=dailyData(index).at(-1), result=[];
    let previous=last.open;
    minutes.forEach((m,i)=>{
      const p=i/(minutes.length-1);
      const close=last.open+(last.close-last.open)*p+Math.sin(Math.PI*p)*(Math.sin(i*.17)+Math.cos(i*.061))*index.value*.0015;
      result.push({date:END,time:`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`,open:previous,high:Math.max(previous,close),low:Math.min(previous,close),close,volume:Math.round((1.1+Math.sin(i*.37)) * 1e5)});
      previous=close;
    });
    return result;
  }

  function sma(values,n) {
    let sum=0;
    return values.map((v,i)=>{sum+=v;if(i>=n)sum-=values[i-n];return i<n-1?null:sum/n;});
  }
  function ema(values,n) {
    let prev=null, warm=[];
    return values.map(v=>{
      if(v===null) return null;
      if(prev===null){warm.push(v);if(warm.length<n)return null;prev=warm.reduce((a,b)=>a+b,0)/n;}
      else prev+=2/(n+1)*(v-prev);
      return prev;
    });
  }
  function rsi(values,n=14) {
    let gain=0,loss=0;
    return values.map((v,i)=>{
      if(!i)return null;
      const delta=v-values[i-1],g=Math.max(delta,0),l=Math.max(-delta,0);
      if(i<=n){gain+=g/n;loss+=l/n;}else{gain=(gain*(n-1)+g)/n;loss=(loss*(n-1)+l)/n;}
      return i<n?null:gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
    });
  }
  function indicators(bars) {
    const close=bars.map(b=>b.close), data={};
    for(const n of [5,10,20,60,120])data['MA'+n]=sma(close,n);
    data.EMA12=ema(close,12);data.EMA26=ema(close,26);
    data.DIF=close.map((_,i)=>data.EMA26[i]===null?null:data.EMA12[i]-data.EMA26[i]);
    data.DEA=ema(data.DIF,9);
    data.MACD=data.DIF.map((v,i)=>data.DEA[i]===null?null:2*(v-data.DEA[i]));
    data.RSI=rsi(close);
    data.BOLL=data.MA20;
    data.UPPER=close.map((_,i)=>i<19?null:data.MA20[i]+2*Math.sqrt(close.slice(i-19,i+1).reduce((s,v)=>s+(v-data.MA20[i])**2,0)/20));
    data.LOWER=close.map((_,i)=>i<19?null:2*data.MA20[i]-data.UPPER[i]);
    let sum=0,volume=0,k=50,d=50;
    data.AVG=bars.map(b=>{sum+=b.close*b.volume;volume+=b.volume;return sum/volume;});
    data.K=[];data.D=[];data.J=[];
    bars.forEach((b,i)=>{
      if(i<8){data.K.push(null);data.D.push(null);data.J.push(null);return;}
      const window=bars.slice(i-8,i+1),hi=Math.max(...window.map(x=>x.high)),lo=Math.min(...window.map(x=>x.low));
      const rsv=hi===lo?50:100*(b.close-lo)/(hi-lo);
      k=k*2/3+rsv/3;d=d*2/3+k/3;
      data.K.push(k);data.D.push(d);data.J.push(3*k-2*d);
    });
    return data;
  }

  function model(index) {
    const p=preferences,all=p.period==='minute'?minuteData(index):aggregate(dailyData(index),p.period);
    const calculated=indicators(all),cutoff=Date.parse(END)-p.range*DAY;
    const start=p.period==='minute'?0:all.findIndex(b=>Date.parse(b.date)>=cutoff);
    const bars=all.slice(Math.max(0,start)),lines={};
    for(const [key,values] of Object.entries(calculated))lines[key]=values.slice(Math.max(0,start));
    lines.PREV=bars.map(()=>index.value/(1+index.change/100));
    return {bars,lines,index};
  }

  function selectedLines(m) {
    const keys=[...preferences.overlays].filter(key=>preferences.period==='minute'||!['AVG','PREV'].includes(key));
    return keys.flatMap(key=>key==='BOLL'?['BOLL','UPPER','LOWER']:key).map(key=>({key,color:colors[key]||colors.BOLL,values:m.lines[key]}));
  }
  const x=(i,n)=>(i+.5)*900/n;
  function bounds(values) {
    const valid=values.filter(Number.isFinite),min=Math.min(...valid),max=Math.max(...valid),pad=(max-min||Math.abs(max)*.01||1)*.08;
    return [min-pad,max+pad];
  }
  function path(values,y) {
    let started=false;
    return values.map((v,i)=>{if(!Number.isFinite(v)){started=false;return '';}const cmd=started?'L':'M';started=true;return `${cmd}${x(i,values.length).toFixed(2)},${y(v).toFixed(2)}`;}).join(' ');
  }
  function grid(y,min,max) {return Array.from({length:5},(_,i)=>{const value=max-(max-min)*i/4;return `<line x1="0" x2="900" y1="${y(value)}" y2="${y(value)}" stroke="#e8eeeb" stroke-dasharray="4 5"/>`;}).join('');}
  function axes(min,max) {return `<div class="technical-axis">${Array.from({length:5},(_,i)=>`<span>${number(max-(max-min)*i/4,max>1000?0:2)}</span>`).join('')}</div>`;}
  function pricePlot(m) {
    const {bars}=m, lines=selectedLines(m), n=bars.length;
    const [min,max]=bounds([...bars.flatMap(b=>[b.low,b.high]),...lines.flatMap(l=>l.values)]),y=v=>12+(max-v)/(max-min)*276;
    const bodyWidth=Math.max(1,900/n*.64);
    const actualPath=path(bars.map(b=>b.close),y);
    const price=preferences.period==='minute'?`<path class="actual-price-halo" d="${actualPath}" fill="none" stroke="white" stroke-width="6.5" vector-effect="non-scaling-stroke"/><path class="actual-price-line" d="${actualPath}" fill="none" stroke="#123b58" stroke-width="3.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${x(n-1,n)}" cy="${y(bars.at(-1).close)}" r="4" fill="#123b58" stroke="white" stroke-width="2"/>`:bars.map((b,i)=>{
      const color=b.close>=b.open?'#cd6153':'#198564';
      return `<g><line x1="${x(i,n)}" x2="${x(i,n)}" y1="${y(b.high)}" y2="${y(b.low)}" stroke="${color}"/><rect x="${x(i,n)-bodyWidth/2}" y="${Math.min(y(b.open),y(b.close))}" width="${bodyWidth}" height="${Math.max(1,Math.abs(y(b.open)-y(b.close)))}" fill="${color}"/></g>`;
    }).join('');
    const minute=preferences.period==='minute';
    const area=minute?`<defs><linearGradient id="actual-price-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#397da1" stop-opacity=".17"/><stop offset="1" stop-color="#397da1" stop-opacity="0"/></linearGradient></defs><path d="${actualPath} L${x(n-1,n)},300 L${x(0,n)},300 Z" fill="url(#actual-price-fill)"/>`:'';
    return `${minute?'<div class="price-style-key"><strong><i class="key-actual"></i>指数实际值 · 粗实线</strong><span><i class="key-average"></i>均线 · 细虚线</span><span><i class="key-reference"></i>参考线 · 点线</span><small>实际值指合成行情原始点位</small></div>':''}<div class="technical-plot price-plot"><svg data-inspect viewBox="0 0 900 300" preserveAspectRatio="none" role="img" aria-label="${m.index.name}${periodNames[preferences.period]}及已选择的指标线">${grid(y,min,max)}${area}${!minute?price:''}${lines.map(l=>`<path class="indicator-line" d="${path(l.values,y)}" fill="none" stroke="${l.color}" stroke-width="${minute?'1.3':'1.5'}" vector-effect="non-scaling-stroke" ${minute?`stroke-dasharray="${['UPPER','LOWER','PREV'].includes(l.key)?'2 5':'7 5'}" opacity=".8"`:['UPPER','LOWER','PREV'].includes(l.key)?'stroke-dasharray="5 4"':''}/>`).join('')}${minute?price:''}<line class="crosshair" x1="0" x2="0" y1="0" y2="300" stroke="#7b8a82" stroke-dasharray="3 4"/></svg>${axes(min,max)}</div>`;
  }
  function lowerPlot(m) {
    const type=preferences.lower;if(type==='NONE')return '';
    const names={VOL:'成交量 · 合成量',MACD:'MACD (12,26,9) · 柱 = 2 × (DIF − DEA)',RSI:'RSI (14) · Wilder 平滑',KDJ:'KDJ (9,3,3)'};
    const {bars,lines}=m,n=bars.length;
    let series=[],hist=null,min,max;
    if(type==='VOL'){hist=bars.map(b=>b.volume/1e8);min=0;max=Math.max(...hist)*1.1;}
    if(type==='MACD'){series=[['DIF','#b97814'],['DEA','#825ac7']];hist=lines.MACD;const v=[0,...hist,...lines.DIF,...lines.DEA];[min,max]=bounds(v);}
    if(type==='RSI'){series=[['RSI','#825ac7']];min=0;max=100;}
    if(type==='KDJ'){series=[['K','#b97814'],['D','#2178ba'],['J','#825ac7']];[min,max]=bounds([0,100,...lines.K,...lines.D,...lines.J]);}
    const y=v=>8+(max-v)/(max-min)*104;
    const thresholds=type==='RSI'?[30,70]:type==='KDJ'?[20,80]:type==='MACD'?[0]:[];
    return `<div class="lower-heading"><strong>${names[type]}</strong><span id="lower-values"></span></div><div class="technical-plot lower-plot"><svg data-inspect viewBox="0 0 900 120" preserveAspectRatio="none" role="img" aria-label="${type} 指标副图">${grid(y,min,max)}${thresholds.map(v=>`<line x1="0" x2="900" y1="${y(v)}" y2="${y(v)}" stroke="#b6a78e" stroke-dasharray="6 5"/>`).join('')}${hist?hist.map((v,i)=>v===null?'':`<rect x="${x(i,n)-900/n*.32}" y="${Math.min(y(0),y(v))}" width="${Math.max(1,900/n*.64)}" height="${Math.max(1,Math.abs(y(0)-y(v)))}" fill="${(type==='VOL'?bars[i].close>=bars[i].open:v>=0)?'#cd6153':'#198564'}" opacity=".7"/>`).join(''):''}${series.map(([key,color])=>`<path d="${path(lines[key],y)}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('')}<line class="crosshair" x1="0" x2="0" y1="0" y2="120" stroke="#7b8a82" stroke-dasharray="3 4"/></svg>${axes(min,max)}${type==='VOL'?'<small class="volume-unit">亿 · 合成量</small>':''}</div>`;
  }
  function render(index) {
    const p=preferences,m=model(index),isMinute=p.period==='minute';
    const toggles=['MA5','MA10','MA20','MA60','MA120','EMA12','EMA26','BOLL',...(isMinute?['AVG','PREV']:[])];
    const labels={BOLL:'BOLL (20,2)',AVG:'分时均线',PREV:'昨收线'};
    return `<section class="technical-chart" aria-label="指数技术图表"><div class="period-toolbar"><div class="period-tabs" role="group" aria-label="图表周期">${Object.entries(periodNames).map(([key,name])=>`<button type="button" data-period="${key}" aria-pressed="${p.period===key}" class="${p.period===key?'on':''}">${name}</button>`).join('')}</div>${isMinute?`<span class="chart-session">${END} · ${index.market==='美股'?'纽约':index.market==='港股'?'香港':'上海'}时间</span>`:`<label class="chart-window">显示范围<select data-chart-range aria-label="图表显示范围">${[[30,'近 1 月'],[180,'近 6 月'],[365,'近 1 年'],[1095,'近 3 年']].map(([value,label])=>`<option value="${value}" ${p.range===value?'selected':''}>${label}</option>`).join('')}</select></label>`}</div><div class="indicator-controls" role="group" aria-label="主图指标"><span>叠加指标</span>${toggles.map(key=>`<label style="--line-color:${colors[key]}"><input type="checkbox" data-overlay="${key}" ${p.overlays.has(key)?'checked':''}><i></i>${labels[key]||key}</label>`).join('')}</div><div class="bar-readout" id="bar-readout" aria-live="off"></div><div class="indicator-readout" id="indicator-readout"></div>${pricePlot(m)}<div class="sub-toolbar"><span>副图指标</span><div role="group" aria-label="副图指标">${[['VOL','成交量'],['MACD','MACD'],['RSI','RSI'],['KDJ','KDJ'],['NONE','关闭']].map(([key,name])=>`<button type="button" data-lower="${key}" aria-pressed="${p.lower===key}" class="${p.lower===key?'on':''}">${name}</button>`).join('')}</div></div>${lowerPlot(m)}<div class="technical-dates">${[0,.25,.5,.75,1].map(v=>{const b=m.bars[Math.round((m.bars.length-1)*v)];return `<span>${isMinute?b.time:b.date.slice(2)}</span>`;}).join('')}</div><label class="scrubber-label">查看时点<input type="range" id="chart-scrubber" min="0" max="${m.bars.length-1}" value="${m.bars.length-1}" aria-label="查看图表时点"></label><p class="chart-note">${isMinute?'1 分钟合成点位；盘中休市时段不绘制。':'红涨绿跌；周、月 K 线由同一日线序列聚合，末根截至 09-10，尚未结束。'} ${isMinute?'均线周期按分钟计算。':'均线周期按当前 K 线根数计算。'}<br>行情与成交量均为合成演示数据，指标按公式计算；历史日期仅跳过周末，未应用真实交易日历。</p><details class="indicator-help"><summary>指标参数与计算口径</summary><p>MA：收盘价简单平均；EMA：以首个完整周期均值初始化，平滑系数 2/(N+1)。BOLL：MA20 ± 2 倍总体标准差。MACD：DIF=EMA12−EMA26，DEA=EMA9(DIF)，柱=2×(DIF−DEA)。RSI14 使用 Wilder 平滑，30/70 为参考线。KDJ(9,3,3)：K、D 从 50 开始递推，J=3K−2D，20/80 为参考线。分时均线使用合成量对点位加权，仅作示意。所有指标先在完整历史上计算，再截取显示区间，数据不足显示“—”。这些指标暂不改变原型的固定策略信号。</p></details></section>`;
  }
  function bind(index) {
    const el=document.querySelector('.technical-chart');if(!el)return;
    const m=model(index),p=preferences;
    function inspect(i){
      const b=m.bars[i];if(!b)return;p.cursor=i;
      const previous=i?m.bars[i-1].close:null;
      document.getElementById('bar-readout').innerHTML=`<strong>${b.time?b.date+' '+b.time:b.start&&b.start!==b.date?b.start+' — '+b.date:b.date}</strong><span>开 ${number(b.open)}</span><span>高 ${number(b.high)}</span><span>低 ${number(b.low)}</span><span>收 ${number(b.close)}</span>${previous?`<span>涨跌 ${number((b.close/previous-1)*100)}%</span>`:''}`;
      document.getElementById('indicator-readout').innerHTML=selectedLines(m).map(l=>`<span style="color:${l.color}">${l.key} ${number(l.values[i])}</span>`).join('')||'<span>未叠加主图指标</span>';
      const lower=document.getElementById('lower-values');
      if(lower)lower.textContent=p.lower==='VOL'?number(b.volume/1e8)+' 亿':(p.lower==='MACD'?['DIF','DEA','MACD']:p.lower==='RSI'?['RSI']:['K','D','J']).map(k=>k+' '+number(m.lines[k][i])).join(' / ');
      el.querySelectorAll('.crosshair').forEach(line=>{line.setAttribute('x1',x(i,m.bars.length));line.setAttribute('x2',x(i,m.bars.length));});
      const slider=document.getElementById('chart-scrubber');slider.value=i;slider.setAttribute('aria-valuetext',`${b.time||b.date}，收盘 ${number(b.close)}`);
    }
    function redraw(focus){p.cursor=null;el.outerHTML=render(index);bind(index);if(focus)document.querySelector(focus)?.focus();}
    el.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{p.period=b.dataset.period;if(p.period==='minute'){p.overlays.add('AVG');p.overlays.add('PREV');}if(p.period==='month')p.range=1095;if(p.period==='week')p.range=365;redraw(`[data-period="${p.period}"]`);});
    el.querySelector('[data-chart-range]')?.addEventListener('change',e=>{p.range=Number(e.target.value);redraw('[data-chart-range]');});
    el.querySelectorAll('[data-overlay]').forEach(b=>b.onchange=()=>{const key=b.dataset.overlay;b.checked?p.overlays.add(key):p.overlays.delete(key);redraw(`[data-overlay="${key}"]`);});
    el.querySelectorAll('[data-lower]').forEach(b=>b.onclick=()=>{p.lower=b.dataset.lower;redraw(`[data-lower="${p.lower}"]`);});
    el.querySelectorAll('[data-inspect]').forEach(svg=>{svg.onpointermove=e=>{const r=svg.getBoundingClientRect();inspect(Math.max(0,Math.min(m.bars.length-1,Math.floor((e.clientX-r.left)/r.width*m.bars.length))));};svg.onclick=svg.onpointermove;});
    document.getElementById('chart-scrubber').oninput=e=>inspect(Number(e.target.value));
    inspect(m.bars.length-1);
  }
  const api={render,bind,dailyData,minuteData,aggregate,indicators,sma,ema,rsi,model,preferences};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MarketChart=api;
})(typeof globalThis!=='undefined'?globalThis:this);
