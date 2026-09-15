const {test}=require('node:test');
const assert=require('node:assert/strict');
const research=require('../dist/research.js');
const result={index:'csi300',start:'2025-01-01',end:'2026-09-10',capital:100000,return:12,drawdown:8,fee:.03,slippage:.05,strategy:{name:'趋势策略',version:1,type:'MA',period:'day',fast:20,slow:60}};
const data={indices:[{id:'csi300',name:'沪深 300',code:'000300'}],backtest:result};
test('backtest explanation snapshots result and retains it for follow-up',()=>{
 const reply=research.buildReply('解读回测，说明收益、回撤与后续验证方向',{},data);
 assert.match(reply.text,/12.00%/);assert.match(reply.text,/112,000.00/);
 assert.match(reply.text,/不能判断是否跑赢/);
 const updated={...result,return:99,strategy:{...result.strategy,fast:5}};
 const follow=research.buildReply('收益呢',reply.context,{...data,backtest:updated});
 assert.equal(follow.context.backtestSnapshot.return,12);assert.equal(follow.context.backtestSnapshot.strategy.fast,20);
 assert.notStrictEqual(reply.context.backtestSnapshot,result);
 const restored=JSON.parse(JSON.stringify(follow.context));
 assert.match(research.buildReply('回撤说明什么',restored,data).text,/不等于最终亏损/);
 assert.match(research.buildReply('手续费呢',restored,data).text,/未逐笔计算/);
});
test('backtest request without results asks user to run one',()=>{
 assert.match(research.buildReply('解释回测',{}, {...data,backtest:null}).text,/还没有/);
});
