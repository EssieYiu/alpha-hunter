export type ProviderId = 'openai' | 'anthropic' | 'dashscope' | 'tokenplan' | 'deepseek' | 'minimax' | 'custom';

export type ModelConfig = {
  provider: ProviderId;
  model: string;
  base_url: string;
  api_key: string;
};

export const providers: Record<ProviderId, {name: string; url: string; model: string; examples: string[]; note?: string}> = {
  openai: {name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-5.5', examples: ['gpt-5.5']},
  anthropic: {name: 'Anthropic', url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5', examples: ['claude-sonnet-5', 'claude-opus-5'], note: '通过原生 Messages API 调用，需 Anthropic API Key。'},
  dashscope: {name: '阿里云百炼 DashScope', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', examples: ['qwen-plus', 'qwen-max'], note: '默认北京地域。API Key 与所选地域必须一致。'},
  tokenplan: {name: '百炼 Token Plan（此场景不可用）', url: '', model: '', examples: [], note: '官方限定用于交互式编程工具，不支持本项目的后台 Agent 服务。请使用百炼 DashScope 按量付费 API。'},
  deepseek: {name: 'DeepSeek', url: 'https://api.deepseek.com', model: 'deepseek-flash', examples: ['deepseek-flash', 'deepseek-v4-pro']},
  minimax: {name: 'MiniMax', url: 'https://api.minimax.cn/v1', model: 'MiniMax-M3', examples: ['MiniMax-M3'], note: '当前 Agent 支持 MiniMax-M3。默认中国区；国际区可选用对应接口地址。'},
  custom: {name: '自定义 OpenAI 兼容服务', url: '', model: '', examples: [], note: '自定义地址需先加入服务器 AGENT_ALLOWED_BASE_URLS 允许列表。'},
};

export const providerIds: ProviderId[] = ['openai', 'anthropic', 'dashscope', 'tokenplan', 'deepseek', 'minimax', 'custom'];

export const endpointOptions: Partial<Record<ProviderId, {label: string; url: string}[]>> = {
  dashscope: [
    {label: '北京', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1'},
    {label: '新加坡', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'},
    {label: '美国', url: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1'},
    {label: '香港', url: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1'},
  ],
  minimax: [
    {label: '中国区', url: 'https://api.minimax.cn/v1'},
    {label: '国际区', url: 'https://api.minimax.io/v1'},
  ],
};

export function selectProvider(current: ModelConfig, provider: ProviderId): ModelConfig {
  if (provider === current.provider || provider === 'tokenplan') return current;
  const preset = providers[provider];
  return {provider, model: preset.model, base_url: preset.url, api_key: ''};
}
