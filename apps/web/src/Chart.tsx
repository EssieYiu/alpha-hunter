import {useEffect,useRef} from 'react';
import {createChart,AreaSeries,CandlestickSeries,LineSeries,HistogramSeries,LineStyle,type Time} from 'lightweight-charts';
import type {Bars,Run} from './api';
export function MarketChart({data,interval,enabled}:{data:Bars;interval:string;enabled:string[]}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!ref.current||!data.bars.length)return;const chart=createChart(ref.current,{autoSize:true,height:enabled.some(x=>['MACD','RSI','KDJ'].includes(x))?540:380,layout:{textColor:'#6c8177',background:{color:'#ffffff'}},grid:{vertLines:{color:'#f1f5f2'},horzLines:{color:'#eef3ef'}},timeScale:{timeVisible:interval==='minute'},localization:{locale:'zh-CN'}});
 const bars=data.bars.map(b=>({...b,time:b.time as Time,open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close)}));
 if(interval==='minute')chart.addSeries(AreaSeries,{lineColor:'#146e50',lineWidth:3,topColor:'#319b7040',bottomColor:'#319b7000'}).setData(bars.map(b=>({time:b.time,value:b.close})));
 else chart.addSeries(CandlestickSeries,{upColor:'#cf6652',downColor:'#198564',borderVisible:false,wickUpColor:'#cf6652',wickDownColor:'#198564'}).setData(bars);
 const groups:Record<string,string[]>={MA:['MA20','MA60'],EMA:['EMA20'],BOLL:['BOLL_UPPER','BOLL_MIDDLE','BOLL_LOWER'],MACD:['DIF','DEA','MACD'],RSI:['RSI'],KDJ:['K','D','J']};
 let pane=0;const colors=['#be9142','#7583b3','#b27892','#559ab0','#bd784f'];
 enabled.forEach(group=>{const isSub=['MACD','RSI','KDJ'].includes(group);if(isSub)pane++;groups[group]?.forEach((key,n)=>{const points=(data.indicators?.[key]||[]).filter(p=>p.value!=null&&Number.isFinite(Number(p.value))).map(p=>({time:p.time as Time,value:Number(p.value)}));if(!points.length)return;const target=isSub?pane:0;if(key==='MACD')chart.addSeries(HistogramSeries,{color:'#9bb5a6'},target).setData(points);else chart.addSeries(LineSeries,{color:colors[n%colors.length],lineWidth:1,lineStyle:n%2?LineStyle.Dotted:LineStyle.Dashed,priceLineVisible:false,lastValueVisible:false,title:key},target).setData(points)});});
 chart.timeScale().fitContent();return()=>chart.remove();},[data,interval,enabled]);
 return <><div ref={ref}/><p className="chart-credit">图表由 <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a> 提供 · 粗实线/面积为分时实际值，细虚线为指标</p></>;
}
export function EquityChart({run}:{run:Run}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{if(!ref.current||!run.result?.equity.length)return;const c=createChart(ref.current,{autoSize:true,height:320,layout:{textColor:'#6c8177',background:{color:'#fff'}}});for(const [key,color]of [['equity','#198564'],['benchmark','#8793ac']]as const)c.addSeries(LineSeries,{color,lineWidth:key==='equity'?3:1,lineStyle:key==='equity'?LineStyle.Solid:LineStyle.Dashed,title:key==='equity'?'策略资产':'基准资产'}).setData(run.result.equity.map(p=>({time:p.time as Time,value:Number(p[key])})));c.timeScale().fitContent();return()=>c.remove()},[run]);return <div ref={ref}/>}
