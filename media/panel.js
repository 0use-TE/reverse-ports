'use strict';
const vscode=acquireVsCodeApi();
const t=ReversePortsI18n.createTranslator(document.documentElement.lang);
const $=id=>document.getElementById(id);
let rules=[],hosts=[],defaultHost='',editing,terminalProxy={selectedRuleId:null,enabled:false},selectedId;
const labels={stopped:t('已停止'),starting:t('连接中'),running:t('运行中'),stopping:t('停止中'),error:t('失败')};
const icons={circle:'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10',edit:'M4 16L16 4l4 4L8 20H4z M13 7l4 4',copy:'M9 9h11v11H9z M15 5V2H2v13h3',terminal:'M4 6l5 6-5 6 M12 18h8',close:'M6 6l12 12 M6 18L18 6'};
function post(type,extra={}){vscode.postMessage({type,...extra});}
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const[k,v]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(k,v);const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',icons[name]);svg.append(path);return svg;}
function button(name,label,click){const b=document.createElement('button');b.type='button';b.className='icon-button';b.title=label;b.setAttribute('aria-label',label);b.append(icon(name));b.onclick=e=>{e.stopPropagation();hideMenu();click();};return b;}
function cell(row,text='',className=''){const c=document.createElement('div');c.setAttribute('role','cell');c.className=className;c.textContent=text;row.append(c);return c;}
function row(){const r=document.createElement('div');r.className='grid-row';r.setAttribute('role','row');return r;}
function endpoint(text){
  text=text.trim();let host='127.0.0.1',port=text;
  const ipv6=text.match(/^\[([a-fA-F0-9:]+)\]:(\d+)$/);const address=text.match(/^([a-zA-Z0-9_.-]+):(\d+)$/);
  if(ipv6){host=ipv6[1];port=ipv6[2];}else if(address){host=address[1];port=address[2];}
  if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw new Error(t('端口必须是 1～65535 的整数'));
  return {host,port:Number(port)};
}
function address(rule){return `${rule.targetHost.includes(':')?'['+rule.targetHost+']':rule.targetHost}:${rule.targetPort}`;}
function begin(rule,targetOnly=false){
  editing={id:rule?.id,port:rule?String(rule.remotePort):'',target:rule?address(rule):'',host:rule?.host||defaultHost||hosts[0]||'',targetOnly};
  hideMenu();render();$(targetOnly?'targetInput':'portInput').focus();
}
function submit(){
  if(!editing||editing.submitting)return;
  let invalidInput='portInput';
  try{
    const remote=endpoint(editing.port);invalidInput=(!editing.id||editing.targetOnly)?'targetInput':'portInput';const target=editing.target.trim()?endpoint(editing.target):remote;
    if(!editing.host.trim())throw new Error(t('请先连接 SSH 主机'));
    const rule={id:editing.id,name:String(remote.port),host:editing.host.trim(),remotePort:remote.port,targetHost:target.host,targetPort:target.port};
    editing.submitting=true;
    post('save',{rule,startAfterSave:!editing.id});
  }catch(error){const input=$(invalidInput);input.title=error.message;input.setAttribute('aria-invalid','true');input.focus();}
}
function inputCell(r,id,value,placeholder,key){
  const c=cell(r,'','input-cell');const input=document.createElement('input');input.id=id;input.className='cell-input';input.value=value;input.placeholder=placeholder;input.setAttribute('aria-label',placeholder);if(id==='hostInput')input.setAttribute('list','hosts');
  input.oninput=()=>{editing[key]=input.value;input.removeAttribute('aria-invalid');};
  input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();submit();}if(event.key==='Escape'){editing=undefined;render();}};c.append(input);return c;
}
function editorRow(){
  const r=row();r.classList.add('editing');cell(r);
  if(editing.targetOnly){cell(r,editing.port);inputCell(r,'targetInput',editing.target,t('转发地址'),'target');}
  else{inputCell(r,'portInput',editing.port,t('端口号或地址（例如 3000 或 127.0.0.1:3000）'),'port');if(!editing.id)inputCell(r,'targetInput',editing.target,t('本机地址（默认与端口相同）'),'target');else cell(r,editing.target);}
  cell(r,'','process-cell');cell(r);return r;
}
function render(){
  const empty=rules.length===0&&!editing;
  $('emptyState').hidden=!empty;
  $('grid').hidden=empty;
  // Preserve keyboard focus while SSH status messages update the surrounding rows.
  const focused=document.activeElement;const focusId=focused?.classList.contains('cell-input')?focused.id:undefined;const selection=focusId?[focused.selectionStart,focused.selectionEnd]:undefined;
  $('rows').replaceChildren();
  for(const rule of rules){
    if(editing?.id===rule.id){$('rows').append(editorRow());continue;}
    const r=row();r.classList.add('data-row');if(selectedId===rule.id)r.classList.add('selected');r.tabIndex=0;
    const active=['starting','running','stopping'].includes(rule.state);
    const indicator=cell(r);const status=button('circle',`${labels[rule.state]||rule.state}${rule.error||rule.warning?' · '+(rule.error||rule.warning):''}`,()=>post(active?'stop':'start',{id:rule.id}));status.classList.add('indicator',rule.state);indicator.append(status);
    const port=cell(r,'','port-cell');port.title=rule.host;const portLabel=document.createElement('span');portLabel.className='port-label';portLabel.textContent=String(rule.remotePort);port.append(portLabel);
    const portActions=document.createElement('span');portActions.className='actions';portActions.append(button('edit',t('修改端口号'),()=>begin(rule)),button('close',t('停止转发'),()=>post('delete',{id:rule.id})));port.append(portActions);
    const forwarded=cell(r,'','forward-cell');const target=document.createElement('span');target.className='forward-label';target.textContent=address(rule);target.title=address(rule);forwarded.append(target);
    forwarded.ondblclick=event=>{event.stopPropagation();begin(rule,true);};
    const actions=document.createElement('span');actions.className='actions';actions.append(button('terminal',t('新建代理终端'),()=>post('newProxyTerminal',{id:rule.id})),button('copy',t('复制三行变量'),()=>post('copy',{id:rule.id})),button('edit',t('更改转发地址'),()=>begin(rule,true)));forwarded.append(actions);
    cell(r,'','process-cell');const source=cell(r,t('手动转发'),'source-cell');source.title=terminalProxy.selectedRuleId===rule.id?`${rule.host} · ${t('终端代理')} · ${terminalProxy.reason||''}`:rule.host;
    r.onclick=()=>{selectedId=rule.id;document.querySelectorAll('.data-row.selected').forEach(n=>n.classList.remove('selected'));r.classList.add('selected');};
    r.ondblclick=()=>begin(rule);
    r.oncontextmenu=e=>{e.preventDefault();showMenu(rule,e.clientX,e.clientY);};
    r.onkeydown=e=>{if(e.key==='Delete')post('delete',{id:rule.id});if(e.key==='F2')begin(rule);if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const rect=r.getBoundingClientRect();showMenu(rule,rect.left+36,rect.bottom);}};
    $('rows').append(r);
  }
  if(editing && !editing.id)$('rows').append(editorRow());
  else{const add=row();add.classList.add('add-row');cell(add);const c=cell(add,'','add-cell');const b=document.createElement('button');b.id='add';b.textContent=t('添加端口');b.onclick=()=>begin();c.append(b);cell(add);cell(add);cell(add);$('rows').append(add);}
  if(focusId && $(focusId)){$(focusId).focus();try{$(focusId).setSelectionRange(...selection);}catch{}}
}
function hideMenu(){$('contextMenu').hidden=true;}
function showMenu(rule,x,y){
  const menu=$('contextMenu');menu.replaceChildren();
  const active=['starting','running','stopping'].includes(rule.state);const selected=terminalProxy.selectedRuleId===rule.id;
  function item(label,action,{checked,disabled=false}={}){const b=document.createElement('button');b.type='button';b.setAttribute('role',checked===undefined?'menuitem':'menuitemcheckbox');if(checked!==undefined)b.setAttribute('aria-checked',String(checked));const mark=document.createElement('span');mark.className='check-mark';mark.textContent=checked?'✓':'';const text=document.createElement('span');text.textContent=label;b.append(mark,text);b.disabled=disabled;b.onclick=()=>{hideMenu();action();};menu.append(b);}
  item(t('终端代理'),()=>post(selected?'disableProxy':'selectProxy',{id:rule.id}),{checked:selected});
  item(t('新建代理终端'),()=>post('newProxyTerminal',{id:rule.id}));item(t('复制三行变量'),()=>post('copy',{id:rule.id}));
  item(active?t('停止'):t('启动'),()=>post(active?'stop':'start',{id:rule.id}));item(t('修改端口号'),()=>begin(rule));item(t('更改转发地址'),()=>begin(rule,true));item(t('停止转发'),()=>post('delete',{id:rule.id}));
  menu.hidden=false;menu.style.left=Math.max(0,Math.min(x,window.innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(0,Math.min(y,window.innerHeight-menu.offsetHeight-8))+'px';
  menu.querySelector('button').focus();
}
$('forwardPort').onclick=()=>begin();
document.addEventListener('click',event=>{
  if(!editing||event.target.closest('.editing'))return;
  event.preventDefault();event.stopImmediatePropagation();hideMenu();submit();
},true);
document.addEventListener('click',event=>{if(!event.target.closest('#contextMenu'))hideMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideMenu();});
window.addEventListener('message',event=>{
  const m=event.data;
  if(m.type==='saved'){editing=undefined;render();}
  if(m.type==='saveFailed'&&editing)editing.submitting=false;
  if(m.type==='state'){rules=m.rules;hosts=m.hosts||[];defaultHost=m.defaultHost||'';terminalProxy=m.terminalProxy||{selectedRuleId:null,enabled:false};$('hosts').replaceChildren();for(const host of hosts){const option=document.createElement('option');option.value=host;$('hosts').append(option);}render();}
});
render();post('ready');
