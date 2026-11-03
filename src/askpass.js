'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { randomBytes } = require('node:crypto');

// One authenticated, loopback-only channel per SSH process. Secrets never touch disk.
async function createAskpass(prompt) {
    const token = randomBytes(32).toString('hex');
    const controller = new AbortController();
    const sockets = new Set();
    let directory;
    let busy = false;
    const auth = { onPrompt() {}, onCancel() {} };
    const server = http.createServer(async (request, response) => {
        if (request.method !== 'POST' || request.url !== '/' || request.headers.authorization !== `Bearer ${token}`) {
            response.writeHead(403).end();
            return;
        }
        if (busy || controller.signal.aborted) { response.writeHead(409).end(); return; }
        busy = true;
        let body = '';
        try {
            for await (const chunk of request) {
                body += chunk.toString();
                if (body.length > 16384) throw new Error('Oversized SSH prompt');
            }
            auth.onPrompt(true);
            const value = await prompt(body, controller.signal);
            if (controller.signal.aborted) return;
            if (value === undefined) {
                response.writeHead(204).end();
                auth.onCancel();
            } else {
                response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
                response.end(value);
            }
        } catch {
            response.writeHead(500).end();
            auth.onCancel();
        } finally {
            busy = false;
            auth.onPrompt(false);
        }
    });
    server.on('connection', socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    auth.dispose = () => {
        if (controller.signal.aborted) return;
        controller.abort();
        server.close();
        for (const socket of sockets) socket.destroy();
        if (directory) void fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    };
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        server.unref();
        let launcher = path.join(__dirname, 'askpass.cmd');
        if (process.platform !== 'win32') {
            directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reverse-ports-'));
            launcher = path.join(directory, 'askpass');
            await fs.writeFile(launcher, '#!/bin/sh\nexec "$REVERSE_PORTS_NODE" "$REVERSE_PORTS_ASKPASS_HELPER" "$@"\n', { mode: 0o700 });
        }
        auth.env = {
            ...process.env, SSH_ASKPASS: launcher, SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: process.env.DISPLAY || 'reverse-ports', ELECTRON_RUN_AS_NODE: '1',
            REVERSE_PORTS_NODE: process.execPath,
            REVERSE_PORTS_ASKPASS_HELPER: path.join(__dirname, 'askpass-helper.js'),
            REVERSE_PORTS_ASKPASS_PORT: String(server.address().port),
            REVERSE_PORTS_ASKPASS_TOKEN: token
        };
        return auth;
    } catch (error) { auth.dispose(); throw error; }
}
module.exports = { createAskpass };
