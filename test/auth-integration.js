'use strict';
// Optional real OpenSSH test against auth-ssh-fixture.py. No VS Code UI is mocked here.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { TunnelManager } = require('../src/core');
const { createAskpass } = require('../src/askpass');
const root = path.resolve(process.argv[2] || 'test-results/auth-fixture');
async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
async function wait(manager, id, expected) {
    const deadline = Date.now() + 20000;
    while (manager.status(id).state !== expected) {
        if (Date.now() > deadline || manager.status(id).state === 'error')
            throw new Error(JSON.stringify(manager.status(id)));
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}
async function main() {
    const fixture = JSON.parse(await fs.readFile(path.join(root, 'fixture.json'), 'utf8'));
    for (const [host, expected] of [['rp-direct', 1], ['rp-one-jump', 2], ['rp-two-jumps', 3]]) {
        for (let retryAt = 0; retryAt <= expected; retryAt++) {
            let prompts = 0;
            const auth = await createAskpass(async question => {
                prompts++;
                if (prompts === retryAt) return 'intentionally-wrong-test-password';
                const role = question.match(/(destination|jump1|jump2)@/)?.[1];
                assert(role, `Unrecognized test prompt: ${question}`);
                return `${role}-test-only-password`;
            });
            const manager = new TunnelManager({ config: () => ({ configFile: path.join(root, `${host}.config`) }) });
            const rule = { id: host, name: host, host, remotePort: await freePort(), targetHost: '127.0.0.1', targetPort: fixture.targetPort };
            try {
                manager.start(rule, auth);
                await wait(manager, host, 'running');
                assert.equal(prompts, expected + Number(retryAt > 0));
                if (!retryAt) await new Promise(resolve => setTimeout(resolve, 1500));
                assert.equal(manager.status(host).state, 'running');
                const response = await fetch(`http://127.0.0.1:${rule.remotePort}/auth-test/${host}`, { signal: AbortSignal.timeout(5000) });
                assert.equal(await response.text(), 'reverse-ports-password-e2e-ok');
                manager.stop(host);
                await wait(manager, host, 'stopped');
                console.log(`PASS ${host}: ${prompts} prompts, ${retryAt ? `wrong-password retry at step ${retryAt}, ` : ''}HTTP reverse forwarding and stop`);
            } finally { manager.dispose(); auth.dispose(); }
        }
    }
    for (const [host, count] of [['rp-direct', 1], ['rp-one-jump', 2], ['rp-two-jumps', 3]]) {
        for (let cancelAt = 1; cancelAt <= count; cancelAt++) {
            let prompts = 0;
            const auth = await createAskpass(async question => {
                if (++prompts === cancelAt) return undefined;
                return `${question.match(/(destination|jump1|jump2)@/)[1]}-test-only-password`;
            });
            const manager = new TunnelManager({ config: () => ({ configFile: path.join(root, `${host}.config`) }) });
            try {
                manager.start({ id: host, name: host, host, remotePort: await freePort(), targetHost: '127.0.0.1', targetPort: fixture.targetPort }, auth);
                await wait(manager, host, 'stopped');
                assert.equal(prompts, cancelAt);
                console.log(`PASS ${host}: cancel password at step ${cancelAt} stops connection`);
            } finally { manager.dispose(); auth.dispose(); }
        }
    }
    for (let slowAt = 1; slowAt <= 3; slowAt++) {
        let slowPrompts = 0;
        const auth = await createAskpass(async question => {
            if (++slowPrompts === slowAt) await new Promise(resolve => setTimeout(resolve, 14000));
            return `${question.match(/(destination|jump1|jump2)@/)[1]}-test-only-password`;
        });
        const manager = new TunnelManager({ startTimeout: 2000, config: () => ({ configFile: path.join(root, 'rp-two-jumps.config') }) });
        try {
            const rule = { id: 'slow', name: 'slow', host: 'rp-two-jumps', remotePort: await freePort(), targetHost: '127.0.0.1', targetPort: fixture.targetPort };
            manager.start(rule, auth);
            await wait(manager, 'slow', 'running');
            const response = await fetch(`http://127.0.0.1:${rule.remotePort}/slow-input`, { signal: AbortSignal.timeout(5000) });
            assert.equal(await response.text(), 'reverse-ports-password-e2e-ok');
            assert.equal(slowPrompts, 3);
            manager.stop('slow'); await wait(manager, 'slow', 'stopped');
            console.log(`PASS rp-two-jumps: 14-second input delay at step ${slowAt} exceeds old timeouts; forwarding still works`);
        } finally { manager.dispose(); auth.dispose(); }
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
