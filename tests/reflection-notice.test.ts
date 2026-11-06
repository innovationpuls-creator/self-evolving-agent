import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentService } from '../apps/host/runtime/agent.js';
import { environmentChecked, environmentNotice } from '../apps/web/src/features/reflection/reflection-notice.js';

test('reflection notice follows every Host environment state without a Host event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-notice-test-'));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let available = false;
  const host = new AgentService(join(dir, 'data'), randomBytes(32), {
    reflectionExecutor: {
      async available() {
        await gate;
        return available ? { available: true } : { available: false, reason: 'fixture unavailable' };
      },
      async execute() {},
    },
  });
  let events = 0;
  host.on('event', (event: { type: string }) => {
    if (event.type === 'reflection') events++;
  });
  try {
    await host.init();
    const before = host.reflection.catalog().availability;
    assert.equal(environmentChecked(before), false);
    assert.equal(environmentNotice(before), '尚未检查自动复盘环境');
    release();
    await host.reflection.availability();
    const unavailable = host.reflection.catalog().availability;
    assert.equal(environmentChecked(unavailable), true);
    assert.equal(environmentNotice(unavailable), '自动复盘暂不可用');
    available = true;
    await host.reflection.recheck();
    assert.equal(environmentNotice(host.reflection.catalog().availability), undefined);
    // No Job changed, so the web layer cannot rely on agent-reflection-changed for these transitions.
    assert.equal(events, 0);
  } finally {
    release();
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
