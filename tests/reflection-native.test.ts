import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NativeReflectionExecutor } from '../apps/host/reflection/native-executor.js';
import { buildReflectionNative } from '../scripts/build-reflection-native.js';

test('Reflection fails closed without a packaged runtime', async () => {
  const executor = new NativeReflectionExecutor('/missing/Agent.app');
  assert.equal((await executor.available()).available, false);
  await assert.rejects(executor.execute({ kind: 'start' }, async () => ({}), new AbortController().signal));
});

test('packaged XPC isolates Node and shell while Host handles bounded IPC', {
  skip: process.platform !== 'darwin',
  timeout: 240_000,
}, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'agent-reflection-native-'));
  const outside = await mkdtemp(join(homedir(), '.agent-reflection-canary-'));
  try {
    const bundle = join(scratch, 'Agent.app');
    await mkdir(join(bundle, 'Contents/MacOS'), { recursive: true });
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    await writeFile(
      join(bundle, 'Contents/Info.plist'),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.personal.agent.native-test</string><key>CFBundleExecutable</key><string>Agent</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
    );
    await writeFile(join(scratch, 'main.c'), 'int main(void) { return 0; }');
    assert.equal(spawnSync('clang', [join(scratch, 'main.c'), '-o', join(bundle, 'Contents/MacOS/Agent')]).status, 0);
    const hostDist = join(scratch, 'host');
    await mkdir(join(hostDist, 'reflection'), { recursive: true });
    await mkdir(join(scratch, 'shared'));
    await writeFile(join(scratch, 'shared/sensitive-data.js'), 'export const sharedResource = true;');
    await writeFile(
      join(hostDist, 'reflection/worker.js'),
      `
      import { createInterface } from 'node:readline';
      import { readFile } from 'node:fs/promises';
      import { spawnSync } from 'node:child_process';
      import { sharedResource } from '../../shared/sensitive-data.js';
      const lines = createInterface({ input: process.stdin });
      let started = false;
      lines.on('line', async line => {
        const message = JSON.parse(line);
        if (message.kind === 'start' && !started) {
          started = true;
          let denied = false;
          try { await readFile(message.canary); } catch (error) { denied = ['EPERM','EACCES'].includes(error.code); }
          const shell = spawnSync('/bin/sh', ['-c', 'cat "$1"', 'reflection-probe', message.canary], { encoding: 'utf8' });
          const shellDenied = shell.status !== 0 && !shell.stdout?.includes(message.canaryValue);
          console.log(JSON.stringify({ kind: 'ready', pid: process.pid }));
          console.log(JSON.stringify({ kind: 'request', requestId: 'probe-1', operation: 'probe', input: { denied, shellDenied, sharedResource, cwd: process.cwd(), agentDir: process.env.AGENT_REFLECTION_AGENT_DIR, envKeys: Object.keys(process.env) } }));
        } else if (message.kind === 'response') {
          console.log(JSON.stringify({ kind: 'finished', ok: message.ok }));
          // A terminal message is not proof that the process has already exited.
          setTimeout(() => process.exit(0), 50);
        }
      });
    `,
    );
    await buildReflectionNative(bundle, hostDist);
    const canary = join(outside, 'credential.txt'),
      canaryValue = randomUUID();
    await writeFile(canary, canaryValue, { mode: 0o600 });
    const executor = new NativeReflectionExecutor(bundle);
    const availability = await executor.available();
    if (!process.env.AGENT_CODESIGN_IDENTITY) {
      assert.equal(availability.available, false);
      assert.match(availability.reason ?? '', /签名/);
      await assert.rejects(executor.execute({ kind: 'start' }, async () => ({}), new AbortController().signal));
      t.skip('Real XPC isolation requires an Apple signing identity; ad-hoc identity is correctly unavailable');
      return;
    }
    assert.deepEqual(availability, { available: true });
    let probe:
      | {
          denied: boolean;
          shellDenied: boolean;
          sharedResource: boolean;
          cwd: string;
          agentDir: string;
          envKeys: string[];
        }
      | undefined;
    await executor.execute(
      {
        kind: 'start',
        runId: randomUUID(),
        sessionId: randomUUID(),
        project: outside,
        prompt: 'probe',
        model: {},
        canary,
        canaryValue,
      },
      async (operation, input) => {
        assert.equal(operation, 'probe');
        probe = input as typeof probe;
        return { ok: true };
      },
      new AbortController().signal,
    );
    assert.ok(probe);
    assert.equal(probe.denied, true);
    assert.equal(probe.shellDenied, true);
    assert.equal(probe.sharedResource, true);
    assert.ok(probe.agentDir.startsWith(probe.cwd));
    assert.equal(probe.envKeys.includes('AGENT_DATA_KEY'), false);
    assert.equal(await readFile(canary, 'utf8'), canaryValue);
    const manifest = JSON.parse(
      await readFile(
        join(bundle, 'Contents/Helpers/ReflectionBridge.app/Contents/Resources/reflection-runtime.json'),
        'utf8',
      ),
    );
    assert.equal(manifest.version, packageJson.version);
    assert.match(manifest.node.url, /^https:\/\/nodejs\.org\/dist\//);
    assert.match(manifest.node.sha256, /^[a-f0-9]{64}$/);
  } finally {
    if (process.env.AGENT_KEEP_NATIVE_FIXTURE === '1') console.log(`Native fixture: ${scratch}`);
    else await rm(scratch, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
