/* Local prototype: shared conversations, parameterized strategies and demo backtests. */
const Research = (() => {
  const CHAT_KEY='ah-conversations-v1', STRATEGY_KEY='ah-strategies-v1';
  const uid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const defaults=[
    {id:'ma-trend',name:'双均线趋势策略',type:'MA',period:'day',fast:20,slow:60,lower:30,upper:70,description:'用短长均线交叉跟踪趋势。',version:1,builtin:true},
    {id:'rsi-rebound',name:'RSI 区间策略',type:'RSI',period:'day',fast:12,slow:26,lower:30,upper:70,description:'观察 RSI 从低位回升与高位回落。',version:1,builtin:true}
  ];
  const periods={day:'日线',week:'周线',month:'月线'};
  let s,api,conversations=[],strategies=[],activeId=null,drawerOpen=false,editing=null;
  let drafts={},pending=new Set(),storageError='',chatSearch='';
  const html=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function load(key,fallback){try{const value=JSON.parse(localStorage.getItem(key));return Array.isArray(value)?value:fallback;}catch{return fallback;}}
  function save(){
    try{localStorage.setItem(CHAT_KEY,JSON.stringify(conversations));localStorage.setItem(STRATEGY_KEY,JSON.stringify(strategies));storageError='';}
    catch{storageError='浏览器存储不可用，本次变更仅保留到刷新前。';}
  }
  function init(state,dependencies){
    s=state;api=dependencies;
    conversations=load(CHAT_KEY,[]).filter(c=>c&&typeof c.id==='string'&&typeof c.title==='string'&&Array.isArray(c.messages));
    strategies=load(STRATEGY_KEY,defaults.map(x=>({...x}))).filter(x=>x&&typeof x.id==='string'&&!validateStrategy(x));
    if(!strategies.length)strategies=defaults.map(x=>({...x}));
    activeId=conversations[0]?.id||null;s.strategyId=strategies[0].id;
    s.backtestDraft={index:'csi300',start:'2025-01-01',end:'2026-09-10',capital:100000,fee:.03,slippage:.05};
  }
  function current(){return conversations.find(c=>c.id===activeId);}
  function createConversation(){const c={id:uid(),title:'新对话',updatedAt:new Date().toISOString(),messages:[],context:{}};conversations.unshift(c);activeId=c.id;save();return c;}
  function history(){
    const list=conversations.filter(c=>c.title.toLowerCase().includes(chatSearch.toLowerCase()));
    return `<section class="conversation-history" aria-label="历史对话"><div class="history-heading"><h2>历史对话</h2><button type="button" class="btn small" data-new-conversation>＋ 新对话</button></div><label class="history-search"><input type="search" data-history-search value="${html(chatSearch)}" placeholder="搜索对话标题" aria-label="搜索对话历史"></label><div class="conversation-list">${list.length?list.map(c=>`<button type="button" data-conversation="${html(c.id)}" class="conversation-item ${c.id===activeId?'selected':''}" aria-pressed="${c.id===activeId}"><strong>${html(c.title)}</strong><span>${c.messages.filter(m=>m.role==='user').length} 轮对话 · ${html(c.updatedAt?.slice(0,10)||'')}${pending.has(c.id)?' · 回复中':''}</span></button>`).join(''):`<p class="history-empty">${chatSearch?'没有匹配的对话':'还没有历史对话。发送一个问题，开始研究。'}</p>`}</div><p class="history-foot">对话仅保存在此浏览器，刷新后可继续。</p></section>`;
  }
  function chatSurface(compact=false){
    const c=current(),busy=c&&pending.has(c.id);
    return `<section class="panel conversation-chat"><div class="chat-header"><span class="agent-avatar">✧</span><div><strong>${html(c?.title||'Alpha 研究助手')}</strong><small>演示模式 · 可沿用本轮研究对象继续提问</small></div></div><div class="conversation-messages" role="log" aria-label="${compact?'侧栏':'页面'}聊天记录" aria-live="polite">${c?.messages.length?c.messages.map(m=>`<div class="message ${m.role==='user'?'user':'assistant'}"><span class="message-avatar">${m.role==='user'?'你':'✧'}</span><div>${m.tools?`<details class="tool-result"><summary>✓ ${html(m.tools.name)} · 本地演示工具</summary><pre>${html(m.tools.result)}</pre></details>`:''}<div class="bubble">${html(m.text).replace(/\n/g,'<br>')}</div>${m.strategyDraft?strategyProposal(m,c):''}${m.role==='assistant'?'<small>本地演示回答 · 未连接大模型</small>':''}</div></div>`).join(''):`<div class="chat-welcome"><div class="big-icon">✧</div><h2>${c?.context?.topic==='strategy'?'把你的策略想法告诉我':'今天想研究什么？'}</h2><p>${c?.context?.topic==='strategy'?'可以描述趋势跟踪或反弹思路，指定 MA、EMA、RSI 参数与日 / 周 / 月周期。草案可继续修改，然后创建到策略管理。':'从行情、信号或持仓开始，下一轮可以继续问“它的风险呢？”'}</p><div class="suggestions">${(c?.context?.topic==='strategy'?['研究策略：EMA 10/40 周线','研究策略：RSI 25/75 日线','研究策略：MA 20/60 日线']:['分析沪深 300 的策略信号','查看我的模拟持仓','查看我的自选指数']).map(t=>`<button type="button" data-research-prompt="${t}">${t} ↗</button>`).join('')}</div></div>`}${busy?'<p class="thinking">正在读取演示工具…</p>':''}</div><form class="chat-input" data-conversation-form><input name="message" maxlength="2000" value="${html(drafts[activeId||'new']||'')}" placeholder="继续提问…" aria-label="${compact?'侧栏':'页面'}聊天消息" required autocomplete="off"><button class="btn primary" ${busy?'disabled':''}>发送 ↑</button></form><p class="chat-disclaimer">行情与回答均为演示；不会执行交易。请勿在聊天中输入 API Key。</p></section>`;
  }
  function strategyProposal(m,c){
    return '<div class="strategy-rule"><strong>'+html(m.strategyDraft.name)+'</strong><p>'+html(periods[m.strategyDraft.period]+' · '+rules(m.strategyDraft))+'</p>'+(m.createdStrategyId?'<span>✓ 已创建并保存到策略管理</span><button class="btn small" data-agent-backtest="'+html(m.createdStrategyId)+'" data-agent-index="'+html(c.context?.indexId||'')+'">进入回测 ↗</button>':'<button class="btn primary small" data-create-proposal="'+c.messages.indexOf(m)+'" data-proposal-conversation="'+html(c.id)+'">创建此策略</button>')+'</div>';
  }
  function createFromMessage(m,c){
    if(m.createdStrategyId||!m.strategyDraft||validateStrategy(m.strategyDraft))return;
    const v={...m.strategyDraft,id:uid(),version:1,builtin:false,source:'agent'};
    const base=v.name;let n=2;while(strategies.some(x=>x.name.toLowerCase()===v.name.toLowerCase()))v.name=base.slice(0,40)+' ('+(n++)+')';
    strategies.unshift(v);s.strategyId=v.id;m.createdStrategyId=v.id;
    m.tools={name:'create_strategy',result:JSON.stringify({id:v.id,name:v.name,rule:rules(v),storage:'浏览器本地'},null,2)};
    m.text+='\n已创建「'+v.name+'」，可在策略管理中编辑或进入演示回测。';save();
  }
  function workspace(){return `${storageError?`<p role="alert" class="form-error">${html(storageError)}</p>`:''}<div class="conversation-workspace">${history()}${chatSurface()}</div>`;}
  function agentPage(){return `${api.title('RESEARCH AGENT','研究可以接着聊','选择历史对话，继续之前的研究。','<button class="btn" data-action="settings">⚙ 模型设置</button>')}<div id="agent-workspace">${workspace()}</div>`;}
  function orb(){return `<button type="button" id="agent-orb" class="agent-orb" aria-label="打开 Agent 对话框" aria-expanded="${drawerOpen}" aria-controls="agent-drawer"><span>✧</span></button>`;}
  function drawer(){return drawerOpen?`<div class="drawer-backdrop" data-close-drawer></div><section id="agent-drawer" class="agent-drawer" role="dialog" aria-modal="true" aria-label="Agent 侧栏对话"><div class="drawer-heading"><div><span class="eyebrow">ALPHA ASSISTANT</span><h2>随时聊一聊</h2></div><button type="button" class="icon-btn" data-close-drawer aria-label="关闭 Agent 对话框">×</button></div><div class="drawer-actions"><button type="button" class="btn small" data-new-conversation>＋ 新对话</button><button type="button" class="text-btn" data-full-agent>查看全部历史 ↗</button></div><label class="drawer-session-label">当前对话<select data-drawer-conversation aria-label="选择侧栏历史对话"><option value="" ${!activeId?'selected':''} disabled>开始新对话</option>${conversations.map(c=>`<option value="${html(c.id)}" ${c.id===activeId?'selected':''}>${html(c.title)}</option>`).join('')}</select></label>${storageError?`<p role="alert" class="form-error">${html(storageError)}</p>`:''}${chatSurface(true)}</section>`:'';}
  function focusInput(){document.querySelector(drawerOpen?'#agent-drawer [name="message"]':'#agent-workspace [name="message"]')?.focus();}
  function refreshChat(focus=false){
    const workspaceEl=document.getElementById('agent-workspace');if(workspaceEl)workspaceEl.innerHTML=workspace();
    const host=document.getElementById('agent-drawer-root');
    const alreadyOpen=Boolean(host?.querySelector('#agent-drawer'));
    if(host){host.innerHTML=drawer();if(alreadyOpen&&drawerOpen)host.querySelector('#agent-drawer').style.animation='none';}
    const ball=document.getElementById('agent-orb');if(ball)ball.setAttribute('aria-expanded',String(drawerOpen));
    document.querySelectorAll('#app > aside,#app > main').forEach(el=>{el.inert=drawerOpen;});
    document.body.classList.toggle('drawer-is-open',drawerOpen);
    bindChat();
    document.querySelectorAll('.conversation-messages').forEach(el=>el.scrollTop=el.scrollHeight);
    if(focus)focusInput();
  }
  function open(){drawerOpen=true;refreshChat(true);}
  function close(){drawerOpen=false;refreshChat();document.getElementById('agent-orb')?.focus();}
  function researchStrategy(text,previous={}){
    const v={name:'Agent 双均线研究策略',type:'MA',period:'day',fast:20,slow:60,lower:30,upper:70,description:'演示研究假设：用均线交叉观察趋势，震荡行情可能反复触发。',...previous};
    if(/RSI|超卖|反弹/i.test(text))v.type='RSI';else if(/EMA/i.test(text))v.type='EMA';else if(/MA|均线/i.test(text))v.type='MA';
    if(/周线/.test(text))v.period='week';else if(/月线/.test(text))v.period='month';else if(/日线/.test(text))v.period='day';
    const pair=text.match(/(?:MA|EMA)?\s*(\d+)\s*[/、，,和]\s*(?:MA|EMA)?\s*(\d+)/i);
    if(pair){if(v.type==='RSI'){v.lower=+pair[1];v.upper=+pair[2];}else{v.fast=+pair[1];v.slow=+pair[2];}}
    for(const [key,pattern] of Object.entries({fast:/短周期\s*(?:改为|设为|为|=|：)?\s*(\d+)/,slow:/长周期\s*(?:改为|设为|为|=|：)?\s*(\d+)/,lower:/下限\s*(?:改为|设为|为|=|：)?\s*(\d+)/,upper:/上限\s*(?:改为|设为|为|=|：)?\s*(\d+)/})){const match=text.match(pattern);if(match)v[key]=+match[1];}
    const name=text.match(/(?:命名为|名称为|叫做)[“"「]?([^”"」\n，。]{1,48})/);
    v.name=name?name[1].trim():previous.name||('Agent '+(v.type==='RSI'?'RSI 区间':v.type+' 双均线')+'研究策略');
    v.description=v.type==='RSI'?'演示研究假设：观察超卖后反弹，单边下跌中可能连续亏损。':'演示研究假设：跟踪趋势，震荡行情可能反复触发；更长周期通常反应更慢。';
    return v;
  }
  function explainBacktest(text,result,indices){
    const r=JSON.parse(JSON.stringify(result));
    const name=indices.find(i=>i.id===r.index)?.name||r.index;
    const money=n=>Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
    const amount=Number(r.capital)*Number(r.return)/100;
    const intro='解读已保存的回测快照：'+r.strategy.name+' · v'+r.strategy.version+'\n'+name+' · '+r.start+' 至 '+r.end+'\n'+periods[r.strategy.period]+' · '+rules(r.strategy);
    const summary='累计收益 '+money(r.return)+'%，对应模拟盈亏 ¥ '+money(amount)+'；初始资金 ¥ '+money(r.capital)+'，期末资产 ¥ '+money(Number(r.capital)+amount)+'。这不是年化收益。';
    const risk='最大回撤 '+money(r.drawdown)+'% 表示净值从阶段高点到后续低点的最大跌幅，不等于最终亏损，也不能直接按初始资金换算最大亏损金额。当前缺少真实净值序列，无法判断回撤发生日期及修复时间。';
    const cost='本次配置手续费 '+r.fee+'%、滑点 '+r.slippage+'%。演示公式会随成本参数变化，但未逐笔计算成交，无法归因收益变化或核算实际总费用。';
    const validation='下一步可做：用真实历史数据验证，比较相同区间的买入持有收益；保留样本外区间；检查不同市场阶段和相邻参数的表现。当前没有基准收益、逐笔交易、胜率或夏普比率，不能判断是否跑赢基准，也不能据此推荐实盘使用。';
    const overview=summary+'\n'+risk+'\n'+cost+'\n'+validation;
    const detail=/解读回测|解释回测|全面|总结|整体/.test(text)?overview:/回撤|风险|亏损/.test(text)?risk:/手续费|滑点|成本/.test(text)?cost:/优化|改进|有效|基准|跑赢|胜率|夏普/.test(text)?validation:summary+'\n'+risk+'\n'+cost+'\n'+validation;
    return {context:{topic:'backtest',indexId:r.index,backtestSnapshot:r},tools:{name:'get_backtest_result',result:JSON.stringify(r,null,2)},text:intro+'\n\n'+detail+'\n\n以上数值来自参数映射演示，曲线为示意图，未执行真实历史回测；本地 Agent 未连接大模型。解读绑定此快照，之后修改参数或重新运行不会改变这段历史对话。'};
  }
  function buildReply(text,context,data){
    if(/回测|累计收益|最大回撤/.test(text)||(context.topic==='backtest'&&!/持仓|账户|自选|研究策略|创建策略|新增策略|策略信号/.test(text))){
      const result=context.backtestSnapshot||data.backtest;
      if(result?.strategy)return explainBacktest(text,result,data.indices);
      return {context:{...context,topic:'backtest'},text:'还没有可解读的回测结果。请先在策略回测页面运行演示回测，再点击“让 Agent 解读”。'};
    }
    const compact=text.replace(/\s/g,'');
    const explicit=data.indices.find(i=>compact.includes(i.name.replace(/\s/g,''))||compact.toUpperCase().includes(i.code));
    let topic=explicit?'index':/持仓|账户|现金|成本|盈亏/.test(text)?'portfolio':/自选|关注/.test(text)?'watchlist':context.topic||'index';
    const i=explicit||data.indices.find(x=>x.id===context.indexId)||data.indices.find(x=>x.id===data.selected)||data.indices[0];
    const next={topic,indexId:i.id};
    if(/研究策略|设计策略|新增策略|创建策略|保存策略|策略研究|均线策略|RSI策略/i.test(text)||(context.topic==='strategy'&&!/持仓|账户|自选|策略信号/.test(text))){
      const draft=researchStrategy(text,context.strategyDraft),error=validateStrategy(draft);
      return {context:{topic:'strategy',indexId:i.id,strategyDraft:draft},strategyDraft:error?null:draft,createStrategy:!error&&/创建|新增|保存/.test(text)&&!/不要|先不|别|暂不/.test(text),tools:{name:'research_strategy',result:JSON.stringify({index:i.name,source:'本地规则模板，未查询真实行情或运行回测',draft},null,2)},text:error?'参数尚不能使用：'+error+' 请调整后继续。':'针对 '+i.name+' 的策略研究草案：\n'+periods[draft.period]+' · '+rules(draft)+'\n'+draft.description+'\n验证计划：对比买入持有，检查交易成本、最大回撤及不同市场阶段，保留样本外区间。\n这只是本地模板推演，未完成真实数据研究。可以继续说“改成周线”“短周期改为 10”，或点击下方按钮创建策略。当前只支持 MA、EMA、RSI 参数规则，其他条件不会自动执行。'};
    }
    if(topic==='portfolio'){
      const rows=data.account.positions.map(p=>`${data.products.find(x=>x.ticker===p.ticker)?.name||p.ticker}：${p.qty} 份，平均成本 ${p.cost.toFixed(3)}`);
      return {context:next,tools:{name:'get_portfolio',result:JSON.stringify(data.account,null,2)},text:`${context.topic==='portfolio'?'继续看刚才的模拟账户。\n':''}可用现金 ¥ ${data.account.cash.toFixed(2)}。\n${rows.join('\n')||'暂无持仓。'}\n这些是本地记账数据，估值也是演示值。可以继续问持仓成本，或明确指定要研究的指数。`};
    }
    if(topic==='watchlist'){
      const names=data.watch.map(id=>data.indices.find(x=>x.id===id)?.name).filter(Boolean);
      return {context:next,tools:{name:'get_watchlist',result:JSON.stringify(names)},text:`当前自选：${names.join('、')||'暂无自选'}。\n可以指定其中一个指数继续问趋势或风险。`};
    }
    const follow=!explicit&&context.topic==='index';
    const risk=/风险|为什么|原因/.test(text);
    return {context:next,tools:{name:'get_index_signal',result:JSON.stringify({index:i.name,close:i.value,change:i.change,signal:i.signal,risk:i.risk,source:'合成演示数据',as_of:'2026-09-10'},null,2)},text:`${follow?'沿用上一轮的研究对象：':''}${i.name}。\n${risk?`示例风险等级为「${i.risk}」。均线信号可能滞后，震荡时也可能反复触发，需要结合回撤和持仓比例判断。这个风险标签是演示配置，不是实时评估。`:`演示点位 ${i.value.toFixed(2)}，涨跌幅 ${i.change}%。当前固定示例信号为「${i.signal}」。`}\n${risk?'可在策略管理中设置参数，再进入演示回测。':'可以继续问“它的风险呢？”，或指定其他指数。'}\n当前使用本地多轮演示逻辑，未调用大模型，也不构成真实买卖建议。`};
  }
  function send(text){
    text=String(text||'').trim().slice(0,2000);if(!text)return;
    const c=current()||createConversation();if(pending.has(c.id))return;
    if(!c.messages.length)c.title=text.slice(0,24);
    c.messages.push({role:'user',text});c.updatedAt=new Date().toISOString();
    conversations=[c,...conversations.filter(x=>x.id!==c.id)];drafts[c.id]='';drafts.new='';pending.add(c.id);save();refreshChat(true);
    const response=buildReply(text,c.context||{},{indices:api.indices,products:api.products,account:s.account,selected:s.selected,watch:s.watch,backtest:s.backtest});
    setTimeout(()=>{
      c.context=response.context;const message={role:'assistant',text:response.text,tools:response.tools,strategyDraft:response.strategyDraft};c.messages.push(message);if(response.createStrategy)createFromMessage(message,c);c.updatedAt=new Date().toISOString();pending.delete(c.id);save();
      // Reply belongs to its original conversation, even if a different one is now open.
      const focused=document.activeElement,continueTyping=focused?.name==='message',cursor=continueTyping?focused.selectionStart:null;
      refreshChat(continueTyping);if(cursor!==null)document.activeElement?.setSelectionRange?.(cursor,cursor);
    },450);
  }
  function bindChat(){
    document.querySelectorAll('[data-create-proposal]').forEach(b=>b.onclick=()=>{const c=conversations.find(c=>c.id===b.dataset.proposalConversation);const m=c?.messages[Number(b.dataset.createProposal)];if(!m)return;createFromMessage(m,c);api.render();});
    document.querySelectorAll('[data-agent-backtest]').forEach(b=>b.onclick=()=>{s.strategyId=b.dataset.agentBacktest;if(api.indices.some(i=>i.id===b.dataset.agentIndex))s.backtestDraft.index=b.dataset.agentIndex;drawerOpen=false;s.page='backtest';api.render();});
    document.querySelectorAll('[data-close-drawer]').forEach(b=>b.onclick=close);
    document.querySelectorAll('[data-new-conversation]').forEach(b=>b.onclick=()=>{createConversation();chatSearch='';refreshChat(true);});
    document.querySelectorAll('[data-conversation]').forEach(b=>b.onclick=()=>{activeId=b.dataset.conversation;refreshChat(true);});
    document.querySelectorAll('[data-drawer-conversation]').forEach(b=>b.onchange=()=>{activeId=b.value;refreshChat(true);});
    document.querySelectorAll('[data-full-agent]').forEach(b=>b.onclick=()=>{drawerOpen=false;s.page='agent';api.render();});
    document.querySelectorAll('[data-research-prompt]').forEach(b=>b.onclick=()=>send(b.dataset.researchPrompt));
    document.querySelectorAll('[data-history-search]').forEach(input=>input.oninput=()=>{const pos=input.selectionStart;chatSearch=input.value;refreshChat();const updated=document.querySelector('[data-history-search]');updated?.focus();updated?.setSelectionRange(pos,pos);});
    document.querySelectorAll('[data-conversation-form]').forEach(form=>{
      form.querySelector('input').oninput=e=>{drafts[activeId||'new']=e.target.value;};
      form.onsubmit=e=>{e.preventDefault();send(new FormData(form).get('message'));};
    });
  }
  function validateStrategy(v){
    if(!v.name?.trim()||v.name.trim().length>48)return '策略名称需为 1–48 个字符。';
    if(!['MA','EMA','RSI'].includes(v.type)||!periods[v.period])return '请选择支持的规则类型和周期。';
    if(v.type==='RSI'){
      if(!Number.isFinite(Number(v.lower))||!Number.isFinite(Number(v.upper))||v.lower<=0||v.upper>=100||Number(v.lower)>=Number(v.upper))return 'RSI 阈值需满足 0 < 下限 < 上限 < 100。';
    }else if(!Number.isInteger(Number(v.fast))||!Number.isInteger(Number(v.slow))||v.fast<2||v.slow>250||Number(v.fast)>=Number(v.slow))return '均线周期需为整数，且满足 2 ≤ 短周期 < 长周期 ≤ 250。';
    return '';
  }
  function rules(v){return v.type==='RSI'?`RSI14 上穿 ${v.lower} 时入场，下穿 ${v.upper} 时离场。`:`${v.type}${v.fast} 上穿 ${v.type}${v.slow} 时入场，下穿时离场。`;}
  function strategyPage(){return `${api.title('STRATEGY LIBRARY','我的策略','管理研究规则与参数，再把策略带到回测中验证。','<div class="actions"><button class="btn" data-agent-strategy>✧ Agent 研究策略</button><button class="btn primary" data-new-strategy>＋ 新增策略</button></div>')}<div class="strategy-overview"><strong>${strategies.length} 个策略</strong><span>参数化规则 · 本地保存</span><span>修改规则不会覆盖已运行的回测快照</span></div>${storageError?`<p role="alert" class="form-error">${html(storageError)}</p>`:''}<div class="strategy-grid">${strategies.map(v=>`<article class="panel strategy-card"><div class="row"><span class="strategy-type">${v.type==='RSI'?'RSI 区间':'均线趋势'}</span><span class="tag">${v.builtin?'内置':v.source==='agent'?'Agent 创建':'自建'} · v${v.version}</span></div><h2>${html(v.name)}</h2><p>${html(v.description||'暂无说明')}</p><div class="strategy-rule"><span>${periods[v.period]} · ${v.type==='RSI'?`RSI14 / ${v.lower}–${v.upper}`:`${v.type}${v.fast} / ${v.type}${v.slow}`}</span><strong>${html(rules(v))}</strong></div><div class="strategy-actions"><button class="btn primary" data-use-strategy="${html(v.id)}">用此策略回测 ↗</button><button class="btn" data-edit-strategy="${html(v.id)}">编辑</button><button class="text-btn" data-copy-strategy="${html(v.id)}">复制</button></div></article>`).join('')}</div><p class="note">新增策略使用 MA、EMA 或 RSI 规则模板，可自定义名称、周期和参数。此原型暂不执行策略代码，回测结果仍为参数联动演示。</p>`;}
  function strategyDialog(){
    const v=editing||{name:'',type:'MA',period:'day',fast:20,slow:60,lower:30,upper:70,description:''};
    return `<div class="overlay"><section class="modal strategy-modal" role="dialog" aria-modal="true" aria-labelledby="strategy-dialog-title"><div class="row"><h2 id="strategy-dialog-title">${v.id?'编辑策略':'新增策略'}</h2><button class="icon-btn" data-close aria-label="关闭策略编辑器">×</button></div><p>选择规则模板，或描述想法，让 Agent 帮你研究。</p><button type="button" class="btn full" data-agent-strategy>✧ 让 Agent 帮我研究策略</button><form id="strategy-form"><label>策略名称<input name="name" maxlength="48" value="${html(v.name)}" required></label><div class="form-row"><label>规则类型<select name="type" aria-label="规则类型">${[['MA','MA 双均线'],['EMA','EMA 双均线'],['RSI','RSI 区间']].map(([k,t])=>`<option value="${k}" ${v.type===k?'selected':''}>${t}</option>`).join('')}</select></label><label>研究周期<select name="period" aria-label="研究周期">${Object.entries(periods).map(([k,t])=>`<option value="${k}" ${v.period===k?'selected':''}>${t}</option>`).join('')}</select></label></div><div class="form-row" data-ma-fields ${v.type==='RSI'?'hidden':''}><label>短周期<input name="fast" type="number" min="2" max="249" value="${v.fast}" required ${v.type==='RSI'?'disabled':''}></label><label>长周期<input name="slow" type="number" min="3" max="250" value="${v.slow}" required ${v.type==='RSI'?'disabled':''}></label></div><div class="form-row" data-rsi-fields ${v.type!=='RSI'?'hidden':''}><label>入场上穿阈值<input name="lower" type="number" min="1" max="98" value="${v.lower}" required ${v.type!=='RSI'?'disabled':''}></label><label>离场下穿阈值<input name="upper" type="number" min="2" max="99" value="${v.upper}" required ${v.type!=='RSI'?'disabled':''}></label></div><label>策略说明<textarea name="description" maxlength="500" rows="3">${html(v.description)}</textarea></label><div class="note" id="strategy-rule-preview">${html(rules(v))}</div><p class="form-error" id="strategy-error" role="alert"></p><button class="btn primary full">保存策略</button></form></section></div>`;
  }
  function chosen(){return strategies.find(v=>v.id===s.strategyId)||strategies[0];}
  function backtestPage(){
    const v=chosen(),d=s.backtestDraft,r=s.backtest;
    return `${api.title('STRATEGY LAB','先验证，再做决定','选择已保存的策略，配置回测区间与交易成本。','<button class="btn" data-page="strategies">管理策略 ↗</button>')}<div class="backtest-layout"><form id="research-backtest-form" class="panel parameters"><h2>回测配置</h2><label>选择策略<select name="strategy" aria-label="选择策略">${strategies.map(v=>`<option value="${html(v.id)}" ${v.id===s.strategyId?'selected':''}>${html(v.name)} · v${v.version}</option>`).join('')}</select></label><div class="note selected-strategy"><strong>${periods[v.period]} · ${html(v.name)}</strong><p>${html(rules(v))}</p><button type="button" class="text-btn" data-edit-strategy="${html(v.id)}">编辑策略参数</button></div><label>研究指数<select name="index">${api.indices.map(i=>`<option value="${i.id}" ${i.id===d.index?'selected':''}>${i.name}</option>`).join('')}</select></label><div class="form-row"><label>开始日期<input name="start" type="date" value="${d.start}" required></label><label>结束日期<input name="end" type="date" value="${d.end}" max="2026-09-10" required></label></div><label>初始资金<input name="capital" type="number" min="1000" max="100000000" value="${d.capital}" required></label><div class="form-row"><label>手续费 (%)<input name="fee" type="number" min="0" max="5" step=".01" value="${d.fee}" required></label><label>滑点 (%)<input name="slippage" type="number" min="0" max="5" step=".01" value="${d.slippage}" required></label></div><p class="form-error" id="research-backtest-error" role="alert"></p><button class="btn primary full">运行演示回测 →</button><p class="fine muted">当前只展示参数联动结果，尚未执行真实历史回测。</p></form><section class="panel results">${r?.strategy?`<div class="panel-heading"><div><span class="eyebrow">DEMO RESULT</span><h2>${html(r.strategy.name)}</h2></div><div class="actions"><span class="tag">结果快照 v${r.strategy.version}</span><button type="button" class="btn primary small" data-explain-backtest>✧ 让 Agent 解读</button></div></div><p class="result-caption">${html(rules(r.strategy))} · ${periods[r.strategy.period]}</p>${JSON.stringify(r.strategy)!==JSON.stringify(v)?'<div class="note stale-result">这是上次运行的策略快照。当前选择或参数已改变，请重新运行。</div>':''}<div class="result-metrics"><div><span>演示累计收益</span><b class="${r.return>=0?'up':'down'}">${api.fmt(r.return)}%</b></div><div><span>演示最大回撤</span><b class="down">-${api.fmt(r.drawdown)}%</b></div><div><span>演示期末资产</span><b>¥ ${api.fmt(r.capital*(1+r.return/100),0)}</b></div></div><div class="chart-toolbar"><div class="legend"><i></i>策略净值 <i class="gray"></i>买入持有基准</div><span class="muted">示意曲线</span></div>${api.chart(r.seed,true)}<p class="result-caption">${html(api.indices.find(i=>i.id===r.index)?.name)} · ${r.start} 至 ${r.end}<br>初始资金 ${api.fmt(r.capital)} · 手续费 ${r.fee}% · 滑点 ${r.slippage}%<br>结果由参数映射生成，不用于判断策略有效性。</p>`:'<div class="result-empty"><div class="big-icon">⌁</div><h2>从你自己的策略开始</h2><p>可以选择已有策略，或先在策略管理中新增规则。</p><button class="btn" data-page="strategies">前往策略管理 ↗</button></div>'}</section></div>`;
  }
  function demoResult(strategy,d){
    const days=(Date.parse(d.end)-Date.parse(d.start))/86400000;
    const params=strategy.type==='RSI'?Number(strategy.lower)*.03+Number(strategy.upper)*.07:Number(strategy.fast)*.2+Number(strategy.slow)*.07;
    const seed=params+days*.001+Number(d.fee)*2+Number(d.slippage)*3+['MA','EMA','RSI'].indexOf(strategy.type)*1.7+['day','week','month'].indexOf(strategy.period)*.8+(api?.indices.findIndex(i=>i.id===d.index)||0);
    return {...d,capital:Number(d.capital),fee:Number(d.fee),slippage:Number(d.slippage),strategy:JSON.parse(JSON.stringify(strategy)),seed,return:Math.max(-95,(9+Math.sin(seed)*6)*days/365-Number(d.fee)*18-Number(d.slippage)*22),drawdown:5+Math.abs(Math.sin(seed+1))*8};
  }
  function afterRender(){
    document.getElementById('agent-orb').onclick=open;
    document.querySelectorAll('[data-explain-backtest]').forEach(b=>b.onclick=()=>{
      if(!s.backtest?.strategy)return;
      const c=createConversation();c.context={topic:'backtest',indexId:s.backtest.index,backtestSnapshot:JSON.parse(JSON.stringify(s.backtest))};
      save();open();send('解读回测：'+s.backtest.strategy.name+'，说明收益、回撤与后续验证方向');
    });
    refreshChat();
    document.querySelectorAll('[data-ask]').forEach(b=>b.onclick=()=>{open();send(b.dataset.ask);});
    document.querySelectorAll('[data-agent-strategy]').forEach(b=>b.onclick=()=>{
      const form=document.getElementById('strategy-form');
      const c=createConversation();c.context={topic:'strategy',indexId:s.selected};
      if(form){const v={fast:20,slow:60,lower:30,upper:70,...Object.fromEntries(new FormData(form))};if(v.name&&!validateStrategy(v))c.context.strategyDraft=v;}
      drafts[c.id]='请帮我研究策略：';save();s.dialog=null;drawerOpen=true;api.render();focusInput();
    });
    const edit=(v)=>{editing=v;s.dialog='strategy';api.render();};
    document.querySelectorAll('[data-new-strategy]').forEach(b=>b.onclick=()=>edit(null));
    document.querySelectorAll('[data-edit-strategy]').forEach(b=>b.onclick=()=>edit({...strategies.find(v=>v.id===b.dataset.editStrategy)}));
    document.querySelectorAll('[data-copy-strategy]').forEach(b=>b.onclick=()=>{const v={...strategies.find(v=>v.id===b.dataset.copyStrategy)};delete v.id;v.name=v.name.slice(0,40)+' 副本';v.builtin=false;edit(v);});
    document.querySelectorAll('[data-use-strategy]').forEach(b=>b.onclick=()=>{s.strategyId=b.dataset.useStrategy;s.page='backtest';api.render();});
    const form=document.getElementById('strategy-form');
    if(form){
      const draft=()=>({...editing,fast:20,slow:60,lower:30,upper:70,...Object.fromEntries(new FormData(form))});
      const preview=()=>{
        const isRSI=form.elements.type.value==='RSI';
        for(const [selector,hide] of [['[data-ma-fields]',isRSI],['[data-rsi-fields]',!isRSI]]){const fields=form.querySelector(selector);fields.hidden=hide;fields.querySelectorAll('input').forEach(i=>i.disabled=hide);}
        document.getElementById('strategy-rule-preview').textContent=rules(draft());
      };
      form.oninput=preview;form.onchange=preview;
      form.onsubmit=e=>{
        e.preventDefault();const v=draft();v.name=v.name.trim();for(const key of ['fast','slow','lower','upper'])v[key]=Number(v[key]);
        let error=validateStrategy(v);if(strategies.some(x=>x.id!==v.id&&x.name.toLowerCase()===v.name.toLowerCase()))error='此策略名称已存在，请使用不同名称。';
        if(error){document.getElementById('strategy-error').textContent=error;return;}
        v.version=(editing?.id?editing.version:0)+1;v.id=v.id||uid();v.builtin=Boolean(editing?.id&&editing.builtin);
        const old=strategies.findIndex(x=>x.id===v.id);if(old>=0)strategies[old]=v;else strategies.unshift(v);
        s.strategyId=v.id;save();s.dialog=null;api.render();api.toast(storageError||'策略已保存，可在回测中选择');
      };
    }
    const backtest=document.getElementById('research-backtest-form');
    if(backtest){
      const capture=()=>{const d=Object.fromEntries(new FormData(backtest));s.strategyId=d.strategy;delete d.strategy;s.backtestDraft=d;};
      backtest.oninput=capture;
      backtest.elements.strategy.onchange=()=>{capture();api.render();};
      backtest.onsubmit=e=>{e.preventDefault();capture();const d=s.backtestDraft;if(!Number.isFinite(Date.parse(d.start))||!Number.isFinite(Date.parse(d.end))||d.start>=d.end||d.end>'2026-09-10'){document.getElementById('research-backtest-error').textContent='请选择有效日期，开始需早于结束，结束不能晚于演示数据日期。';return;}s.backtest=demoResult(chosen(),d);api.render();api.toast('演示回测已完成');};
    }
    const oldKeyHandler=document.onkeydown;
    document.onkeydown=e=>{
      if(!drawerOpen){oldKeyHandler?.(e);return;}
      if(e.key==='Escape'){e.preventDefault();close();return;}
      if(e.key==='Tab'){
        const controls=[...document.querySelectorAll('#agent-drawer button,#agent-drawer input,#agent-drawer select,#agent-drawer summary')].filter(x=>!x.disabled);
        const first=controls[0],last=controls.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };
  }
  return {init,agentPage,orb,drawer,strategyPage,strategyDialog,backtestPage,afterRender,send,validateStrategy,rules,buildReply,demoResult,researchStrategy,explainBacktest};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=Research;
