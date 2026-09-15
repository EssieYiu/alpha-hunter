const {test}=require('node:test');
const assert=require('node:assert/strict');
const research=require('../dist/research.js');
const indices=[{id:'csi300',name:'沪深 300',code:'000300',value:4126,change:1.2,signal:'持有观察',risk:'中'},{id:'hstech',name:'恒生科技',code:'HSTECH',value:5432,change:1.9,signal:'入场条件满足',risk:'高'}];
const data={indices,selected:'csi300',watch:['hstech'],account:{cash:12345,positions:[]},products:[]};
const strategy={name:'测试策略',type:'MA',period:'day',fast:20,slow:60,lower:30,upper:70,version:1};

test('follow-up risk question retains index context rather than global selection',()=>{
  const first=research.buildReply('分析恒生科技',{},data);
  const follow=research.buildReply('它的风险呢？',first.context,data);
  assert.equal(follow.context.indexId,'hstech');assert.match(follow.text,/恒生科技/);assert.match(follow.text,/风险等级/);
  const changed=research.buildReply('那沪深300呢',follow.context,data);assert.equal(changed.context.indexId,'csi300');
});
test('portfolio follow-up keeps account context and fetches updated cash',()=>{
  const first=research.buildReply('看看持仓',{},data);
  const next=research.buildReply('详细一点',first.context,{...data,account:{cash:500,positions:[]}});
  assert.equal(next.tools.name,'get_portfolio');assert.match(next.text,/500.00/);
});
test('strategy validation rejects invalid periods, crossing parameters and RSI thresholds',()=>{
  assert.equal(research.validateStrategy(strategy),'');
  for(const patch of [{name:''},{fast:60,slow:20},{fast:2.5},{slow:251},{period:'minute'},{type:'RSI',lower:80,upper:20},{type:'RSI',lower:NaN},{type:'RSI',upper:100}])assert.notEqual(research.validateStrategy({...strategy,...patch}),'');
  assert.equal(research.validateStrategy({...strategy,type:'RSI',lower:25,upper:75}),'');
});
test('backtest records an independent strategy snapshot and responds to strategy parameters',()=>{
  const draft={index:'csi300',start:'2025-01-01',end:'2026-09-10',capital:100000,fee:.03,slippage:.05};
  const original={...strategy};const result=research.demoResult(original,draft);original.fast=5;
  assert.equal(result.strategy.fast,20);assert.equal(result.strategy.version,1);
  assert.notEqual(research.demoResult(original,draft).return,result.return);
  assert.notEqual(research.demoResult({...strategy,type:'RSI'},draft).return,result.return);
});
test('saved conversations and custom strategies restore without persisting configuration keys',()=>{
  const entries={'ah-conversations-v1':JSON.stringify([{id:'test-chat',title:'既有研究',updatedAt:'2026-09-12',messages:[{role:'user',text:'上次的问题'}],context:{indexId:'hstech'}}]),'ah-strategies-v1':JSON.stringify([{...strategy,id:'custom-test'}])};
  global.localStorage={getItem:k=>entries[k]||null,setItem:(k,v)=>entries[k]=v};
  research.init({config:{key:'not-for-storage'}},{title:()=>'',indices});
  assert.match(research.agentPage(),/既有研究/);assert.match(research.agentPage(),/上次的问题/);assert.match(research.strategyPage(),/测试策略/);
  assert.ok(!JSON.stringify(entries).includes('not-for-storage'));delete global.localStorage;
});
