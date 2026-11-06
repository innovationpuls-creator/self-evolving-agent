import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { AgentService } from '../apps/host/runtime/agent.js';
import { startHost } from '../apps/host/transport/server.js';
import { environmentChecked, environmentNotice } from '../apps/web/src/features/reflection/reflection-notice.js';

test('every completed Host environment check emits a reflection event even when no Job changes', async () => {
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
    assert.equal(events, 0);
    release();
    await host.reflection.availability();
    const unavailable = host.reflection.catalog().availability;
    assert.equal(environmentChecked(unavailable), true);
    assert.equal(environmentNotice(unavailable), '自动复盘暂不可用');
    assert.equal(events, 1);
    available = true;
    await host.reflection.recheck();
    assert.equal(environmentNotice(host.reflection.catalog().availability), undefined);
    assert.equal(host.reflection.jobs.list().length, 0);
    assert.equal(events, 2);
  } finally {
    release();
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a recheck from one client reaches another connected client with no waiting Jobs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reflection-two-client-test-'));
  const token = randomBytes(32).toString('hex'),
    key = randomBytes(32);
  let available = false;
  const service = new AgentService(join(dir, 'data'), key, {
    reflectionExecutor: {
      async available() {
        return available ? { available: true } : { available: false, reason: 'fixture unavailable' };
      },
      async execute() {},
    },
  });
  const host = await startHost({ dataDir: join(dir, 'data'), key, token, service });
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${host.origin}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const connect = async () => {
    const ws = new WebSocket(`${host.origin.replace('http', 'ws')}/events`, { origin: host.origin });
    const messages: Array<{ type: string }> = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'authenticate', token }));
    await once(ws, 'message');
    assert.equal(messages[0]?.type, 'connected');
    return { ws, messages };
  };
  const waitFor = async (check: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!check()) {
      assert.ok(Date.now() < deadline, 'timed out waiting for Host event');
      await new Promise((ok) => setTimeout(ok, 10));
    }
  };
  const a = await connect(),
    b = await connect();
  try {
    // The idle Host performs its first check on its own; settle it before measuring the recheck.
    await waitFor(() => environmentChecked(service.reflection.catalog().availability));
    await new Promise((ok) => setTimeout(ok, 50));
    const view = '/reflections?view=summary&limit=20&offset=0';
    const stale = await request(view);
    assert.equal(stale.jobs.length, 0);
    assert.equal(environmentNotice(stale.availability), '自动复盘暂不可用');
    a.messages.length = 0;
    b.messages.length = 0;
    available = true;
    const result = await request('/reflections/recheck', 'POST', {});
    assert.equal(result.availability.available, true);
    // B never sent anything and has no focus or visibility signal: only the Host push tells it to re-read.
    await waitFor(() => b.messages.some((message) => message.type === 'reflection'));
    assert.deepEqual(
      b.messages.filter((message) => message.type === 'reflection'),
      [{ type: 'reflection' }],
    );
    const fresh = await request(view);
    assert.equal(fresh.jobs.length, 0);
    assert.ok(fresh.availability.checkedAt > stale.availability.checkedAt);
    assert.equal(environmentNotice(fresh.availability), undefined);
  } finally {
    a.ws.close();
    b.ws.close();
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
