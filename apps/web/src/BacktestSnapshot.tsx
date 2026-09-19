import type {Run} from './api';
import './BacktestSnapshot.css';

export function BacktestSnapshot({run}:{run:Run}){
  const result=run.result;
  if(!result)return null;
  const strategy=result.strategy_snapshot;
  const dataHash=typeof result.data_hash==='string'?result.data_hash:null;
  const asOf=typeof result.as_of==='string'?result.as_of:null;
  const warnings=Array.isArray(result.warnings)
    ?result.warnings.filter((item):item is string=>typeof item==='string'):[];
  return <div className="data-note backtest-snapshot">
    策略快照：{strategy.name} · v{strategy.version}<br/>
    结果 ID：{run.id}<br/>
    行情来源：{result.provider||'未知'}{asOf&&` · 截至 ${asOf}`}
    {dataHash&&<><br/>行情 SHA-256：<code>{dataHash}</code></>}
    {warnings.map((warning,index)=><p key={index}>{warning}</p>)}
    {strategy.type==='CODE'&&strategy.source&&<details><summary>查看本次回测使用的策略代码</summary><pre>{strategy.source}</pre></details>}
  </div>;
}
