'use strict';
const { EventEmitter } = require('node:events');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { t } = require('./localization');
function port(value) {
    const n = Number(value);
    if (!/^\d+$/.test(String(value)) || !Number.isInteger(n) || n < 1 || n > 65535)
        throw new Error(t("端口必须是 1～65535 的整数"));
    return n;
}
function validateRule(input) {
    if (!input || typeof input !== 'object')
        throw new Error(t("无效的转发配置"));
    const host = String(input.host || '').trim();
    // Destination is one argv element, never shell text. Reject options and control characters.
    if (!/^(?:[\w.-]+@)?[\w\u0080-￿][\w.\u0080-￿:-]*$/u.test(host))
        throw new Error(t("SSH 主机请填写配置别名、IP 或 user@host，不要填写命令或空格"));
    const targetHost = String(input.targetHost || '127.0.0.1').trim();
    if (!/^[a-zA-Z0-9_.:-]+$/.test(targetHost) || targetHost.startsWith('-'))
        throw new Error(t("本机目标地址无效"));
    const name = String(input.name || t("反向转发")).trim();
    if (!name || name.length > 80)
        throw new Error(t("名称长度应为 1～80 个字符"));
    return { id: typeof input.id === 'string' && /^[\w-]{1,80}$/.test(input.id) ? input.id : randomUUID(), name, host, remotePort: port(input.remotePort), targetHost, targetPort: port(input.targetPort) };
}
function bracket(host) { return host.includes(':') ? `[${host}]` : host; }
function buildArgs(rule, config, marker) {
    rule = validateRule(rule);
    const args = [];
    if (config.configFile)
        args.push('-F', config.configFile);
    // With ProxyJump, the outer SSH banner wait includes time spent in jump-host
    // password dialogs. The pausable manager timer owns interactive startup limits.
    args.push('-T', '-o', `BatchMode=${config.interactiveAuth ? 'no' : 'yes'}`, '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes', '-o', `ConnectTimeout=${config.interactiveAuth ? 0 : 12}`, '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-R', `127.0.0.1:${rule.remotePort}:${bracket(rule.targetHost)}:${rule.targetPort}`, rule.host,
    // No remote file writes: print a readiness marker, then keep stdin open with cat.
    `printf '${marker}\\n'; cat`);
    return args;
}
function explainError(text) {
    if (/remote port forwarding failed|cannot listen to port/i.test(text))
        return t("远程监听端口申请失败：可能已被占用，也可能被 SSH 服务器禁止。请更换远程端口；若仍失败，检查服务端 AllowTcpForwarding / PermitListen。");
    if (/permission denied/i.test(text))
        return t("SSH 认证失败。请检查密码、私钥口令或 SSH Agent，以及服务器允许的认证方式。");
    if (/host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text))
        return t("主机密钥未确认或已变化，请先在本机终端 SSH 连接并核验。");
    if (/could not resolve hostname|name or service not known/i.test(text))
        return t("无法解析 SSH 主机。请检查别名、IP，以及本机 SSH 配置文件。");
    if (/connection refused/i.test(text))
        return t("SSH 连接被拒绝。请检查远程 SSH 服务是否启动，以及配置中的 SSH 端口。");
    if (/timed out|timeout|no route to host|network is unreachable/i.test(text))
        return t("SSH 连接超时或网络不可达。请检查网络、VPN、主机 IP 和 SSH 端口。");
    if (/bad owner or permissions|unprotected private key file/i.test(text))
        return t("SSH 配置或私钥权限不正确。请查看日志中的文件路径，修正权限后重试。");
    if (/bad configuration|bad config|bad owner|can't open user config|cannot open user config/i.test(text))
        return t("本机 SSH 配置文件无效或不可读取，请检查设置和日志。");
    if (/administratively prohibited|forwarding disabled/i.test(text))
        return t("SSH 服务器禁止这条端口转发，请检查 AllowTcpForwarding / PermitListen 等服务端限制。");
    if (/connection reset|broken pipe|connection closed|disconnected/i.test(text))
        return t("SSH 连接已断开。请检查远程主机和网络，然后手动重新启动隧道。");
    if (/cannot execute command-line and remote command/i.test(text))
        return t("SSH 配置设置了 RemoteCommand，与隧道就绪检测冲突。请为此隧道使用没有 RemoteCommand 的 SSH 别名。");
    return t("SSH 连接未能保持。请打开\u201C日志\u201D查看原始原因。");
}
function explainSystemError(error, context = 'ssh') {
    const code = error.code;
    if (context === 'target') {
        if (code === 'ECONNREFUSED')
            return t("本机目标端口没有接受连接。请先启动代理或目标服务，并核对地址和端口。");
        if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
            return t("本机无法解析目标地址，请检查目标主机名。");
        if (code === 'ETIMEDOUT' || /超时/.test(error.message))
            return t("连接本机目标超时，请检查服务监听地址和防火墙。");
        return t `本机目标连接失败（${code || t("未知原因")}），请检查服务和网络。`;
    }
    if (code === 'ENOENT')
        return t("找不到本机 SSH 程序。请安装 OpenSSH 客户端并加入 PATH，或在设置中指定 reversePorts.sshPath 的完整路径；修改 PATH 后请重启 VS Code。");
    if (code === 'EACCES' || code === 'EPERM')
        return t("没有权限启动本机 SSH 程序。请检查可执行文件权限和安全软件限制。");
    return t("无法启动本机 SSH 程序，请执行\u201C环境检查\u201D并查看日志。");
}
async function checkEnvironment(config = {}, run = execFile) {
    if (config.configFile) {
        try {
            await fs.promises.access(config.configFile, fs.constants.R_OK);
        }
        catch {
            throw new Error(t("指定的 SSH 配置文件不存在或不可读取，请检查 reversePorts.sshConfigFile。"));
        }
    }
    return new Promise((resolve, reject) => {
        run(config.sshPath || 'ssh', ['-V'], { timeout: 5000, windowsHide: true, shell: false }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(explainSystemError(error)));
                return;
            }
            resolve({ version: `${stdout || ''} ${stderr || ''}`.trim() });
        });
    });
}
function probe(host, targetPort, timeout = 2500) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port: targetPort });
        socket.setTimeout(timeout);
        socket.once('connect', () => { socket.destroy(); resolve(); });
        socket.once('error', reject);
        socket.once('timeout', () => { socket.destroy(); reject(Object.assign(new Error(t("连接超时")), { code: 'ETIMEDOUT' })); });
    });
}
class TunnelManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.sessions = new Map();
        this.spawn = options.spawn || spawn;
        this.log = options.log || (() => { });
        this.config = options.config || (() => ({}));
        this.startTimeout = options.startTimeout || 25000;
        this.disposed = false;
    }
    status(id) {
        const s = this.sessions.get(id);
        return s ? { state: s.state, error: s.error || '', pid: s.child?.pid } : { state: 'stopped', error: '' };
    }
    start(input, authentication) {
        if (this.disposed)
            throw new Error(t("管理器已关闭"));
        const rule = validateRule(input);
        if (['starting', 'running', 'stopping'].includes(this.status(rule.id).state))
            throw new Error(t("该隧道已启动或正在停止"));
        for (const s of this.sessions.values()) {
            if (['starting', 'running', 'stopping'].includes(s.state) && s.rule.host === rule.host && s.rule.remotePort === rule.remotePort)
                throw new Error(t("已有规则占用了该主机的远程端口"));
        }
        const marker = `REVERSE_PORTS_READY_${randomUUID().replaceAll('-', '')}`;
        const config = this.config();
        const s = { rule, state: 'starting', error: '', stderr: '', stdout: '', child: undefined, authentication };
        this.sessions.set(rule.id, s);
        let child;
        try {
            child = this.spawn(config.sshPath || 'ssh', buildArgs(rule, { ...config, interactiveAuth: !!authentication }, marker), { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...(authentication ? { env: authentication.env } : {}) });
        }
        catch (e) {
            authentication?.dispose();
            s.state = 'error';
            s.error = explainSystemError(e);
            this.log(`[${rule.name}] ${e.message}`);
            this.emit('change');
            return;
        }
        s.child = child;
        this.log(t `[${rule.name}] 连接 ${rule.host}，远程 127.0.0.1:${rule.remotePort} → 本机 ${rule.targetHost}:${rule.targetPort}`);
        let timer;
        const armTimer = () => { timer = setTimeout(() => {
            if (s.state === 'starting') {
                s.error = t("SSH 启动超时，未收到远程就绪确认。");
                s.state = 'error';
                child.kill();
                authentication?.dispose();
                this.emit('change');
            }
        }, this.startTimeout); timer.unref?.(); };
        armTimer();
        if (authentication) {
            authentication.onPrompt = pending => {
                clearTimeout(timer);
                if (!pending && s.state === 'starting') armTimer();
            };
            authentication.onCancel = () => this.stop(rule.id);
        }
        child.stdin.on('error', () => { });
        child.stdout.on('data', chunk => {
            s.stdout = (s.stdout + chunk.toString()).slice(-8192);
            if (s.state === 'starting' && s.stdout.includes(marker)) {
                clearTimeout(timer);
                s.state = 'running';
                // Earlier failed attempts must not mislabel a later disconnection.
                s.stderr = '';
                authentication?.dispose();
                this.log(t `[${rule.name}] 隧道已建立（目标服务可用性需单独测试）`);
                this.emit('change');
            }
        });
        child.stderr.on('data', chunk => { const text = chunk.toString(); s.stderr = (s.stderr + text).slice(-8192); this.log(`[${rule.name}] ${text.trim()}`); });
        child.on('error', error => { clearTimeout(timer); authentication?.dispose(); if (s.state !== 'stopping') {
            s.state = 'error';
            s.error = explainSystemError(error);
            this.log(`[${rule.name}] ${error.message}`);
        } this.emit('change'); });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            authentication?.dispose();
            clearTimeout(s.killTimer);
            if (s.state === 'stopping') {
                s.state = 'stopped';
                s.error = '';
            }
            else if (s.state !== 'error') {
                s.state = 'error';
                s.error = explainError(s.stderr);
            }
            this.log(t `[${rule.name}] SSH 已退出，code=${code}, signal=${signal || '-'}`);
            this.emit('change');
        });
        this.emit('change');
    }
    stop(id) {
        const s = this.sessions.get(id);
        if (!s || !['starting', 'running'].includes(s.state))
            return;
        s.state = 'stopping';
        s.authentication?.dispose();
        s.child.stdin.end();
        s.child.kill();
        s.killTimer = setTimeout(() => { if (s.child.exitCode === null && s.child.signalCode === null)
            s.child.kill('SIGKILL'); }, 1500);
        s.killTimer.unref?.();
        this.emit('change');
    }
    stopAll() { for (const id of this.sessions.keys())
        this.stop(id); }
    dispose() { this.disposed = true; this.stopAll(); }
}
module.exports = { validateRule, buildArgs, explainError, explainSystemError, checkEnvironment, probe, TunnelManager };
