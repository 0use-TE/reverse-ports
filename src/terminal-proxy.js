'use strict';
const { execFile } = require('node:child_process');
const { validateRule } = require('./core');
const { t } = require('./localization');
const BYPASS = 'localhost,127.0.0.1,::1';
function proxyAddress(rule) { return `http://127.0.0.1:${validateRule(rule).remotePort}`; }
function proxyCommands(rule) {
  const url = proxyAddress(rule);
  return `export HTTP_PROXY=${url} http_proxy=${url}\nexport HTTPS_PROXY=${url} https_proxy=${url}\nexport NO_PROXY="${BYPASS}\${NO_PROXY:+,$NO_PROXY}\${no_proxy:+,$no_proxy}"; export no_proxy="$NO_PROXY"`;
}
function remoteAlias(authority) {
  if (typeof authority !== 'string' || !authority.startsWith('ssh-remote+')) return undefined;
  let alias = authority.slice('ssh-remote+'.length);
  try {
    alias = decodeURIComponent(alias);
    if (/^(?:[a-f\d]{2})+$/i.test(alias)) {
      const data = JSON.parse(Buffer.from(alias, 'hex').toString('utf8'));
      alias = data.hostName || data.hostname || data.host;
    }
    validateRule({ host: alias, name: 'check', remotePort: 1, targetPort: 1 });
    return alias;
  } catch { return undefined; }
}
function resolveHost(host, config = {}, run = execFile) {
  const checked = validateRule({ host, name: 'check', remotePort: 1, targetPort: 1 }).host;
  const args = config.configFile ? ['-F',config.configFile] : [];
  args.push('-G', checked);
  return new Promise((resolve,reject) => run(config.sshPath || 'ssh',args,{ timeout:5000,windowsHide:true,shell:false,maxBuffer:1024*1024 },(error,stdout) => {
    if (error) return reject(error);
    const values = Object.fromEntries(stdout.split(/\r?\n/).map(line=>line.match(/^(hostname|user|port)\s+(.+)$/)).filter(Boolean).map(m=>[m[1],m[2].trim()]));
    if (!values.hostname || !values.user || !values.port) return reject(new Error('Incomplete SSH configuration'));
    resolve(`${values.user}@${values.hostname.toLowerCase()}:${values.port}`);
  }));
}
// Collections are workspace-scoped and non-persistent. No shell profile or remote file is edited.
class TerminalProxy {
  constructor({ collection, getContext, getConfig, lookup = resolveHost, onChange = () => {} }) {
    this.collection=collection; this.getContext=getContext; this.getConfig=getConfig; this.lookup=lookup; this.onChange=onChange;
    this.selection=undefined; this.generation=0; this.cache=new Map(); this.signature=''; this.scopes=[];
    collection.persistent=false; collection.clear(); this.state={ selectedRuleId:null, enabled:false, address:'', reason:t('终端代理未启用') };
  }
  invalidate() { this.cache.clear(); }
  identity(host) {
    const config=this.getConfig(); const key=JSON.stringify([host,config]);
    if(!this.cache.has(key)) { const p=this.lookup(host,config); this.cache.set(key,p); p.catch(()=>this.cache.delete(key)); }
    return this.cache.get(key);
  }
  select(id) { this.selection=id || undefined; }
  clear() { this.collection.clear(); this.signature=''; this.scopes=[]; }
  async sync(rules,status) {
    if(this.disposed)return;
    const generation=++this.generation;
    const rule=rules.find(r=>r.id===this.selection);
    const next={selectedRuleId:rule?.id || null,enabled:false,address:rule?proxyAddress(rule):'',reason:t('终端代理未启用')};
    const disable=reason=>{this.clear();this.state={...next,reason};this.onChange();};
    if(!rule) { disable(next.reason); return; }
    if(status(rule.id).state!=='running') { disable(t('等待所选隧道连接；新终端暂不注入代理')); return; }
    const context=this.getContext();
    if(context.remoteName!=='ssh-remote') { disable(t('请在对应主机的 Remote SSH 工作区启用终端代理'));return; }
    const folders=(context.folders || []).filter(f=>f.uri.scheme==='vscode-remote' && remoteAlias(f.uri.authority));
    if(!folders.length) { disable(t('请先打开远程文件夹，才能为新终端自动设置代理'));return; }
    // Clear the old collection during host resolution to avoid stale routes.
    const contextKey=JSON.stringify([rule.id,next.address,folders.map(f=>f.uri.toString()),this.getConfig()]);
    if(this.signature===contextKey) { this.state={...next,enabled:true,reason:t('已为此工作区的新终端启用代理')};this.onChange();return; }
    this.clear(); this.state={...next,checking:true,reason:t('正在核对远程主机')};this.onChange();
    try {
      const identity=await this.identity(rule.host);
      const matches=await Promise.all(folders.map(async folder=>({folder,matches:await this.identity(remoteAlias(folder.uri.authority))===identity})));
      if(generation!==this.generation)return;
      const matching=matches.filter(m=>m.matches).map(m=>m.folder);
      if(!matching.length) { disable(t('当前远程主机与所选规则不匹配，未注入代理'));return; }
      for(const folder of matching) {
        const scoped=this.collection.getScoped({workspaceFolder:folder});
        const options={applyAtProcessCreation:true,applyAtShellIntegration:false};
        for(const name of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])scoped.replace(name,next.address,options);
        // Prepending preserves exclusions already present in the terminal's environment.
        for(const name of ['NO_PROXY','no_proxy'])scoped.prepend(name,`${BYPASS},`,options);
        scoped.description=t('反向端口终端代理：仅新终端生效，已有终端请重开');
      }
      this.signature=contextKey;this.scopes=matching;
      this.state={...next,enabled:true,reason:t('已为此工作区的新终端启用代理')};this.onChange();
    } catch {
      if(generation===this.generation)disable(t('无法核对 SSH 主机配置；可先复制代理变量手动使用'));
    }
  }
  dispose() { this.disposed=true;this.generation++;this.clear(); }
}
module.exports={BYPASS,proxyAddress,proxyCommands,remoteAlias,resolveHost,TerminalProxy};
