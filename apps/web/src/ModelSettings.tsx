import {endpointOptions, providerIds, providers, selectProvider, type ModelConfig, type ProviderId} from './modelProviders';
import './modelSettings.css';

export function ModelSettings({config, onChange, onClose}: {
  config: ModelConfig;
  onChange: (config: ModelConfig) => void;
  onClose: () => void;
}) {
  const provider = providers[config.provider];
  const endpoints = endpointOptions[config.provider];
  return <div className="overlay" onMouseDown={event => {if (event.target === event.currentTarget) onClose()}}>
    <section className="modal model-settings" role="dialog" aria-modal="true" aria-label="模型与 API 设置">
      <div className="row"><h2>模型与 API 设置</h2><button className="btn" onClick={onClose}>关闭</button></div>
      <p>选择模型提供商，填写对应的 API Key。Key 仅保存在当前页面内存，刷新即清除。</p>
      <label>模型提供商
        <select value={config.provider} onChange={event => onChange(selectProvider(config, event.target.value as ProviderId))}>
          {providerIds.map(id => <option key={id} value={id} disabled={id === 'tokenplan'}>{providers[id].name}</option>)}
        </select>
      </label>
      <p className="model-provider-note">百炼 Token Plan 仅供交互式编程工具使用，当前 Agent 请选 DashScope 按量付费 API。<a href="https://help.aliyun.com/en/model-studio/base-url" target="_blank" rel="noreferrer">查看官方说明 ↗</a></p>
      {provider.note && <p className="model-provider-note">{provider.note}</p>}
      {endpoints ? <label>接口地域
        <select value={config.base_url} onChange={event => onChange({...config, base_url: event.target.value, api_key: ''})}>
          {endpoints.map(endpoint => <option key={endpoint.url} value={endpoint.url}>{endpoint.label} · {endpoint.url}</option>)}
        </select>
      </label> : <label>API 地址
        <input value={config.base_url} readOnly={config.provider !== 'custom'} placeholder="https://your-model.example/v1" onChange={event => onChange({...config, base_url: event.target.value})}/>
      </label>}
      <label>模型 ID
        <input value={config.model} list="agent-model-examples" placeholder="填写服务支持的模型 ID" onChange={event => onChange({...config, model: event.target.value})}/>
        <datalist id="agent-model-examples">{provider.examples.map(model => <option key={model} value={model}/>)}</datalist>
      </label>
      <label>API Key
        <input type="password" autoComplete="off" value={config.api_key} onChange={event => onChange({...config, api_key: event.target.value})}/>
      </label>
      <button className="btn primary" onClick={onClose}>完成</button>
    </section>
  </div>;
}
