'use strict';
// Explicit integration test: local HTTP server, remote Python in memory, no remote files.
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const { TunnelManager } = require('../src/core');
const { proxyCommands } = require('../src/terminal-proxy');
require('../src/localization').setLanguage('zh-cn');
const exec = promisify(execFile);
const host = process.env.TEST_SSH_HOST;
if (!host) throw new Error('Set TEST_SSH_HOST to your SSH host alias before running this integration test.');
const remotePort = Number(process.env.TEST_REMOTE_PORT || 47891);
const manager = new TunnelManager({ log: console.log });
const server = http.createServer((_req,res) => res.end('reverse-ports-integration-ok'));
function waitFor(predicate, timeout = 20000) { return new Promise((resolve,reject) => {
  const started = Date.now(); const timer=setInterval(() => {
    try { if(predicate()) { clearInterval(timer); resolve(); } else if(Date.now()-started>timeout) { clearInterval(timer); reject(new Error('timeout')); } }
    catch(e) { clearInterval(timer); reject(e); }
  },50);
}); }
(async () => {
  try {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const rule = { id: 'integration', name: '端到端测试', host, remotePort, targetHost: '127.0.0.1', targetPort: server.address().port };
    manager.start(rule);
    await waitFor(() => { const s=manager.status(rule.id); if(s.state==='error') throw new Error(s.error); return s.state==='running'; });
    const py = `import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:${remotePort}', timeout=5).read().decode())`;
    const result = await exec('ssh',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',host,`python3 -c "${py}"`],{timeout:12000,windowsHide:true});
    assert.equal(result.stdout.trim(),'reverse-ports-integration-ok');
    console.log('PASS: Thor remote HTTP request reached local server through reverse tunnel.');
    const script=`set -eu\nexport NO_PROXY=internal.example no_proxy=lower.example\n${proxyCommands(rule)}\nprintf '%s\\n' "$HTTP_PROXY" "$http_proxy" "$HTTPS_PROXY" "$https_proxy" "$NO_PROXY" "$no_proxy"\ncurl -fsS --max-time 8 http://reverse-ports-test.invalid/check\n`;
    const environmentResult=await new Promise((resolve,reject)=>{
      const child=require('node:child_process').execFile('ssh',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',host,'sh -s'],{timeout:15000,windowsHide:true},(error,stdout,stderr)=>error?reject(new Error(`${error.message}\n${stderr}`)):resolve(stdout));
      child.stdin.end(script);
    });
    const lines=environmentResult.split(/\r?\n/);
    assert.deepEqual(lines.slice(0,4),Array(4).fill(`http://127.0.0.1:${remotePort}`));
    assert.equal(lines[4],'localhost,127.0.0.1,::1,internal.example,lower.example');assert.equal(lines[4],lines[5]);
    assert.match(environmentResult,/reverse-ports-integration-ok/);
    console.log('PASS: all three copied export lines work on Thor, preserve exclusions, and curl uses the reverse proxy.');
    const duplicate = new TunnelManager();
    duplicate.start({ ...rule, id: 'conflict' });
    await waitFor(() => duplicate.status('conflict').state==='error');
    assert.match(duplicate.status('conflict').error,/占用/); duplicate.dispose();
    console.log('PASS: occupied remote port is reported as failure, not connected.');
    manager.stop(rule.id); await waitFor(() => manager.status(rule.id).state==='stopped');
    const check = `import socket; s=socket.socket(); s.settimeout(3); print(s.connect_ex(('127.0.0.1',${remotePort}))); s.close()`;
    const closed = await exec('ssh',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',host,`python3 -c "${check}"`],{timeout:12000,windowsHide:true});
    assert.notEqual(closed.stdout.trim(),'0'); console.log('PASS: stop releases remote listening port. No remote files created.');
  } finally { manager.dispose(); server.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
