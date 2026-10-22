import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startHost } from '../apps/host/transport/server.js';

test('unresponsive authenticated WebSockets are terminated and responsive peers continue receiving events', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'd5-websocket-'));
  const token = randomBytes(32).toString('hex');
  const host = await startHost({ dataDir: join(root, 'data'), key: randomBytes(32), token });
  t.mock.timers.enable({ apis: ['setInterval'] });
  // The heartbeat was installed before fake timers; restart using the same isolated directory.
  await host.close();
  const running = await startHost({ dataDir: join(root, 'next'), key: randomBytes(32), token });
  const good = new WebSocket(`${running.origin.replace('http', 'ws')}/events`, {
    origin: running.origin,
    headers: { Authorization: `Bearer ${token}` },
  });
  const dead = new WebSocket(`${running.origin.replace('http', 'ws')}/events`, {
    origin: running.origin,
    headers: { Authorization: `Bearer ${token}` },
    autoPong: false,
  });
  try {
    await Promise.all([once(good, 'open'), once(dead, 'open')]);
    const firstPing = once(good, 'ping');
    t.mock.timers.tick(30000);
    await firstPing;
    // Let the automatic pong traverse the actual local socket.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const deadClosed = once(dead, 'close');
    const secondPing = once(good, 'ping');
    t.mock.timers.tick(30000);
    await Promise.all([deadClosed, secondPing]);
    const received = once(good, 'message');
    running.service.emit('event', { type: 'diagnostic' });
    assert.deepEqual(JSON.parse(String((await received)[0])), { type: 'diagnostic' });
    assert.equal(dead.readyState, WebSocket.CLOSED);
    assert.equal(good.readyState, WebSocket.OPEN);
  } finally {
    good.terminate();
    dead.terminate();
    t.mock.timers.reset();
    await running.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('idle Session release preserves non-last branches, history and client versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'd5-runtime-'));
  const token = randomBytes(32).toString('hex');
  const host = await startHost({ dataDir: join(root, 'data'), key: randomBytes(32), token });
  const { fauxProvider } = await import('@earendil-works/pi-ai/providers/faux');
  const { fauxAssistantMessage } = await import('@earendil-works/pi-ai');
  const fake = fauxProvider({
    models: [{ id: 'test', contextWindow: 262144, maxTokens: 512 }],
    tokensPerSecond: 100000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);
  try {
    const session = await host.service.create(root, fake.provider.id, 'test');
    fake.setResponses([fauxAssistantMessage('saved result')]);
    await host.service.prompt(session.id, 'history must survive release');
    let before = await host.service.viewSession(session.id);
    while (before.busy) {
      await new Promise((r) => setTimeout(r, 10));
      before = await host.service.viewSession(session.id);
    }
    const checkpoint = await host.service.store.read<{ session: { entries: { type: string; id: string }[] } }>(
      `sessions/${session.id}.enc`,
    );
    assert.ok(checkpoint);
    const selected = checkpoint.session.entries.find((entry) => entry.type === 'message');
    assert.ok(selected);
    await host.service.action(session.id, 'branch', selected.id);
    before = await host.service.viewSession(session.id);
    assert.equal(before.leafId, selected.id);
    assert.equal(await host.service.releaseIdleSessions(0), 1);
    const after = await host.service.viewSession(session.id);
    assert.deepEqual(after.messages, before.messages);
    assert.deepEqual(after.tree, before.tree);
    assert.equal(after.leafId, before.leafId);
    assert.ok(after.stateVersion >= before.stateVersion, 'client state must not regress after idle reload');
    fake.setResponses([fauxAssistantMessage('continued')]);
    await host.service.prompt(session.id, 'continue after release');
    let continued = await host.service.viewSession(session.id);
    while (continued.busy) {
      await new Promise((r) => setTimeout(r, 10));
      continued = await host.service.viewSession(session.id);
    }
    assert.ok(continued.stateVersion > after.stateVersion);
    assert.ok(continued.messages.length > after.messages.length);
    assert.equal(await host.service.releaseIdleSessions(), 0, 'freshly used Session remains resident');
    // A request admitted in transport before its body arrives must block maintenance too.
    const finish = host.service.admitRequest();
    await assert.rejects(host.service.prepareMaintenance(), /活动任务/);
    finish();
    assert.equal((await host.service.viewSession(session.id)).id, session.id);
    await host.service.prepareMaintenance();
    await assert.rejects(host.service.viewSession(session.id), /正在退出/);
    await assert.rejects(host.service.prompt(session.id, 'must not run'), /正在退出/);
    const response = await fetch(`${host.origin}/api/sessions`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 409, 'maintenance closes HTTP admission');
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('maintenance rejects an active model without aborting it and later succeeds after it settles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'd5-maintenance-'));
  const host = await startHost({
    dataDir: join(root, 'data'),
    key: randomBytes(32),
    token: randomBytes(32).toString('hex'),
  });
  const { fauxProvider } = await import('@earendil-works/pi-ai/providers/faux');
  const { fauxAssistantMessage } = await import('@earendil-works/pi-ai');
  const fake = fauxProvider({
    models: [{ id: 'test', contextWindow: 262144, maxTokens: 512 }],
    tokensPerSecond: 100000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);
  let resolveResponse!: () => void;
  const waiting = new Promise<void>((resolve) => {
    resolveResponse = resolve;
  });
  try {
    const session = await host.service.create(root, fake.provider.id, 'test');
    fake.setResponses([
      async () => {
        await waiting;
        return fauxAssistantMessage('not aborted');
      },
    ]);
    await host.service.prompt(session.id, 'long task');
    assert.equal(await host.service.releaseIdleSessions(0), 0, 'active Session cannot be released');
    await assert.rejects(host.service.prepareMaintenance(), /活动任务/);
    assert.equal((await host.service.viewSession(session.id)).busy, true);
    resolveResponse();
    while ((await host.service.viewSession(session.id)).busy) await new Promise((r) => setTimeout(r, 10));
    assert.ok(JSON.stringify((await host.service.viewSession(session.id)).messages).includes('not aborted'));
    await host.service.prepareMaintenance();
  } finally {
    resolveResponse();
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('idle release does not dispose a Session accessed again while its final save is settling', async () => {
  const root = await mkdtemp(join(tmpdir(), 'd5-release-race-'));
  const host = await startHost({
    dataDir: join(root, 'data'),
    key: randomBytes(32),
    token: randomBytes(32).toString('hex'),
  });
  const { fauxProvider } = await import('@earendil-works/pi-ai/providers/faux');
  const { fauxAssistantMessage } = await import('@earendil-works/pi-ai');
  const fake = fauxProvider({
    models: [{ id: 'test', contextWindow: 262144, maxTokens: 512 }],
    tokensPerSecond: 100000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);
  try {
    const session = await host.service.create(root, fake.provider.id, 'test');
    fake.setResponses([fauxAssistantMessage('concurrent task preserved')]);
    const releasing = host.service.releaseIdleSessions(0);
    await host.service.prompt(session.id, 'new activity races idle release');
    assert.equal(await releasing, 0);
    while ((await host.service.viewSession(session.id)).busy) await new Promise((r) => setTimeout(r, 10));
    assert.ok(
      JSON.stringify((await host.service.viewSession(session.id)).messages).includes('concurrent task preserved'),
    );
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('successful Reflection model requests remove their abort listeners before retaining a finished run', async () => {
  const { getEventListeners } = await import('node:events');
  const { AgentService } = await import('../apps/host/runtime/agent.js');
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const { snapshot } = await import('../apps/host/storage/storage.js');
  const { fauxProvider } = await import('@earendil-works/pi-ai/providers/faux');
  const { fauxAssistantMessage } = await import('@earendil-works/pi-ai');
  type Message = ReturnType<typeof fauxAssistantMessage>;
  const root = await mkdtemp(join(tmpdir(), 'd5-reflection-listener-'));
  let modelSignal: AbortSignal | undefined;
  let remaining: number | undefined;
  const host = new AgentService(join(root, 'data'), randomBytes(32), {
    reflectionDelayMs: 0,
    // Protocol test only: native signed XPC is exercised separately by d5-stability.ts.
    reflectionExecutor: {
      async available() {
        return { available: true };
      },
      async execute(raw, handle) {
        const start = raw as { sessionId: string; project: string; prompt: string };
        const manager = SessionManager.inMemory(start.project, { id: start.sessionId });
        const input = { role: 'user' as const, content: start.prompt, timestamp: Date.now() };
        manager.appendMessage(input);
        const response = (await handle('model', {
          modelId: 'reflection-host-approved',
          context: { messages: [input] },
        })) as Message;
        assert.ok(modelSignal);
        remaining = getEventListeners(modelSignal, 'abort').length;
        manager.appendMessage(response);
        await handle('checkpoint', snapshot(manager));
        await handle('complete', { diagnosticFailure: false });
      },
    },
  });
  try {
    await host.init();
    const fake = fauxProvider({
      models: [{ id: 'test', contextWindow: 262144, maxTokens: 512 }],
      tokensPerSecond: 100000,
    });
    host.runtime.registerNativeProvider(fake.provider);
    fake.setResponses([
      fauxAssistantMessage('normal task'),
      async (_context, options) => {
        modelSignal = options?.signal;
        return fauxAssistantMessage('reflection finished');
      },
    ]);
    const session = await host.create(root, fake.provider.id, 'test');
    await host.prompt(session.id, 'trigger review');
    const deadline = Date.now() + 10000;
    while (!host.reflection.jobs.list().some((j) => j.status === 'succeeded')) {
      assert.ok(Date.now() < deadline, 'Reflection did not finish');
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(remaining, 0, 'A completed request cannot retain Reflection or Host through an abort listener');
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Host shutdown drains an authenticated partial HTTP body before closing SQLite and releasing its data lock', async () => {
  const { request } = await import('node:http');
  const root = await mkdtemp(join(tmpdir(), 'd5-http-drain-'));
  const key = randomBytes(32),
    token = randomBytes(32).toString('hex');
  const host = await startHost({ dataDir: join(root, 'data'), key, token });
  let admitted!: () => void;
  const admission = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  const original = host.service.admitRequest.bind(host.service);
  host.service.admitRequest = () => {
    const done = original();
    admitted();
    return done;
  };
  const data = JSON.stringify({
    knowledge: {
      title: 'Shutdown evidence',
      content: 'Committed before closing storage',
      kind: 'experience',
      scope: 'global',
    },
    reason: 'Explicit local test',
  });
  let closed = false;
  const req = request(`${host.origin}/api/memory`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  });
  const response = new Promise<number | undefined>((resolve, reject) => {
    req.once('response', (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.once('error', reject);
  });
  try {
    req.write(data.slice(0, 20));
    await admission;
    const stopping = host.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(closed, false, 'Storage must remain available while an admitted request is reading its body');
    req.end(data.slice(20));
    assert.equal(await response, 201);
    await stopping;
    const restarted = await startHost({ dataDir: join(root, 'data'), key, token });
    try {
      assert.equal(restarted.service.memory.search({ actor: 'user' }, { query: 'Shutdown evidence' }).items.length, 1);
    } finally {
      await restarted.close();
    }
  } finally {
    req.destroy();
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});
