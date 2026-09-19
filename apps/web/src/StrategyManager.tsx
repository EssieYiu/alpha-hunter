import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api,type Strategy} from './api';
import {useAgent} from './Agent';
import './StrategyManager.css';

const example = `class CustomStrategy(StrategyBase):
    def on_bar(self, history):
        if len(history) < 21:
            return Signal.HOLD
        closes = [bar.close for bar in history]
        short_now = sum(closes[-5:]) / 5
        long_now = sum(closes[-20:]) / 20
        short_prev = sum(closes[-6:-1]) / 5
        long_prev = sum(closes[-21:-1]) / 20
        if short_prev <= long_prev and short_now > long_now:
            return Signal.BUY
        if short_prev >= long_prev and short_now < long_now:
            return Signal.SELL
        return Signal.HOLD`;

type Draft = {
  id?:string; name:string; type:Strategy['type']; period:Strategy['period'];
  fast:number; slow:number; lower:number; upper:number; lookback:number;
  source:string; description:string;
};
const blank:Draft={name:'',type:'MA',period:'day',fast:20,slow:60,lower:30,upper:70,lookback:100,source:example,description:''};
const periods={day:'日线',week:'周线',month:'月线'};

export function StrategyManager(){
  const agent=useAgent(),navigate=useNavigate(),client=useQueryClient();
  const [edit,setEdit]=useState<Draft|null>(null);
  const list=useQuery({queryKey:['strategies'],queryFn:()=>api<Strategy[]>('/strategies')});
  const save=useMutation({
    mutationFn:()=>{
      if(!edit)throw new Error('请选择策略');
      const body=edit.type==='CODE'
        ?{name:edit.name,type:'CODE',period:edit.period,lookback:edit.lookback,source:edit.source,description:edit.description}
        :{name:edit.name,type:edit.type,period:edit.period,fast:edit.fast,slow:edit.slow,lower:edit.lower,upper:edit.upper,description:edit.description};
      const path=edit.type==='CODE'?'/code-strategies':'/strategies';
      return api<Strategy>(path+(edit.id?'/'+edit.id:''),body,edit.id?'PUT':'POST');
    },
    onSuccess:()=>{setEdit(null);void client.invalidateQueries({queryKey:['strategies']});}
  });
  const remove=useMutation({mutationFn:(id:string)=>api('/strategies/'+id,undefined,'DELETE'),onSuccess:()=>client.invalidateQueries({queryKey:['strategies']})});
  const open=(strategy:Strategy)=>setEdit({...blank,...strategy});
  return <>
    <div className="page-title"><div><div className="eyebrow">ALPHA HUNTER / RESEARCH WORKSPACE</div><h1>把研究沉淀为策略</h1><p>参数模板与自定义 Python 策略，编辑后生成新版本。</p></div><div className="actions"><button className="btn" onClick={()=>agent.ask('请帮我研究适合指数的策略，说明参数、适用条件和风险，并调用工具新增策略。')}>✧ Agent 研究策略</button><button className="btn" onClick={()=>setEdit({...blank,type:'CODE'})}>＋ 代码策略</button><button className="btn primary" onClick={()=>setEdit({...blank})}>＋ 模板策略</button></div></div>
    {(list.error||remove.error)&&<p className="error">{(list.error||remove.error)?.message}</p>}
    <div className="watch-grid">{list.data?.map(strategy=><section className="panel strategy-card" key={strategy.id}>
      <div className="row"><h2>{strategy.name}</h2><span className="tag">v{strategy.version}</span></div>
      <p>{strategy.description||'尚未填写策略说明'}</p>
      <div className="note">{strategy.type==='CODE'?'自定义 Python':strategy.type} · {periods[strategy.period]} · {strategy.type==='CODE'?`预热目标 ${strategy.lookback} 根`:strategy.type==='RSI'?`${strategy.lower} / ${strategy.upper}`:`${strategy.fast} / ${strategy.slow}`}<br/>完成周期形成信号，下一期开盘执行</div>
      <div className="actions"><button className="btn small" onClick={()=>navigate('/backtest?strategy='+strategy.id)}>回测</button><button className="btn small" onClick={()=>open(strategy)}>编辑</button><button className="text-btn" disabled={remove.isPending} onClick={()=>remove.mutate(strategy.id)}>删除</button></div>
    </section>)}</div>
    {!list.data?.length&&<div className="panel empty">{list.isPending?'正在加载策略…':'还没有策略。可以新建模板策略或代码策略。'}</div>}
    {edit&&<div className="overlay"><form className={'modal '+(edit.type==='CODE'?'code-strategy-modal':'')} onSubmit={event=>{event.preventDefault();save.mutate()}}>
      <div className="row"><h2>{edit.id?'编辑策略':'新增策略'}</h2><button type="button" className="btn small" onClick={()=>setEdit(null)}>关闭</button></div>
      <label>策略名称<input required maxLength={100} value={edit.name} onChange={event=>setEdit({...edit,name:event.target.value})}/></label>
      <div className="form-row"><label>类型<select disabled={!!edit.id} value={edit.type} onChange={event=>setEdit({...edit,type:event.target.value as Draft['type']})}>{['MA','EMA','RSI','CODE'].map(value=><option value={value} key={value}>{value==='CODE'?'自定义 Python':value}</option>)}</select></label><label>研究周期<select value={edit.period} onChange={event=>setEdit({...edit,period:event.target.value as Draft['period']})}><option value="day">日线</option><option value="week">周线</option><option value="month">月线</option></select></label></div>
      {edit.type==='CODE'?<><label>预热目标（根 K 线）<input type="number" min="2" max="500" required value={edit.lookback} onChange={event=>setEdit({...edit,lookback:Number(event.target.value)})}/></label><p className="fine muted">定义 CustomStrategy(StrategyBase)，实现 on_bar(self, history)，返回 Signal.BUY、Signal.SELL 或 Signal.HOLD。history 只包含当前及以前已完成的 K 线；每根 K 线有 time、session_date、end_session_date、open、high、low、close、volume。支持 math，不支持 import。仅运行你信任的代码。</p><label>Python 代码<textarea className="strategy-code" spellCheck={false} maxLength={20000} required value={edit.source} onChange={event=>setEdit({...edit,source:event.target.value})}/></label></>:<div className="form-row">{(edit.type==='RSI'?['fast','lower','upper']:['fast','slow']).map(key=><label key={key}>{{fast:'短周期 / RSI 窗口',slow:'长周期',lower:'超卖阈值',upper:'超买阈值'}[key]}<input type="number" min={key==='lower'||key==='upper'?1:2} max={key==='lower'||key==='upper'?99:key==='fast'?250:500} required value={edit[key as 'fast']} onChange={event=>setEdit({...edit,[key]:Number(event.target.value)})}/></label>)}</div>}
      <label>说明<textarea value={edit.description} onChange={event=>setEdit({...edit,description:event.target.value})}/></label>
      {save.error&&<p className="error">{save.error.message}</p>}
      <button className="btn primary full" disabled={save.isPending}>{save.isPending?'正在保存…':'保存策略'}</button>
    </form></div>}
  </>;
}
