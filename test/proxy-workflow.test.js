'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {ProxyWorkflow}=require('../src/proxy-workflow');
function setup(){
 let state='stopped',starts=0,opens=0;const errors=[];const proxy={selection:undefined,state:{enabled:false,selectedRuleId:null},select(id){this.selection=id;}};
 const workflow=new ProxyWorkflow({proxy,status:()=>({state}),findRule:id=>({id}),persist:async()=>{},start:async()=>{starts++;state='starting';},open:()=>{assert.equal(proxy.state.enabled,true);opens++;},onError:e=>errors.push(e)});
 return {proxy,workflow,errors,setState:v=>state=v,get starts(){return starts;},get opens(){return opens;}};
}
test('selecting proxy starts stopped tunnel and opens once only after environment becomes ready',async()=>{
 const s=setup();await s.workflow.select('r');assert.equal(s.starts,1);s.workflow.synced();assert.equal(s.opens,0);
 s.setState('running');s.proxy.state={selectedRuleId:'r',enabled:false,checking:true};s.workflow.synced();assert.equal(s.opens,0);
 s.proxy.state={selectedRuleId:'r',enabled:true};s.workflow.synced();s.workflow.synced();assert.equal(s.opens,1);
});
test('already running tunnel opens immediately after sync without restarting',async()=>{
 const s=setup();s.setState('running');await s.workflow.select('r');s.proxy.state={selectedRuleId:'r',enabled:true};s.workflow.synced();assert.equal(s.starts,0);assert.equal(s.opens,1);
});
test('disabling, stopping or startup failure cancels queued terminal creation',async()=>{
 for(const mode of ['disable','stop','error']){
  const s=setup();await s.workflow.select('r');if(mode==='disable')await s.workflow.select(undefined);else if(mode==='stop')s.workflow.cancel('r');else{s.setState('error');s.workflow.synced();}
  s.setState('running');s.proxy.state={selectedRuleId:'r',enabled:true};s.workflow.synced();assert.equal(s.opens,0,mode);
 }
});
test('wrong remote workspace reports once and cannot unexpectedly open later',async()=>{
 const s=setup();s.setState('running');await s.workflow.select('r');s.proxy.state={selectedRuleId:'r',enabled:false,reason:'Wrong host'};s.workflow.synced();assert.equal(s.errors.length,1);assert.equal(s.opens,0);
 s.proxy.state.enabled=true;s.workflow.synced();assert.equal(s.opens,0);
});
test('slow startup preparation retains request but cancellation prevents later open',async()=>{
 const s=setup();let release;s.workflow.start=()=>new Promise(resolve=>{release=resolve;});const selecting=s.workflow.select('r');await Promise.resolve();
 s.workflow.synced();assert.equal(s.workflow.pending,'r');s.workflow.cancel('r');release();await selecting;s.setState('running');s.proxy.state={selectedRuleId:'r',enabled:true};s.workflow.synced();assert.equal(s.opens,0);
});
test('failed persistence restores selection and never starts a tunnel',async()=>{
 const s=setup();s.proxy.selection='old';s.workflow.persist=async()=>{throw new Error('save failed');};await assert.rejects(s.workflow.select('r'),/save failed/);assert.equal(s.proxy.selection,'old');assert.equal(s.starts,0);assert.equal(s.workflow.pending,undefined);
});
