import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AgentService } from '../../../../apps/host/runtime/agent';
import type { ReflectionRecord } from '../../../../apps/host/reflection/reflection-service';
test('SIGKILL after committed effect: restart interrupts job, preserves record and never replays effect', {
  timeout: 35000,
}, async () => {
  const base = fileURLToPath(new URL('..', import.meta.url));
  await mkdir(join(base, '.runtime'), { recursive: true });
  const root = await mkdtemp(join(base, '.runtime/crash-')),
    key = randomBytes(32);
  await mkdir(root, { recursive: true });
  const config = join(root, 'private.json');
  await writeFile(config, JSON.stringify({ root, key: key.toString('base64') }), { mode: 0o600 });
  const child = fork(fileURLToPath(new URL('../scripts/crash-host.ts', import.meta.url)), [config], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let committed: { id: string; changes: ReflectionRecord['changes']; status: string };
  try {
    committed = (
      await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(([code]) => {
          throw new Error(`crash fixture exited early: ${code}`);
        }),
      ])
    )[0];
    assert.equal(committed.status, 'running');
    assert.equal(committed.changes.length, 1);
  } finally {
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
  }
  let replay = 0;
  const host = new AgentService(join(root, 'data'), key, {
    reflectionExecutor: {
      async available() {
        return { available: true };
      },
      async execute() {
        replay++;
      },
    },
  });
  try {
    await host.init();
    const record = host.reflection.get(committed.id);
    assert.equal(record.status, 'interrupted');
    assert.deepEqual(record.changes, committed.changes);
    assert.equal(host.memory.search({ actor: 'user', project: root }).total, 1);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(replay, 0);
    await writeFile(
      join(base, 'evidence/crash.json'),
      JSON.stringify(
        { mode: 'controlled formal Host; actual SIGKILL', before: committed, after: record, replay, passed: true },
        null,
        2,
      ),
    );
  } finally {
    await host.close();
  }
});
