'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { proxyCommands,remoteAlias,resolveHost,TerminalProxy }=require('../src/terminal-proxy');
require('../src/localization').setLanguage('en');
const rule={id:'r',name:'proxy',host:'ouse@thor',remotePort:17890,targetHost:'127.0.0.1',targetPort:7897};
function folder(authority='ssh-remote+thor',index=0){return {index,name:'remote',uri:{scheme:'vscode-remote',authority,toString:()=>`vscode-remote://${authority}/home/ouse`}};}
function setup(options={}){
  const scopes=new Map();const collection={persistent:true,clear(){scopes.clear();},getScoped({workspaceFolder}){
    if(!scopes.has(workspaceFolder.index))scopes.set(workspaceFolder.index,new Map());const entries=scopes.get(workspaceFolder.index);
    return {replace:(k,v,o)=>entries.set(k,{type:'replace',value:v,options:o}),prepend:(k,v,o)=>entries.set(k,{type:'prepend',value:v,options:o})};
  }};
  const context={remoteName:'ssh-remote',folders:[folder()]};
  const proxy=new TerminalProxy({collection,getContext:()=>context,getConfig:()=>({}),lookup:async host=>host==='other'?'other':'ouse@thor:22',...options});
  return {proxy,collection,scopes,context};
}
test('clipboard contains exactly three exports using remote port, with lowercase compatibility and exclusion preservation',()=>{
  const text=proxyCommands(rule);assert.equal(text.split('\n').length,3);
  assert.match(text,/HTTP_PROXY=http:\/\/127\.0\.0\.1:17890 http_proxy=/);
  assert(!text.includes(':7897'));assert.match(text,/HTTPS_PROXY=/);assert.match(text,/export NO_PROXY=/);assert.match(text,/\$\{NO_PROXY:\+,\$NO_PROXY\}/);assert.match(text,/no_proxy="\$NO_PROXY"/);
});
test('Remote SSH authority supports plain, encoded and structured aliases; other protocols are excluded',()=>{
  assert.equal(remoteAlias('ssh-remote+thor'),'thor');assert.equal(remoteAlias('ssh-remote+ouse%40192.168.1.180'),'ouse@192.168.1.180');
  assert.equal(remoteAlias('ssh-remote+'+Buffer.from(JSON.stringify({hostName:'thor'})).toString('hex')),'thor');
  assert.equal(remoteAlias('dev-container+123'),undefined);assert.equal(remoteAlias('ssh-remote+-bad'),undefined);
});
test('ssh -G lookup compares configured user, hostname and port without connecting',async()=>{
  const result=await resolveHost('thor',{configFile:'C:\\ssh config'},(_exe,args,options,cb)=>{
    assert.deepEqual(args,['-F','C:\\ssh config','-G','thor']);assert.equal(options.shell,false);cb(null,'hostname THOR\nuser ouse\nport 22\n');
  });assert.equal(result,'ouse@thor:22');
});
test('only matching remote workspace folders get six creation-time variables, with no persistent collection',async()=>{
  const {proxy,scopes,collection,context}=setup();context.folders.push(folder('ssh-remote+other',1));
  proxy.select('r');await proxy.sync([rule],()=>({state:'running'}));
  assert.equal(proxy.state.enabled,true);assert.equal(collection.persistent,false);assert.equal(scopes.size,1);
  const values=scopes.get(0);assert.equal(values.size,6);assert.equal(values.get('HTTPS_PROXY').value,'http://127.0.0.1:17890');
  assert.equal(values.get('NO_PROXY').type,'prepend');assert.equal(values.get('NO_PROXY').value+'internal.example','localhost,127.0.0.1,::1,internal.example');
  assert.equal(values.get('http_proxy').options.applyAtShellIntegration,false);
  await proxy.sync([rule],()=>({state:'stopped'}));assert.equal(scopes.size,0);assert.equal(proxy.state.enabled,false);assert.equal(proxy.state.selectedRuleId,'r');
});
test('unselected, mismatched, local, empty and container workspaces never receive proxy variables',async()=>{
  for(const mode of ['unselected','mismatch','local','empty','container']){
    const {proxy,scopes,context}=setup();if(mode!=='unselected')proxy.select('r');
    if(mode==='mismatch')context.folders=[folder('ssh-remote+other')];if(mode==='local')context.remoteName=undefined;
    if(mode==='empty')context.folders=[];if(mode==='container')context.remoteName='dev-container';
    await proxy.sync([rule],()=>({state:'running'}));assert.equal(proxy.state.enabled,false,mode);assert.equal(scopes.size,0,mode);
  }
});
test('switching rule changes port, disable restores base environment, deletion removes injection',async()=>{
  const {proxy,scopes}=setup();const next={...rule,id:'next',remotePort:27890};
  proxy.select('r');await proxy.sync([rule,next],()=>({state:'running'}));
  proxy.select('next');await proxy.sync([rule,next],()=>({state:'running'}));assert.equal(scopes.get(0).get('HTTP_PROXY').value,'http://127.0.0.1:27890');
  proxy.select(undefined);await proxy.sync([rule,next],()=>({state:'running'}));assert.equal(scopes.size,0);
  proxy.select('r');await proxy.sync([rule],()=>({state:'running'}));await proxy.sync([],()=>({state:'running'}));assert.equal(scopes.size,0);assert.equal(proxy.state.selectedRuleId,null);
});
test('stale host lookup cannot re-enable injection after stop or dispose',async()=>{
  let resolve;const gate=new Promise(r=>resolve=r);const {proxy,scopes}=setup({lookup:()=>gate});
  proxy.select('r');const pending=proxy.sync([rule],()=>({state:'running'}));
  await proxy.sync([rule],()=>({state:'stopped'}));resolve('ouse@thor:22');await pending;assert.equal(scopes.size,0);
  await proxy.sync([rule],()=>({state:'running'}));proxy.dispose();assert.equal(scopes.size,0);
});
test('lookup failures leave injection off and allow later retry',async()=>{
  let fail=true;const {proxy,scopes}=setup({lookup:async()=>{if(fail)throw new Error('ENOENT');return 'ouse@thor:22';}});
  proxy.select('r');await proxy.sync([rule],()=>({state:'running'}));assert.equal(proxy.state.enabled,false);assert.equal(scopes.size,0);
  fail=false;await proxy.sync([rule],()=>({state:'running'}));assert.equal(proxy.state.enabled,true);
});
