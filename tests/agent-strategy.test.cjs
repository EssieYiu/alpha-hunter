const {test}=require('node:test');
const assert=require('node:assert/strict');
const research=require('../dist/research.js');
const data={indices:[{id:'dividend',name:'中证红利',code:'000922',value:5000,change:.5}],selected:'dividend',watch:[],account:{cash:0,positions:[]},products:[]};
test('strategy research retains parameters through follow-up and creates only on request',()=>{
 const first=research.buildReply('研究策略：EMA 10/40 周线',{},data);
 assert.equal(first.strategyDraft.type,'EMA');assert.equal(first.strategyDraft.fast,10);assert.equal(first.strategyDraft.slow,40);assert.equal(first.strategyDraft.period,'week');assert.equal(first.createStrategy,false);
 const follow=research.buildReply('短周期改为 15',first.context,data);assert.equal(follow.strategyDraft.fast,15);assert.equal(follow.strategyDraft.slow,40);
 assert.equal(research.buildReply('创建此策略',follow.context,data).createStrategy,true);
 assert.equal(research.buildReply('先不要创建',follow.context,data).createStrategy,false);
 const invalid=research.buildReply('短周期改为 80',follow.context,data);assert.equal(invalid.strategyDraft,null);assert.match(invalid.text,/短周期/);
 const fixed=research.buildReply('长周期改为 100',invalid.context,data);assert.equal(fixed.strategyDraft.slow,100);assert.equal(fixed.strategyDraft.fast,80);
});
test('RSI thresholds and explicit portfolio switching remain supported',()=>{
 const r=research.buildReply('研究策略 RSI 25/75 日线',{},data);assert.equal(r.strategyDraft.lower,25);assert.equal(r.strategyDraft.upper,75);
 assert.equal(research.buildReply('查看账户',r.context,data).context.topic,'portfolio');
});
