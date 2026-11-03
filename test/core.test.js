'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const net = require('node:net');
const { validateRule, buildArgs, explainError, explainSystemError, checkEnvironment, probe, TunnelManager } = require('../src/core');
require('../src/localization').setLanguage('zh-cn');
const rule = { id: 'test', name: '代理', host: 'ouse@192.168.1.180', remotePort: 17890, targetHost: '127.0.0.1', targetPort: 7897 };
function fake() {
  const child = new EventEmitter();
  child.pid = 123; child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.exitCode = null; child.signalCode = null; child.kills = [];
  child.kill = signal => { child.kills.push(signal || 'SIGTERM'); return true; }; return child;
}
test('reject malformed ports, ssh option injection, and command text', () => {
  for (const remotePort of [0,65536,'2x','1.5','']) assert.throws(() => validateRule({ ...rule, remotePort }));
  for (const host of ['-oProxyCommand=calc','host; echo hi','host\nfoo','host name']) assert.throws(() => validateRule({ ...rule, host }));
  assert.throws(() => validateRule({ ...rule, targetHost: 'localhost:80;foo' }));
  assert.equal(validateRule({ ...rule, host: '索尔' }).host, '索尔');
});
test('argv forwards remote loopback to local service without shell interpolation', () => {
  const args = buildArgs(rule, { configFile: 'C:\\My SSH\\config' }, 'READY_TEST');
  assert.deepEqual(args.slice(0,2), ['-F','C:\\My SSH\\config']);
  assert.equal(args[args.indexOf('-R') + 1], '127.0.0.1:17890:127.0.0.1:7897');
  assert(args.includes('ExitOnForwardFailure=yes'));
  assert(args.includes('BatchMode=yes')); assert(args.includes('StrictHostKeyChecking=yes'));
  assert.equal(buildArgs({ ...rule, targetHost: '::1' }, {}, 'READY_TEST').at(-3), '127.0.0.1:17890:[::1]:7897');
});
test('state only becomes running after complete readiness marker; duplicate start rejected; stop cleans process', () => {
  const child = fake(); let args;
  const manager = new TunnelManager({ spawn: (_exe,a,options) => { args = a; assert.equal(options.shell,false); return child; } });
  manager.start(rule); assert.equal(manager.status(rule.id).state,'starting');
  child.stdout.write('login banner\n'); assert.equal(manager.status(rule.id).state,'starting');
  const marker = args.at(-1).match(/REVERSE_PORTS_READY_[a-f0-9]+/)[0];
  child.stdout.write(marker.slice(0,20)); child.stdout.write(marker.slice(20)+'\n');
  assert.equal(manager.status(rule.id).state,'running');
  assert.throws(() => manager.start(rule));
  assert.throws(() => manager.start({ ...rule, id: 'other' }));
  manager.stop(rule.id); assert.equal(manager.status(rule.id).state,'stopping'); assert.equal(child.kills.length,1);
  child.emit('close',0,null); assert.equal(manager.status(rule.id).state,'stopped'); manager.dispose();
});
test('forward failure and missing ssh yield useful error states', () => {
  const child = fake(); const manager = new TunnelManager({ spawn: () => child });
  manager.start(rule); child.stderr.write('remote port forwarding failed for listen port 17890'); child.emit('close',255,null);
  assert.equal(manager.status(rule.id).state,'error'); assert.match(manager.status(rule.id).error,/占用/);
  const missing = new TunnelManager({ spawn: () => { throw new Error('ENOENT'); } });
  missing.start(rule); assert.equal(missing.status(rule.id).state,'error'); manager.dispose(); missing.dispose();
  assert.match(explainError('Permission denied (publickey).'),/认证失败/);
});
test('startup timeout kills ssh; dispose prevents further starts', async () => {
  const child = fake(); const manager = new TunnelManager({ spawn: () => child, startTimeout: 20 });
  manager.start(rule); await new Promise(resolve => setTimeout(resolve,40));
  assert.equal(manager.status(rule.id).state,'error'); assert.equal(child.kills.length,1);
  child.emit('close',null,'SIGTERM'); manager.dispose(); assert.throws(() => manager.start(rule));
});
test('local target TCP probe reports success and refusal', async () => {
  const server = net.createServer(socket => socket.end()); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const n = server.address().port; await probe('127.0.0.1',n);
  await new Promise(resolve => server.close(resolve)); await assert.rejects(probe('127.0.0.1',n));
});
test('system errors give Chinese recovery steps without requiring proxy or SSH agent variables', async () => {
  assert.match(explainSystemError({ code: 'ENOENT' }), /PATH/);
  assert.match(explainSystemError({ code: 'EACCES' }), /权限/);
  assert.match(explainSystemError({ code: 'ECONNREFUSED' }, 'target'), /先启动/);
  assert.match(explainSystemError({ code: 'ENOTFOUND' }, 'target'), /解析/);
  const result = await checkEnvironment({}, (_exe,args,_options,callback) => { assert.deepEqual(args,['-V']); callback(null,'','OpenSSH_test'); });
  assert.equal(result.version,'OpenSSH_test');
  await assert.rejects(checkEnvironment({}, (_exe,_args,_options,callback) => callback({code:'ENOENT'})), /找不到本机 SSH/);
  await assert.rejects(checkEnvironment({configFile: require('node:path').join(__dirname,'no-such-config')}), /配置文件不存在/);
});
test('network and SSH restrictions distinguish likely causes in Chinese', () => {
  const cases = [
    ['Could not resolve hostname thor', /解析/], ['connect to host x port 22: Connection refused', /拒绝/],
    ['Connection timed out', /超时/], ['Host key verification failed.', /主机密钥/],
    ['UNPROTECTED PRIVATE KEY FILE!', /权限/], ['Bad configuration option: xyz', /配置文件/],
    ['administratively prohibited', /禁止/], ['Connection reset by peer', /断开/],
    ['Cannot execute command-line and remote command.', /RemoteCommand/],
    ['remote port forwarding failed for listen port 7890', /可能已被占用.*也可能/]
  ];
  for (const [text,expected] of cases) assert.match(explainError(text),expected);
});
test('asynchronous ssh spawn error is translated and remains error after close', () => {
  const child=fake(); const manager=new TunnelManager({spawn:()=>child});
  manager.start(rule); child.emit('error',Object.assign(new Error('spawn ssh ENOENT'),{code:'ENOENT'}));
  child.emit('close',-4058,null); assert.match(manager.status(rule.id).error,/OpenSSH.*PATH/); manager.dispose();
});
