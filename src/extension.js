'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { validateRule, probe, explainSystemError, checkEnvironment, TunnelManager } = require('./core');
const { t, setLanguage, renderLocalizedHtml } = require('./localization');
const { TerminalProxy, proxyCommands, proxyAddress, remoteAlias } = require('./terminal-proxy');
const { ProxyWorkflow } = require('./proxy-workflow');
function activate(context) {
    setLanguage(vscode.env.language);
    const output = vscode.window.createOutputChannel(t("反向端口"));
    const getConfig = () => {
        const c = vscode.workspace.getConfiguration('reversePorts');
        return { sshPath: c.get('sshPath'), configFile: c.get('sshConfigFile') };
    };
    const manager = new TunnelManager({ log: text => output.appendLine(`${new Date().toISOString()} ${text}`), config: getConfig });
    let rules = [];
    for (const raw of context.globalState.get('rules', [])) {
        try {
            rules.push(validateRule(raw));
        }
        catch {
            output.appendLine(t("忽略一条无效的保存规则"));
        }
    }
    let view;
    let busy = false;
    const notices = new Map();
    const reportedErrors = new Map();
    const hosts = () => {
        const configFile = vscode.workspace.getConfiguration('reversePorts').get('sshConfigFile') || path.join(os.homedir(), '.ssh', 'config');
        const result = new Set(rules.map(r => r.host));
        try {
            for (const match of fs.readFileSync(configFile, 'utf8').matchAll(/^\s*Host\s+([^#\r\n]+)/gmi)) {
                for (const alias of match[1].trim().split(/\s+/))
                    if (!/[*!?]/.test(alias))
                        result.add(alias);
            }
        }
        catch { /* Manual host entry always works, including aliases in Include files. */ }
        return [...result];
    };
    const defaultHost=()=> (vscode.workspace.workspaceFolders || []).map(f=>remoteAlias(f.uri.authority)).find(Boolean) || hosts()[0] || '';
    const send = () => {
        if(!view)return;
        const runningCount=rules.filter(rule=>manager.status(rule.id).state==='running').length;
        view.badge=runningCount?{value:runningCount,tooltip:t`已开启 ${runningCount} 个端口转发`}:undefined;
        return view.webview.postMessage({ type: 'state', rules: rules.map(r => ({ ...r, ...manager.status(r.id), warning: notices.get(r.id) || '' })), hosts: hosts(), defaultHost:defaultHost(), terminalProxy: terminalProxy.state });
    };
    let workflow;
    const terminalProxy = new TerminalProxy({
        collection: context.environmentVariableCollection,
        getContext: () => ({ remoteName:vscode.env.remoteName, folders:vscode.workspace.workspaceFolders }),
        getConfig, onChange:()=>{send();workflow?.synced();}
    });
    terminalProxy.select(context.workspaceState.get('terminalProxyRule'));
    const syncProxy = () => terminalProxy.sync(rules,id=>manager.status(id));
    const selectProxy = async id => {
        await workflow.select(id);
        await syncProxy();
    };
    const copyProxy = async rule => {
        await vscode.env.clipboard.writeText(proxyCommands(rule));
        vscode.window.setStatusBarMessage(t('已复制'),2000);
    };
    const newProxyTerminal = () => {
        const rule=rules.find(r=>r.id===terminalProxy.state.selectedRuleId);
        if(!rule || !terminalProxy.state.enabled || manager.status(rule.id).state!=='running')throw new Error(t('请先选择终端代理规则、启动隧道，并打开匹配的远程工作区'));
        const address=proxyAddress(rule);
        const terminal=vscode.window.createTerminal({
            name:t`代理终端 · ${rule.remotePort}`, cwd:terminalProxy.scopes[0].uri,
            env:{HTTP_PROXY:address,HTTPS_PROXY:address,http_proxy:address,https_proxy:address}
        });
        terminal.show();
    };
    const startRule=async rule=>{
        await checkEnvironment(getConfig());notices.delete(rule.id);
        try {await probe(rule.targetHost,rule.targetPort);}catch(error){notices.set(rule.id,explainSystemError(error,'target'));}
        manager.start(rule);
    };
    workflow=new ProxyWorkflow({proxy:terminalProxy,status:id=>manager.status(id),findRule:id=>rules.find(r=>r.id===id),
        persist:id=>context.workspaceState.update('terminalProxyRule',id || undefined),start:startRule,open:newProxyTerminal,
        onError:error=>vscode.window.showErrorMessage(t`反向端口：${error.message}`)});
    const stopRule=async id=>{
        workflow.cancel(id);manager.stop(id);
        if(manager.status(id).state!=='stopping')return;
        await new Promise((resolve,reject)=>{
            const changed=()=>{if(manager.status(id).state!=='stopping'){cleanup();resolve();}};
            const timer=setTimeout(()=>{cleanup();reject(new Error(t('等待隧道停止超时，请重试')));},5000);
            function cleanup(){clearTimeout(timer);manager.removeListener('change',changed);}
            manager.on('change',changed);changed();
        });
    };
    const pickRule = async id => rules.find(r=>r.id===id) || (await vscode.window.showQuickPick(rules.map(r=>({label:String(r.remotePort),description:`${r.host} · ${proxyAddress(r)}`,rule:r})),{placeHolder:t('选择一条 HTTP／混合代理转发规则')}))?.rule;
    manager.on('change', () => {
        void syncProxy();
        send();
        for (const rule of rules) {
            const state = manager.status(rule.id);
            if (state.state !== 'error') {
                reportedErrors.delete(rule.id);
                continue;
            }
            if (reportedErrors.get(rule.id) === state.error)
                continue;
            reportedErrors.set(rule.id, state.error);
            vscode.window.showErrorMessage(t `反向端口 · ${rule.name}：${state.error}`, t("查看日志")).then(action => { if (action === t("查看日志"))
                output.show(true); });
        }
    });
    const diagnose = async () => {
        const result = await checkEnvironment(getConfig());
        output.appendLine(t `本机环境检查通过：${result.version}`);
        await vscode.window.showInformationMessage(t("本机 SSH 程序可用。HTTP_PROXY / HTTPS_PROXY 不影响隧道建立；远程程序需要使用代理时，请在它所在的终端或进程环境中设置。此检查不验证远程登录或远程终端变量。"));
    };
    const save = async () => { await context.globalState.update('rules', rules); await syncProxy(); await send(); };
    async function handle(message) {
        if (!message || typeof message !== 'object' || typeof message.type !== 'string')
            return;
        if (message.type === 'ready') {
            await send();
            return;
        }
        if (busy) {
            vscode.window.showInformationMessage(t("请等待上一个操作完成"));
            return;
        }
        busy = true;
        try {
            const existing = rules.find(r => r.id === message.id);
            switch (message.type) {
                case 'save': {
                    const candidate = validateRule(message.rule);
                    const old = rules.find(r => r.id === candidate.id);
                    const restart=old && ['starting','running'].includes(manager.status(old.id).state);
                    if (rules.some(r => r.id !== candidate.id && r.host === candidate.host && r.remotePort === candidate.remotePort))
                        throw new Error(t("同一 SSH 主机的远程端口不能重复"));
                    if(old)await stopRule(old.id);
                    const previous = rules;
                    rules = old ? rules.map(r => r.id === candidate.id ? candidate : r) : [...rules, candidate];
                    try {
                        await save();
                    }
                    catch (e) {
                        rules = previous;
                        if(restart)await startRule(old);
                        throw e;
                    }
                    view?.webview.postMessage({ type: 'saved' });
                    if(restart||message.startAfterSave)await startRule(candidate);
                    break;
                }
                case 'start':
                    if (existing) await startRule(existing);
                    break;
                case 'stop':
                    if (existing) {
                        workflow.cancel(existing.id);
                        manager.stop(existing.id);
                    }
                    break;
                case 'delete':
                    if (!existing)
                        break;
                    await stopRule(existing.id);
                    {
                        const previous = rules;
                        rules = rules.filter(r => r.id !== existing.id);
                        try {
                            await save();
                            if(terminalProxy.selection===existing.id) {
                                terminalProxy.select(undefined);
                                await context.workspaceState.update('terminalProxyRule',undefined);
                                await syncProxy();
                            }
                        }
                        catch (e) {
                            rules = previous;
                            throw e;
                        }
                    }
                    break;
                case 'copy':
                    if (existing) await copyProxy(existing);
                    break;
                case 'selectProxy':
                    if(existing)await selectProxy(existing.id);
                    break;
                case 'disableProxy':
                    await selectProxy(undefined);
                    break;
                case 'newProxyTerminal':
                    if(existing)await selectProxy(existing.id);else newProxyTerminal();
                    break;
                case 'probe':
                    if (existing) {
                        try {
                            await probe(existing.targetHost, existing.targetPort);
                            notices.delete(existing.id);
                        }
                        catch (e) {
                            notices.set(existing.id, explainSystemError(e, 'target'));
                            throw new Error(notices.get(existing.id));
                        }
                        vscode.window.showInformationMessage(t `本机 ${existing.targetHost}:${existing.targetPort} TCP 可连接。此检查不验证代理协议或完整隧道。`);
                    }
                    break;
                case 'logs':
                    output.show(true);
                    break;
                case 'diagnose':
                    await diagnose();
                    break;
                case 'stopAll':
                    workflow.cancel();
                    manager.stopAll();
                    break;
            }
        }
        catch (e) {
            if(message.type==='save')view?.webview.postMessage({type:'saveFailed'});
            vscode.window.showErrorMessage(t `反向端口：${e.message}`);
        }
        finally {
            busy = false;
            await send();
        }
    }
    const provider = { resolveWebviewView(webviewView) {
            view = webviewView;
            const webview = view.webview;
            webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
            const nonce = randomBytes(18).toString('base64');
            let html = renderLocalizedHtml(fs.readFileSync(path.join(context.extensionPath, 'media', 'panel.html'), 'utf8'), vscode.env.language);
            html = html.replaceAll('{{CSP}}', webview.cspSource).replaceAll('{{NONCE}}', nonce)
                .replace('{{STYLE}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'panel.css')).toString())
                .replace('{{SCRIPT}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'panel.js')).toString())
                .replace('{{I18N_SCRIPT}}', webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'i18n.js')).toString());
            webview.html = html;
            webview.onDidReceiveMessage(handle, undefined, context.subscriptions);
            view.onDidDispose(() => { if (view === webviewView)
                view = undefined; }, undefined, context.subscriptions);
        } };
    const report=fn=>async(...args)=>{try{return await fn(...args);}catch(e){vscode.window.showErrorMessage(t`反向端口：${e.message}`);}};
    context.subscriptions.push(output, manager, terminalProxy,
        vscode.workspace.onDidChangeWorkspaceFolders(()=>void syncProxy()),
        vscode.workspace.onDidChangeConfiguration(event=>{if(event.affectsConfiguration('reversePorts')){terminalProxy.invalidate();void syncProxy();}}),
        vscode.commands.registerCommand('reversePorts.selectProxy',report(async id=>{const rule=await pickRule(id);if(rule)await selectProxy(rule.id);})),
        vscode.commands.registerCommand('reversePorts.copyProxy',report(async id=>{const rule=await pickRule(id);if(rule)await copyProxy(rule);})),
        vscode.commands.registerCommand('reversePorts.disableProxy',report(()=>selectProxy(undefined))),
        vscode.commands.registerCommand('reversePorts.newProxyTerminal',report(async id=>{if(id)await selectProxy(id);else newProxyTerminal();})),
        vscode.window.registerWebviewViewProvider('reversePorts.view', provider, { webviewOptions: { retainContextWhenHidden: true } }), vscode.commands.registerCommand('reversePorts.open', () => vscode.commands.executeCommand('reversePorts.view.focus')), vscode.commands.registerCommand('reversePorts.stopAll', () => manager.stopAll()), vscode.commands.registerCommand('reversePorts.diagnose', () => diagnose().catch(e => vscode.window.showErrorMessage(t `反向端口：${e.message}`))), vscode.commands.registerCommand('reversePorts.logs', () => output.show(true)));
    void syncProxy();
    // Public diagnostic surface for extension-host smoke tests; never exposes credentials.
    return { getRules: () => rules.map(r => ({ ...r })), getStatus: id => manager.status(id), getTerminalProxy:()=>({...terminalProxy.state}) };
}
module.exports = { activate };
