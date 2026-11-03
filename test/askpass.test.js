'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createAskpass } = require('../src/askpass');
const run = promisify(execFile);
const helper = path.resolve(__dirname, '../src/askpass-helper.js');

test('askpass helper returns a secret through authenticated IPC and rejects other clients', async () => {
    const auth = await createAskpass(async question => {
        assert.equal(question, "user@jump's password:");
        return 'test secret 中文 & % ! "';
    });
    try {
        const result = await run(process.execPath, [helper, "user@jump's password:"], { env: auth.env });
        assert.equal(result.stdout, 'test secret 中文 & % ! "');
        assert.equal(result.stderr, '');
        const status = await new Promise((resolve, reject) => {
            const request = http.request({ host: '127.0.0.1', port: auth.env.REVERSE_PORTS_ASKPASS_PORT, method: 'POST' }, response => {
                response.resume(); resolve(response.statusCode);
            });
            request.on('error', reject); request.end('unauthorized');
        });
        assert.equal(status, 403);
    } finally { auth.dispose(); }
});

test('canceling a prompt fails the helper and notifies the tunnel', async () => {
    const auth = await createAskpass(async () => undefined);
    let canceled = false;
    auth.onCancel = () => { canceled = true; };
    try {
        await assert.rejects(run(process.execPath, [helper, 'Password:'], { env: auth.env }), error => error.code === 1 && error.stdout === '');
        assert.equal(canceled, true);
    } finally { auth.dispose(); }
});

test('disposing authentication aborts an outstanding input', async () => {
    let shown;
    const ready = new Promise(resolve => { shown = resolve; });
    const auth = await createAskpass((_question, signal) => new Promise(resolve => {
        signal.addEventListener('abort', () => resolve(undefined), { once: true }); shown();
    }));
    const child = run(process.execPath, [helper, 'Password:'], { env: auth.env });
    const rejected = assert.rejects(child);
    await ready; auth.dispose(); await rejected;
});

test('native OpenSSH launches askpass to unlock an encrypted private key', async t => {
    try { await run('ssh-keygen', ['-?']); }
    catch (error) { if (error.code === 'ENOENT') { t.skip('OpenSSH is unavailable'); return; } }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reverse-ports-key-test-'));
    const key = path.join(directory, 'key');
    let prompts = 0;
    const auth = await createAskpass(async () => { prompts++; return 'test-only-passphrase'; });
    try {
        await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'test-only-passphrase', '-f', key]);
        const result = await run('ssh-keygen', ['-y', '-f', key], { env: auth.env, timeout: 10000 });
        assert.match(result.stdout, /^ssh-ed25519 /);
        assert.equal(prompts, 1);
    } finally { auth.dispose(); await fs.rm(directory, { recursive: true, force: true }); }
});
