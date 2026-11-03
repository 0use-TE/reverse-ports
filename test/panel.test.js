'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');const {renderLocalizedHtml}=require('../src/localization');
function panel(language='zh-cn'){
 const sent=[];const dom=new JSDOM(renderLocalizedHtml(fs.readFileSync(path.join(__dirname,'../media/panel.html'),'utf8'),language),{runScripts:'outside-only'});
 dom.window.acquireVsCodeApi=()=>({postMessage:m=>sent.push(m)});dom.window.eval(fs.readFileSync(path.join(__dirname,'../media/i18n.js'),'utf8'));dom.window.eval(fs.readFileSync(path.join(__dirname,'../media/panel.js'),'utf8'));
 return {dom,d:dom.window.document,sent,receive:data=>dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data}))};
}
const rule={id:'r',name:'电脑代理',host:'thor',remotePort:7890,targetHost:'127.0.0.1',targetPort:7897,state:'running'};
function action(p,label){return [...p.d.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label);}
function type(p,id,value){p.d.getElementById(id).value=value;p.d.getElementById(id).dispatchEvent(new p.dom.window.Event('input'));}
function enter(p,id='portInput'){p.d.getElementById(id).dispatchEvent(new p.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}
function context(p){p.d.querySelector('.data-row').dispatchEvent(new p.dom.window.MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:30}));}
test('native-style table has four column labels and only an inline Add Port entry',()=>{
 const p=panel();p.receive({type:'state',rules:[rule],hosts:['thor']});assert.deepEqual([...p.d.querySelectorAll('[role=columnheader]')].map(n=>n.textContent),['','端口','转发地址','正在运行的进程','源']);
 assert.equal(p.d.querySelector('.port-cell').textContent,'7890');
 assert.equal(p.d.getElementById('add').textContent,'添加端口');assert(p.d.getElementById('add').closest('.grid-row'));
 assert.equal(p.d.querySelector('header'),null);assert.equal(p.d.querySelector('form'),null);assert.equal(p.d.querySelector('footer'),null);p.dom.window.close();
});
test('empty state matches native welcome layout; optional destination defaults to the same port',()=>{
 const p=panel();p.receive({type:'state',rules:[],hosts:['other','thor'],defaultHost:'thor'});
 assert.equal(p.d.getElementById('grid').hidden,true);assert.equal(p.d.getElementById('emptyState').hidden,false);assert.equal(p.d.getElementById('forwardPort').textContent,'转发端口');
 p.d.getElementById('forwardPort').click();assert.equal(p.d.getElementById('grid').hidden,false);assert.equal(p.d.getElementById('emptyState').hidden,true);
 assert.equal(p.d.querySelectorAll('input').length,2);type(p,'portInput','7890');enter(p);
 const saved=p.sent.at(-1);assert.equal(saved.type,'save');assert.equal(saved.rule.host,'thor');assert.equal(saved.rule.remotePort,7890);assert.equal(saved.rule.targetPort,7890);assert.equal(saved.startAfterSave,true);
 p.receive({type:'saved'});assert.equal(p.d.getElementById('portInput'),null);assert.equal(p.d.getElementById('emptyState').hidden,false);p.dom.window.close();
});
test('invalid ports remain in the inline editor, Escape cancels and same-port defaults are supported',()=>{
 const p=panel();p.receive({type:'state',rules:[],hosts:['thor']});p.d.getElementById('add').click();type(p,'portInput','70000');enter(p);
 assert.equal(p.d.getElementById('portInput').getAttribute('aria-invalid'),'true');assert.equal(p.sent.some(m=>m.type==='save'),false);
 type(p,'portInput','127.0.0.1:3000');enter(p);assert.equal(p.sent.at(-1).rule.targetPort,3000);assert.equal(p.sent.at(-1).rule.remotePort,3000);
 p.d.getElementById('portInput').dispatchEvent(new p.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(p.d.getElementById('portInput'),null);p.dom.window.close();
});
test('port edit and close belong to the port cell; terminal, copy and destination edit belong to the address cell',()=>{
 const p=panel('en');p.receive({type:'state',rules:[{...rule,state:'stopped'}],hosts:['thor']});
 for(const label of ['Copy 3 export lines','New proxy terminal','Change Forwarded Address'])assert(action(p,label).closest('.forward-cell'));
 for(const label of ['Change Port','Stop Forwarding'])assert(action(p,label).closest('.port-cell'));
 action(p,'New proxy terminal').click();assert.deepEqual(JSON.parse(JSON.stringify(p.sent.at(-1))),{type:'newProxyTerminal',id:'r'});
 action(p,'Copy 3 export lines').click();assert.equal(p.sent.at(-1).type,'copy');action(p,'Stop Forwarding').click();assert.equal(p.sent.at(-1).type,'delete');
 assert.equal(p.d.querySelector('input[type=checkbox]'),null);p.dom.window.close();
});

test('creation accepts a distinct local port and marks invalid destinations in their own input',()=>{
 const p=panel();p.receive({type:'state',rules:[],hosts:['thor']});p.d.getElementById('forwardPort').click();
 type(p,'portInput','7890');type(p,'targetInput','70000');enter(p,'targetInput');assert.equal(p.d.getElementById('targetInput').getAttribute('aria-invalid'),'true');
 type(p,'targetInput','7897');enter(p,'targetInput');assert.equal(p.sent.at(-1).rule.remotePort,7890);assert.equal(p.sent.at(-1).rule.targetPort,7897);assert.equal(p.sent.at(-1).rule.targetHost,'127.0.0.1');p.dom.window.close();
});

test('running rules can edit each endpoint independently without changing the other',()=>{
 const p=panel('en');p.receive({type:'state',rules:[rule],hosts:['thor']});action(p,'Change Port').click();
 type(p,'portInput','7891');enter(p);assert.equal(p.sent.at(-1).rule.targetPort,7897);assert.equal(p.sent.at(-1).rule.remotePort,7891);
 p.receive({type:'saved'});action(p,'Change Forwarded Address').click();type(p,'targetInput','localhost:7898');enter(p,'targetInput');
 assert.equal(p.sent.at(-1).rule.remotePort,7890);assert.equal(p.sent.at(-1).rule.targetPort,7898);p.dom.window.close();
});
test('right-click terminal proxy toggles the checked menu action',()=>{
 const p=panel('en');p.receive({type:'state',rules:[rule],hosts:['thor'],terminalProxy:{selectedRuleId:null,enabled:false}});context(p);
 const item=p.d.querySelector('[role=menuitemcheckbox]');assert.equal(item.getAttribute('aria-checked'),'false');assert.match(item.textContent,/Terminal proxy/);item.click();assert.equal(p.sent.at(-1).type,'selectProxy');
 p.receive({type:'state',rules:[rule],hosts:['thor'],terminalProxy:{selectedRuleId:'r',enabled:true}});context(p);const checked=p.d.querySelector('[role=menuitemcheckbox]');assert.equal(checked.getAttribute('aria-checked'),'true');checked.click();assert.equal(p.sent.at(-1).type,'disableProxy');p.dom.window.close();
});
test('stopped rules edit inline and SSH updates do not lose draft text or focus',()=>{
 const p=panel();p.receive({type:'state',rules:[{...rule,state:'stopped'}],hosts:['thor']});p.d.querySelector('.forward-cell').dispatchEvent(new p.dom.window.MouseEvent('dblclick',{bubbles:true}));
 type(p,'targetInput','127.0.0.1:9000');p.d.getElementById('targetInput').focus();p.receive({type:'state',rules:[{...rule,state:'stopped'}],hosts:['thor']});
 assert.equal(p.d.activeElement.id,'targetInput');assert.equal(p.d.getElementById('targetInput').value,'127.0.0.1:9000');enter(p,'targetInput');assert.equal(p.sent.at(-1).rule.id,'r');assert.equal(p.sent.at(-1).startAfterSave,false);p.dom.window.close();
});
test('status errors use tooltips; user text is safe and process names are not invented',()=>{
 const p=panel('en');p.receive({type:'state',rules:[{...rule,name:'<img src=x>',state:'error',error:'Port occupied'}],hosts:[]});
 assert.equal(p.d.querySelector('img'),null);assert.match(p.d.querySelector('.indicator').title,/Port occupied/);assert.equal(p.d.querySelector('.process-cell').textContent,'');
 assert.deepEqual([...p.d.querySelectorAll('[role=columnheader]')].map(n=>n.textContent),['','Port','Forwarded Address','Running Process','Origin']);p.dom.window.close();
});

test('clicking outside an edit saves once and does not also trigger the clicked Add Port button',()=>{
 const p=panel('en');p.receive({type:'state',rules:[rule],hosts:['thor']});action(p,'Change Port').click();type(p,'portInput','7899');
 p.d.getElementById('add').click();assert.equal(p.sent.at(-1).type,'save');assert.equal(p.sent.at(-1).rule.remotePort,7899);assert.equal(p.d.getElementById('portInput').value,'7899');
 p.d.body.click();assert.equal(p.sent.filter(m=>m.type==='save').length,1);
 p.receive({type:'saveFailed'});p.d.body.click();assert.equal(p.sent.filter(m=>m.type==='save').length,2);p.dom.window.close();
});

test('clicking between creation inputs does not submit; invalid outside-click stays editable and Escape cancels',()=>{
 const p=panel();p.receive({type:'state',rules:[],hosts:['thor']});p.d.getElementById('forwardPort').click();type(p,'portInput','7890');
 p.d.getElementById('targetInput').click();assert.equal(p.sent.some(m=>m.type==='save'),false);
 type(p,'targetInput','70000');p.d.body.click();assert.equal(p.sent.some(m=>m.type==='save'),false);assert.equal(p.d.activeElement.id,'targetInput');
 p.d.getElementById('targetInput').dispatchEvent(new p.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));p.d.body.click();assert.equal(p.sent.some(m=>m.type==='save'),false);assert.equal(p.d.getElementById('emptyState').hidden,false);p.dom.window.close();
});
