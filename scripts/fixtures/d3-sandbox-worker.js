// Adversarial fixture only. Never installed in the product Worker.
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { get } from 'node:http';
async function probe(input) {
  const files = input.paths.map((path) => {
    let read = 'ALLOWED', write = 'ALLOWED';
    try { readFileSync(path); } catch (e) { read = e.code; }
    try { writeFileSync(path, 'UNAUTHORIZED'); } catch (e) { write = e.code; }
    return { path, read, write };
  });
  const actualFiles = (input.actualPaths ?? []).map((path) => {
    let read = 'ALLOWED', writeOpen = 'ALLOWED';
    try { const fd = openSync(path, 'r'); closeSync(fd); } catch (e) { read = e.code; }
    // No truncation or writes to real files, even if the boundary unexpectedly fails.
    try { const fd = openSync(path, 'r+'); closeSync(fd); } catch (e) { writeOpen = e.code; }
    return { path, read, writeOpen };
  });
  const tcp = await new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: input.port });
    socket.on('connect', () => { socket.destroy(); resolve('ALLOWED'); });
    socket.on('error', (e) => resolve(e.code));
    socket.setTimeout(3000, () => { socket.destroy(); resolve('TIMEOUT'); });
  });
  const http = await new Promise((resolve) => {
    const request = get(`http://127.0.0.1:${input.port}/`, (response) => { response.resume(); resolve('ALLOWED'); });
    request.on('error', (e) => resolve(e.code));
    request.setTimeout(3000, () => { request.destroy(); resolve('TIMEOUT'); });
  });
  const externalTcp = await new Promise((resolve) => {
    const socket = connect({ host: input.externalAddress, port: 443 });
    socket.on('connect', () => { socket.destroy(); resolve('ALLOWED'); });
    socket.on('error', (e) => resolve(e.code));
    socket.setTimeout(3000, () => { socket.destroy(); resolve('TIMEOUT'); });
  });
  return { files, actualFiles, tcp, http, externalTcp };
}
if (process.argv[2] === 'child') console.log(JSON.stringify(await probe(JSON.parse(process.argv[3]))));
else {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', async (line) => {
    const message = JSON.parse(line);
    if (message.kind === 'start') {
      const direct = await probe(message);
      const args = [process.argv[1], 'child', JSON.stringify(message)];
      const node = spawnSync(process.execPath, args, { encoding: 'utf8' });
      const shell = spawnSync('/bin/sh', ['-c', '"$@" & wait "$!"', 'probe', process.execPath, ...args], { encoding: 'utf8' });
      const cat = spawnSync('/bin/cat', [message.paths[0]], { encoding: 'utf8' });
      console.log(JSON.stringify({ kind: 'request', requestId: 'probe', operation: 'probe', input: {
        direct, node: { status: node.status, result: node.stdout.trim(), error: node.stderr.trim() },
        shell: { status: shell.status, result: shell.stdout.trim(), error: shell.stderr.trim() },
        cat: { status: cat.status, outputEmpty: cat.stdout.length === 0, error: cat.stderr.trim() },
        envKeys: Object.keys(process.env), pid: process.pid, cwd: process.cwd(),
      } }));
    } else if (message.kind === 'response') {
      console.log(JSON.stringify({ kind: 'finished', ok: message.ok })); process.exit(message.ok ? 0 : 1);
    }
  });
}
