'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');const path=require('node:path');const {EventEmitter}=require('node:events');
test('real extension handlers connect proxy selection to auto-start, env injection and one new terminal',async()=>{
 const core=require('../src/core');const proxyModule=require('../src/terminal-proxy');const askpass=require('../src/askpass');const originals={manager:core.TunnelManager,probe:core.probe,check:core.checkEnvironment,proxy:proxyModule.TerminalProxy,askpass:askpass.createAskpass};
 let passwordPrompt;
 askpass.createAskpass=async prompt=>{passwordPrompt=prompt;return {env:{},dispose(){}};};
 class Manager extends EventEmitter{
  constructor(){super();this.states=new Map();}
  status(id){return this.states.get(id)||{state:'stopped'};}
  start(rule,authentication){authentication?.dispose();this.states.set(rule.id,{state:'starting'});this.emit('change');setTimeout(()=>{this.states.set(rule.id,{state:'running'});this.emit('change');},10);}
  stop(id){this.states.set(id,{state:'stopping'});this.emit('change');setTimeout(()=>{this.states.set(id,{state:'stopped'});this.emit('change');},5);}
  stopAll(){}dispose(){}
 }
 core.TunnelManager=Manager;core.probe=async()=>{};core.checkEnvironment=async()=>({version:'test'});
 proxyModule.TerminalProxy=class extends originals.proxy{constructor(options){super({...options,lookup:async()=> 'ouse@thor:22'});}};
 const dispose={dispose(){}};const commands=new Map();let provider,handler;const terminals=[],errors=[];const mutations=new Map();
 const uri={scheme:'vscode-remote',authority:'ssh-remote+thor',toString:()=> 'vscode-remote://ssh-remote+thor/home/ouse'};
 let inputOptions,canceled=false;
 const vscode={CancellationTokenSource:class {constructor(){this.token={};}cancel(){canceled=true;}dispose(){}},env:{language:'en',remoteName:'ssh-remote',clipboard:{writeText:async()=>{}}},Uri:{joinPath:()=>({toString:()=> 'file:///test'})},
  workspace:{workspaceFolders:[{index:0,name:'remote',uri}],getConfiguration:()=>({get:()=>undefined}),onDidChangeWorkspaceFolders:()=>dispose,onDidChangeConfiguration:()=>dispose},
  window:{showInputBox:async options=>{inputOptions=options;return 'test-only-password';},createOutputChannel:()=>({appendLine(){},show(){},dispose(){}}),showInformationMessage:async()=>{},showErrorMessage:async message=>{errors.push(message);},setStatusBarMessage(){},
   showWarningMessage(){throw new Error('Unexpected confirmation');},registerWebviewViewProvider:(_id,p)=>{provider=p;return dispose;},createTerminal:options=>{assert.equal(mutations.get('HTTP_PROXY')?.value,'http://127.0.0.1:17890');terminals.push(options);return {show(){}};}},
  commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return dispose;},executeCommand:async()=>{}}};
 const originalLoad=Module._load;let activate;
 try{Module._load=function(id,...rest){return id==='vscode'?vscode:originalLoad.call(this,id,...rest);};activate=require('../src/extension').activate;}
 finally{Module._load=originalLoad;core.TunnelManager=originals.manager;core.probe=originals.probe;core.checkEnvironment=originals.check;proxyModule.TerminalProxy=originals.proxy;askpass.createAskpass=originals.askpass;}
 const rule={id:'r',name:'proxy',host:'thor',remotePort:17890,targetHost:'127.0.0.1',targetPort:7897};
 const state=new Map();const collection={persistent:true,clear(){mutations.clear();},getScoped:()=>({replace:(name,value)=>mutations.set(name,{value}),prepend:(name,value)=>mutations.set(name,{value}),description:''})};
 const context={subscriptions:[],globalState:{get:()=>[rule],update:async()=>{}},workspaceState:{get:key=>state.get(key),update:async(key,value)=>state.set(key,value)},environmentVariableCollection:collection,extensionUri:{},extensionPath:path.resolve(__dirname,'..')};
 const api=activate(context);
 const view={webview:{asWebviewUri:()=>({toString:()=> 'file:///test'}),cspSource:'test:',onDidReceiveMessage:fn=>{handler=fn;return dispose;},postMessage:async()=>true},onDidDispose:()=>dispose};
 provider.resolveWebviewView(view);
 assert.equal(view.badge,undefined);
 await handler({type:'selectProxy',id:'r'});
 const controller=new AbortController();
 assert.equal(await passwordPrompt("user@thor's password:",controller.signal),'test-only-password');
 assert.equal(inputOptions.password,true);assert.equal(inputOptions.ignoreFocusOut,true);
 assert.equal(inputOptions.title,'SSH Authentication · thor');assert.equal(inputOptions.prompt,"user@thor's password:");
 vscode.window.showInputBox=async()=>{controller.abort();return undefined;};
 assert.equal(await passwordPrompt('Password:',controller.signal),undefined);assert.equal(canceled,true);
 const deadline=Date.now()+1000;while(terminals.length===0 && Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
 assert.equal(terminals.length,1);assert.equal(terminals[0].cwd,uri);assert.equal(terminals[0].env.HTTPS_PROXY,'http://127.0.0.1:17890');assert.equal(api.getTerminalProxy().enabled,true);assert.deepEqual(errors,[]);
 await handler({type:'ready'});assert.equal(terminals.length,1);
 assert.equal(view.badge.value,1);assert.equal(view.badge.tooltip,'1 active port forwards');
 await handler({type:'newProxyTerminal',id:'r'});assert.equal(terminals.length,2);
 await handler({type:'save',rule:{...rule,remotePort:17891,targetPort:7898}});
 assert.equal(api.getStatus('r').state,'starting');assert.equal(api.getRules()[0].targetPort,7898);
 const restartDeadline=Date.now()+1000;while(api.getStatus('r').state!=='running' && Date.now()<restartDeadline)await new Promise(r=>setTimeout(r,10));
 assert.equal(api.getStatus('r').state,'running');assert.equal(terminals.length,2);assert.equal(mutations.get('HTTP_PROXY').value,'http://127.0.0.1:17891');assert.deepEqual(errors,[]);
 await handler({type:'delete',id:'r'});assert.equal(api.getRules().length,0);assert.equal(mutations.size,0);assert.equal(api.getTerminalProxy().enabled,false);
 assert.equal(view.badge,undefined);
 for(const subscription of context.subscriptions)subscription?.dispose?.();
});
