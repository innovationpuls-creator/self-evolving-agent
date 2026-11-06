import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { createServer, connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NativeReflectionExecutor } from '../../apps/host/reflection/native-executor.js';
import { buildReflectionNative } from '../build-reflection-native.js';
const identity = process.env.AGENT_CODESIGN_IDENTITY;
assert.ok(identity && identity !== '-', 'An existing Apple identity is required');
const product = resolve(
  process.env.AGENT_REFLECTION_APP_BUNDLE ?? 'release/d3-development-20261020/Agent-darwin-arm64/Agent.app',
);
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  product,
  scope: 'Real XPC adversarial fixture; separate from unchanged product Worker business acceptance',
};
const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function signingInfo(path: string) {
  run('codesign', ['--verify', '--deep', '--strict', path]);
  const r = spawnSync('codesign', ['-d', '--verbose=4', '-r-', '--entitlements', ':-', path], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const text = r.stdout + r.stderr;
  assert.match(text, /Authority=Apple Development:/);
  assert.match(text, /Authority=Apple Worldwide Developer Relations/);
  return { path, team: /TeamIdentifier=(\w+)/.exec(text)?.[1], details: text };
}
const bridgeRelative = 'Contents/Helpers/ReflectionBridge.app';
const serviceRelative = `${bridgeRelative}/Contents/XPCServices/dev.personal.agent.reflection.xpc`;
const signatures = [
  product,
  join(product, bridgeRelative),
  join(product, serviceRelative),
  join(product, serviceRelative, 'Contents/MacOS/ReflectionNode'),
  ...(await readdir(join(product, 'Contents/Frameworks')))
    .filter((name) => /\.(app|framework)$/.test(name))
    .map((name) => join(product, 'Contents/Frameworks', name)),
].map(signingInfo);
assert.equal(new Set(signatures.map((s) => s.team)).size, 1);
assert.ok(signatures[0]?.team);
receipt.signatures = signatures;
receipt.productWorkerSha256 = createHash('sha256')
  .update(await readFile(join(product, serviceRelative, 'Contents/Resources/runtime/dist/host/reflection/worker.js')))
  .digest('hex');
const scratch = await mkdtemp(join(tmpdir(), 'd3-sandbox-'));
const outside = await mkdtemp(join(homedir(), '.d3-protected-'));
const server = createServer((socket) => {
  socket.on('error', () => {}); // The TCP positive control closes before consuming HTTP bytes.
  socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK');
});
interface Result {
  files: Array<{ path: string; read: string; write: string }>;
  actualFiles: Array<{ path: string; read: string; writeOpen: string }>;
  tcp: string;
  http: string;
  externalTcp: string;
}
interface Probe {
  direct: Result;
  node: { status: number; result: string; error: string };
  shell: { status: number; result: string; error: string };
  cat: { status: number; outputEmpty: boolean; error: string };
  envKeys: string[];
}
try {
  const externalAddress = (await lookup('example.com', { family: 4 })).address;
  await new Promise<void>((ok, reject) => {
    const socket = connect(443, externalAddress, () => {
      socket.destroy();
      ok();
    });
    socket.on('error', reject);
    socket.setTimeout(10000, () => {
      socket.destroy();
      reject(new Error('Host external TCP positive control timed out'));
    });
  });
  receipt.externalPositiveControl = { host: 'example.com', address: externalAddress, port: 443, connected: true };
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((ok, reject) => {
    const socket = connect(address.port, '127.0.0.1', () => {
      socket.destroy();
      ok();
    });
    socket.on('error', reject);
  });
  const paths = [
    'host/credentials.enc',
    'protected/history.enc',
    'skills/official/SKILL.md',
    'tools/tool.js',
    'hooks/hook.js',
    'rules/AGENTS.md',
  ].map((name) => join(outside, name));
  const originals = new Map<string, string>();
  for (const path of paths) {
    await mkdir(join(path, '..'), { recursive: true });
    const value = randomUUID();
    await writeFile(path, value, { mode: 0o600 });
    assert.equal(await readFile(path, 'utf8'), value);
    originals.set(path, value);
  }
  const bundle = join(scratch, 'Agent.app');
  const actualPaths = [resolve('AGENTS.md'), resolve('apps/host/skills/skills.ts')];
  if (process.env.AGENT_D3_CREDENTIAL_FILE) actualPaths.push(resolve(process.env.AGENT_D3_CREDENTIAL_FILE));
  for (const path of actualPaths) {
    const fd = await open(path, 'r+');
    await fd.close();
  }
  await mkdir(join(bundle, 'Contents/MacOS'), { recursive: true });
  await writeFile(
    join(bundle, 'Contents/Info.plist'),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.personal.agent.native-acceptance</string><key>CFBundleExecutable</key><string>Agent</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
  );
  await writeFile(join(scratch, 'main.c'), 'int main(void){return 0;}');
  run('clang', [join(scratch, 'main.c'), '-o', join(bundle, 'Contents/MacOS/Agent')]);
  const hostDist = join(scratch, 'host');
  await mkdir(join(hostDist, 'reflection'), { recursive: true });
  await cp('scripts/archive/fixtures/d3-sandbox-worker.js', join(hostDist, 'reflection/worker.js'));
  await buildReflectionNative(bundle, hostDist);
  const executor = new NativeReflectionExecutor(bundle);
  assert.deepEqual(await executor.available(), { available: true });
  let probe: Probe | undefined;
  await executor.execute(
    { kind: 'start', paths, actualPaths, port: address.port, externalAddress },
    async (operation, input) => {
      assert.equal(operation, 'probe');
      probe = input as Probe;
      return {};
    },
    AbortSignal.timeout(30000),
  );
  assert.ok(probe);
  const denied = (result: Result) => {
    for (const file of result.files) {
      assert.match(file.read, /^(EPERM|EACCES)$/);
      assert.match(file.write, /^(EPERM|EACCES)$/);
    }
    assert.equal(result.actualFiles.length, actualPaths.length);
    for (const file of result.actualFiles) {
      assert.match(file.read, /^(EPERM|EACCES)$/);
      assert.match(file.writeOpen, /^(EPERM|EACCES)$/);
    }
    assert.match(result.tcp, /^(EPERM|EACCES)$/);
    assert.match(result.http, /^(EPERM|EACCES)$/);
    assert.match(result.externalTcp, /^(EPERM|EACCES)$/);
  };
  denied(probe.direct);
  for (const child of [probe.node, probe.shell]) {
    assert.equal(child.status, 0, child.error);
    denied(JSON.parse(child.result) as Result);
  }
  assert.notEqual(probe.cat.status, 0);
  assert.equal(probe.cat.outputEmpty, true);
  assert.match(probe.cat.error, /Operation not permitted|Permission denied/);
  assert.equal(probe.envKeys.includes('AGENT_DATA_KEY'), false);
  for (const path of paths) assert.equal(await readFile(path, 'utf8'), originals.get(path));
  receipt.probe = probe;
  receipt.realFileOpenControls = { actualPaths, hostReadWriteOpen: true, noRealFileContentsReadOrWritten: true };
  receipt.hostPositiveControls = { existingReadableWritableFiles: paths, loopbackTcp: true, contentsUnchanged: true };
  const bridge = join(bundle, bridgeRelative),
    helper = join(bridge, 'Contents/MacOS/reflection-bridge');
  const sign = (path: string, id: string, identifier?: string) =>
    run('codesign', [
      '--force',
      '--sign',
      id,
      '--timestamp=none',
      ...(identifier ? ['--identifier', identifier] : []),
      path,
    ]);
  const negative = async () =>
    new Promise<{ code: number | null; messages: unknown[] }>((ok, reject) => {
      const child = spawn(helper, [], { env: { PATH: '/usr/bin:/bin' } });
      const output: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Identity rejection timed out'));
      }, 10000);
      child.stdout.on('data', (d: Buffer) => output.push(d));
      child.stderr.resume();
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const messages = Buffer.concat(output)
            .toString()
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((s) => JSON.parse(s) as { kind: string; ok?: boolean });
          assert.notEqual(code, 0);
          assert.ok(messages.some((m) => m.kind === 'finished' && m.ok === false));
          assert.equal(
            messages.some((m) => m.kind === 'request' || m.kind === 'ready'),
            false,
          );
          ok({ code, messages });
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.write(JSON.stringify({ kind: 'start', paths, port: address.port }) + '\n');
    });
  sign(bridge, identity, 'dev.personal.agent.wrong-bridge');
  sign(bundle, identity);
  receipt.wrongBridgeIdentifier = await negative();
  sign(bridge, '-', 'dev.personal.agent.reflection-bridge');
  sign(bundle, identity);
  receipt.adHocBridge = await negative();
  sign(bridge, identity, 'dev.personal.agent.reflection-bridge');
  sign(bundle, identity);
  await writeFile(
    join(bundle, serviceRelative, 'Contents/Resources/runtime/dist/host/reflection/worker.js'),
    '// tampered sealed resource',
  );
  receipt.tamperedService = await negative();
  receipt.passed = true;
} catch (error) {
  receipt.passed = false;
  receipt.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  server.close();
  await rm(scratch, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
  await writeFile('docs/evidence/d3-development-sandbox.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ passed: receipt.passed, error: receipt.error }));
}
