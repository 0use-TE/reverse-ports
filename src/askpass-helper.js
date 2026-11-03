'use strict';
// OpenSSH runs this through the platform launcher; stdout is reserved for its answer.
const http = require('node:http');
const request = http.request({
    hostname: '127.0.0.1', port: Number(process.env.REVERSE_PORTS_ASKPASS_PORT),
    method: 'POST', path: '/', agent: false,
    headers: { Authorization: `Bearer ${process.env.REVERSE_PORTS_ASKPASS_TOKEN}` }
}, response => {
    if (response.statusCode !== 200) { response.resume(); process.exitCode = 1; return; }
    response.pipe(process.stdout);
    response.on('error', () => { process.exitCode = 1; });
});
request.on('error', () => { process.exitCode = 1; });
request.end(process.argv.slice(2).join(' '));
