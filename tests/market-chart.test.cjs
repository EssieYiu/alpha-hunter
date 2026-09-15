const test=require('node:test');
const assert=require('node:assert/strict');
const chart=require('../dist/market-chart.js');
const fs=require('node:fs');
const index={id:'csi300',name:'沪深 300',market:'A 股',value:4126.32,change:1.26};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('MA/EMA warm up, RSI constant and directional series',()=>{
  assert.deepEqual(chart.sma([1,2,3,4,5],3),[null,null,2,3,4]);
  assert.deepEqual(chart.ema([1,2,3,4,5],3),[null,null,2,3,4]);
  assert.equal(chart.rsi(Array(30).fill(4)).at(-1),50);
  assert.equal(chart.rsi(Array.from({length:30},(_,i)=>i)).at(-1),100);
  assert.equal(chart.rsi(Array.from({length:30},(_,i)=>30-i)).at(-1),0);
});
test('weekly and monthly bars preserve open, extrema, close and summed volume across years',()=>{
  const bars=[['2025-12-29',10,14,9,12,2],['2025-12-31',12,16,8,14,3],['2026-01-02',14,17,13,16,5],['2026-01-05',16,20,15,18,7]].map(([date,open,high,low,close,volume])=>({date,open,high,low,close,volume}));
  const weekly=chart.aggregate(bars,'week');
  assert.equal(weekly.length,2);assert.deepEqual(weekly[0],{start:'2025-12-29',date:'2026-01-02',open:10,high:17,low:8,close:16,volume:10});
  const monthly=chart.aggregate(bars,'month');assert.equal(monthly.length,2);assert.equal(monthly[1].open,14);assert.equal(monthly[1].close,18);assert.equal(monthly[1].volume,12);
});
test('BOLL population deviation and MACD zero on flat prices',()=>{
  const flat=Array.from({length:140},(_,i)=>({date:String(i),open:100,high:100,low:100,close:100,volume:10}));
  const d=chart.indicators(flat);
  for(const key of ['MA20','BOLL','UPPER','LOWER','EMA12','EMA26'])near(d[key].at(-1),100);
  for(const key of ['DIF','DEA','MACD'])near(d[key].at(-1),0);
  for(const key of ['K','D','J','RSI'])near(d[key].at(-1),50);
  const linear=chart.indicators(flat.map((b,i)=>({...b,close:i+1})));
  near(linear.UPPER[19],10.5+2*Math.sqrt(33.25));
});
test('synthetic OHLC agrees with quote and intraday sessions omit lunch',()=>{
  const daily=chart.dailyData(index),last=daily.at(-1);near(last.close,index.value);
  near((last.close/daily.at(-2).close-1)*100,index.change);
  assert.ok(daily.every(b=>b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.volume>0));
  const minute=chart.minuteData(index);assert.equal(minute[0].time,'09:30');assert.equal(minute.at(-1).time,'15:00');
  assert.ok(!minute.some(b=>b.time>'11:30'&&b.time<'13:00'));
  near(minute.at(-1).close,last.close);near(minute[0].open,last.open);
  const us=chart.minuteData({...index,id:'sp500',market:'美股'});assert.equal(us.length,391);assert.equal(us.at(-1).time,'16:00');
});
test('indicators have no future data dependence and enough monthly warmup',()=>{
  const daily=chart.dailyData(index),prefix=chart.indicators(daily.slice(0,200)),full=chart.indicators(daily);
  for(const key of Object.keys(prefix))assert.deepEqual(prefix[key],full[key].slice(0,200),key);
  chart.preferences.period='month';chart.preferences.range=1095;
  assert.ok(chart.model(index).lines.MA120.every(Number.isFinite));
});
test('all periods and lower panels produce valid chart markup',()=>{
  chart.preferences.overlays=new Set(['MA5','MA10','MA20','MA60','MA120','EMA12','EMA26','BOLL','AVG','PREV']);
  for(const period of ['minute','day','week','month']){
    chart.preferences.period=period;
    for(const lower of ['VOL','MACD','RSI','KDJ','NONE']){
      chart.preferences.lower=lower;const html=chart.render(index);
      assert.ok(!/NaN|Infinity|undefined/.test(html),period+'/'+lower);
      assert.ok(html.includes('data-period="'+period+'" aria-pressed="true"'));
    }
  }
});
test('display windows share indicator values and index switching changes prices',()=>{
  chart.preferences.period='day';chart.preferences.range=30;const small=chart.model(index);
  chart.preferences.range=365;const large=chart.model(index);
  assert.ok(large.bars.length>small.bars.length);
  for(const key of Object.keys(small.lines))assert.deepEqual(small.lines[key],large.lines[key].slice(-small.bars.length));
  const other=chart.model({...index,id:'hsi',market:'港股',value:24710.56});near(other.bars.at(-1).close,24710.56);
});
test('HTML loads chart before app and app attaches chart rendering/events',()=>{
  const html=fs.readFileSync('dist/index.html','utf8'),app=fs.readFileSync('dist/app.js','utf8');
  assert.ok(html.indexOf('market-chart.js')<html.indexOf('./app.js'));
  for(const asset of [...html.matchAll(/(?:src|href)="\.\/(.*?)"/g)])assert.ok(fs.existsSync('dist/'+asset[1]));
  assert.ok(app.includes('${MarketChart.render(i)}'));assert.ok(app.includes('MarketChart.bind(i)'));
});
