import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { fauxProvider, fauxThinking } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { startHost } from '../apps/host/transport/server.js';
import { EncryptedStore, SensitiveData, snapshot, restore } from '../apps/host/storage/storage.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-')),
    token = randomBytes(32).toString('hex'),
    key = randomBytes(32);
  const host = await startHost({ dataDir: join(dir, 'data'), key, token });
  const fake = fauxProvider({
    models: [{ id: 'test-model', contextWindow: 262144, maxTokens: 512 }],
    tokensPerSecond: 10000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);
  const request = async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${host.origin}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const create = async () => {
    const response = await request('/sessions', 'POST', { cwd: dir, provider: fake.provider.id, model: 'test-model' });
    assert.equal(response.status, 201);
    return response.json();
  };
  const settle = async (id: string) => {
    const deadline = Date.now() + 10000;
    let state: Awaited<ReturnType<typeof host.service.viewSession>>;
    do {
      await new Promise((ok) => setTimeout(ok, 20));
      state = await (await request(`/sessions/${id}`)).json();
    } while (state.busy && Date.now() < deadline);
    assert.equal(state.busy, false);
    return state;
  };
  return {
    dir,
    key,
    token,
    host,
    fake,
    request,
    create,
    settle,
    close: async () => {
      await host.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('encrypted snapshot preserves non-last selected leaf; wrong key and tamper fail closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-store-'));
  try {
    const key = randomBytes(32),
      store = new EncryptedStore(dir, key),
      manager = SessionManager.inMemory(dir);
    const first = manager.appendMessage({ role: 'user', content: 'secret history sentinel', timestamp: Date.now() });
    manager.appendMessage(fauxAssistantMessage('first branch'));
    manager.branch(first);
    manager.appendMessage(fauxAssistantMessage('second branch'));
    manager.branch(first);
    const saved = snapshot(manager);
    await store.write('test.enc', saved);
    const data = await store.read<typeof saved>('test.enc');
    assert.ok(data);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot(restore(data)))), JSON.parse(JSON.stringify(saved)));
    const bytes = await readFile(join(dir, 'test.enc'), 'utf8');
    assert.ok(!bytes.includes('secret history sentinel'));
    await assert.rejects(new EncryptedStore(dir, randomBytes(32)).read('test.enc'));
    const envelope = JSON.parse(bytes);
    envelope.data = Buffer.from('tamper').toString('base64');
    await writeFile(join(dir, 'test.enc'), JSON.stringify(envelope));
    await assert.rejects(store.read('test.enc'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('boundary redaction protects nested credentials without mutating tool arguments', () => {
  const sensitive = new SensitiveData();
  const secret = 'mock-sensitive-value-12345';
  sensitive.add(secret);
  const source = {
    tool: { apiToken: secret },
    text: `Bearer abcdefghijklmnop email person@example.com`,
    schema: { properties: { apiKey: { type: 'string' } } },
  };
  const projected = sensitive.copy(source);
  assert.ok(!JSON.stringify(projected).includes(secret));
  assert.ok(!projected.text.includes('person@example.com'));
  assert.equal(source.tool.apiToken, secret);
  assert.deepEqual(projected.schema, source.schema);
});

test('HTTP and WebSocket reject unauthenticated, cross-origin and rebinding requests', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(`${f.host.origin}/api/sessions`)).status, 401);
    assert.equal((await f.request('/sessions', 'GET', undefined, { Origin: 'https://evil.example' })).status, 403);
    const rebinding = await new Promise<number | undefined>((ok, fail) => {
      const req = httpRequest(
        `${f.host.origin}/api/sessions`,
        { headers: { Host: 'evil.example', Authorization: `Bearer ${f.token}` } },
        (res) => {
          res.resume();
          ok(res.statusCode);
        },
      );
      req.on('error', fail);
      req.end();
    });
    assert.equal(rebinding, 403);
    assert.equal((await f.request('/connect', 'POST', { token: 'wrong' })).status, 401);
    const login = await f.request('/connect', 'POST', { token: f.token }, { Origin: f.host.origin });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const denied = await fetch(`${f.host.origin}/api/sessions`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(denied.status, 401);
    await new Promise<void>((ok, fail) => {
      const ws = new WebSocket(`${f.host.origin.replace('http', 'ws')}/events`, {
        origin: 'https://evil.example',
        headers: { Authorization: `Bearer ${f.token}` },
      });
      ws.once('unexpected-response', (_req, res) => {
        assert.equal(res.statusCode, 403);
        res.resume();
        ok();
      });
      ws.once('open', () => fail(new Error('untrusted socket opened')));
      ws.once('error', () => {});
    });
  } finally {
    await f.close();
  }
});

test('native tool execution, stream events, independent sessions, branching and encrypted restart', async () => {
  const f = await fixture();
  let second: Awaited<ReturnType<typeof startHost>> | undefined;
  let firstClosed = false;
  try {
    const first = await f.create(),
      other = await f.create();
    assert.notEqual(first.id, other.id);
    const secret = 'mock-tool-secret-preserve-12345';
    f.host.service.sensitive.add(secret);
    f.fake.setResponses([
      fauxAssistantMessage(fauxToolCall('write', { path: 'native.txt', content: secret }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ]);
    const events: string[] = [];
    const ws = new WebSocket(`${f.host.origin.replace('http', 'ws')}/events`, {
      origin: f.host.origin,
      headers: { Authorization: `Bearer ${f.token}` },
    });
    await once(ws, 'open');
    ws.on('message', (value) => events.push(value.toString()));
    assert.equal((await f.request(`/sessions/${first.id}/prompt`, 'POST', { text: 'Write file' })).status, 202);
    const state = await f.settle(first.id);
    ws.close();
    assert.equal(await readFile(join(f.dir, 'native.txt'), 'utf8'), secret, 'native tool arguments must remain exact');
    assert.ok(!JSON.stringify(state).includes(secret));
    assert.ok(!events.join('').includes(secret));
    assert.ok(events.some((e) => e.includes('tool_execution_end')));
    assert.equal((await (await f.request(`/sessions/${other.id}`)).json()).messages.length, 0);
    const leaves = (await f.host.service.store.read<{ session: { entries: Array<{ id: string; type: string }> } }>(
      `sessions/${first.id}.enc`,
    ))!.session.entries;
    const user = leaves.find((e) => e.type === 'message');
    assert.ok(user);
    assert.equal((await f.request(`/sessions/${first.id}/branch`, 'POST', { value: user.id })).status, 200);
    const branched = await (await f.request(`/sessions/${first.id}`)).json();
    await f.host.close();
    firstClosed = true;
    const index = new DatabaseSync(join(f.dir, 'data', 'product.sqlite'));
    index.exec('DELETE FROM sessions');
    index.close();
    second = await startHost({ dataDir: join(f.dir, 'data'), key: f.key, token: f.token });
    second.service.runtime.registerNativeProvider(f.fake.provider);
    const response = await fetch(`${second.origin}/api/sessions/${first.id}`, {
      headers: { Authorization: `Bearer ${f.token}` },
    });
    const restored = await response.json();
    assert.equal((await second.service.list()).length, 2);
    assert.equal(restored.leafId, branched.leafId);
    assert.deepEqual(restored.messages, branched.messages);
  } finally {
    await second?.close();
    if (!firstClosed) await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('running request rejects overlap; stop does not replay work', async () => {
  const f = await fixture();
  try {
    const session = await f.create();
    f.fake.setResponses([
      async (_context, options) => {
        await new Promise<void>((ok) => {
          const timer = setTimeout(ok, 3000);
          options?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              ok();
            },
            { once: true },
          );
        });
        return fauxAssistantMessage('stopped');
      },
    ]);
    assert.equal((await f.request(`/sessions/${session.id}/prompt`, 'POST', { text: 'long task' })).status, 202);
    assert.equal((await f.request(`/sessions/${session.id}/prompt`, 'POST', { text: 'overlap' })).status, 409);
    assert.equal((await f.request(`/sessions/${session.id}/stop`, 'POST', {})).status, 200);
    await f.settle(session.id);
    assert.equal(f.fake.state.callCount, 1);
  } finally {
    await f.close();
  }
});

test('model dispatch refuses unchecked context instead of falling through an Extension hook', async () => {
  const f = await fixture();
  try {
    const original = f.host.service.sensitive.copy.bind(f.host.service.sensitive);
    f.host.service.sensitive.copy = () => {
      throw new Error('simulated mandatory check failure');
    };
    assert.throws(() =>
      f.host.service.runtime.streamSimple(f.fake.getModel(), {
        messages: [{ role: 'user', content: 'must never dispatch', timestamp: Date.now() }],
      }),
    );
    assert.equal(f.fake.state.callCount, 0);
    f.host.service.sensitive.copy = original;
  } finally {
    await f.close();
  }
});

test('parallel sessions keep their conversation separate and native compaction survives recovery', async () => {
  const f = await fixture();
  try {
    const a = await f.create(),
      b = await f.create();
    const reply = async (context: { messages: unknown[] }) =>
      fauxAssistantMessage(JSON.stringify(context.messages).includes('alpha-only') ? 'alpha-result' : 'beta-result');
    f.fake.setResponses([reply, reply]);
    await Promise.all([
      f.request(`/sessions/${a.id}/prompt`, 'POST', { text: 'alpha-only ' + 'historical context '.repeat(6000) }),
      f.request(`/sessions/${b.id}/prompt`, 'POST', { text: 'beta-only' }),
    ]);
    const [sa, sb] = await Promise.all([f.settle(a.id), f.settle(b.id)]);
    assert.ok(JSON.stringify(sa.messages).includes('alpha-result'));
    assert.ok(!JSON.stringify(sa.messages).includes('beta-only'));
    assert.ok(JSON.stringify(sb.messages).includes('beta-result'));
    assert.ok(!JSON.stringify(sb.messages).includes('alpha-only'));
    f.fake.setResponses([fauxAssistantMessage('alpha follow-up result')]);
    await f.request(`/sessions/${a.id}/prompt`, 'POST', { text: 'alpha follow-up ' + 'recent context '.repeat(6500) });
    await f.settle(a.id);
    f.fake.setResponses([fauxAssistantMessage('Summary: user requested alpha-only and received alpha-result.')]);
    await f.host.service.action(a.id, 'compact');
    const saved = await f.host.service.store.read<{ session: ReturnType<typeof snapshot> }>(`sessions/${a.id}.enc`);
    assert.ok(saved);
    assert.ok(saved.session.entries.some((entry) => entry.type === 'compaction'));
    assert.ok(
      restore(saved.session)
        .getEntries()
        .some((entry) => entry.type === 'compaction'),
    );
  } finally {
    await f.close();
  }
});

test('a model error can be retried without restarting the Host', async () => {
  const f = await fixture();
  try {
    const session = await f.create();
    f.fake.setResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'permanent invalid input' })]);
    await f.request(`/sessions/${session.id}/prompt`, 'POST', { text: 'first request' });
    const failed = await f.settle(session.id);
    assert.ok(failed.error);
    assert.equal(failed.interrupted, true);
    f.fake.setResponses([fauxAssistantMessage('recovered')]);
    assert.equal((await f.request(`/sessions/${session.id}/prompt`, 'POST', { text: 'retry request' })).status, 202);
    const recovered = await f.settle(session.id);
    assert.equal(recovered.error, undefined);
    assert.ok(JSON.stringify(recovered.messages).includes('recovered'));
  } finally {
    await f.close();
  }
});

test('all streaming fields and common nested secret formats are protected', () => {
  const s = new SensitiveData();
  s.add('mock-credential-secret-123456789');
  for (const field of ['text', 'thinking', 'command']) {
    const projected = s.copy({ [field]: 'prefix mock-credential-' }, true);
    assert.ok(!JSON.stringify(projected).includes('mock-credential-'), field);
  }
  for (const key of ['access_token', 'refresh_token', 'secret', 'private_key']) {
    assert.ok(!JSON.stringify(s.copy({ [key]: { value: 'opaque value' } })).includes('opaque value'), key);
  }
  for (const key of ['password', 'apiToken', 'api_token', 'token', 'refreshToken', 'access', 'privateKey']) {
    assert.ok(!s.text(`${key}="mock phrase value"`).includes('phrase value'), key);
  }
  assert.ok(!s.text('password="mock phrase\nvalue"').includes('mock phrase'));
});

test('browser authentication does not issue a cross-port cookie', async () => {
  const f = await fixture();
  try {
    const response = await f.request('/connect', 'POST', { token: f.token }, { Origin: f.host.origin });
    assert.equal(response.status, 200);
    assert.ok(!response.headers.get('set-cookie')?.includes('HttpOnly'));
  } finally {
    await f.close();
  }
});

test('WebSocket first-frame authentication gates every event and rejects invalid credentials', async () => {
  const f = await fixture();
  try {
    const ws = new WebSocket(f.host.origin.replace('http', 'ws') + '/events', { origin: f.host.origin });
    const messages: string[] = [];
    ws.on('message', (v) => messages.push(v.toString()));
    await once(ws, 'open');
    f.host.service.emit('event', { type: 'sentinel-before-auth' });
    await new Promise((ok) => setTimeout(ok, 30));
    assert.equal(messages.length, 0);
    ws.send(JSON.stringify({ type: 'authenticate', token: f.token }));
    await once(ws, 'message');
    assert.equal(JSON.parse(messages[0]!).type, 'connected');
    f.host.service.emit('event', { type: 'sentinel-after-auth' });
    await once(ws, 'message');
    assert.match(messages[1]!, /sentinel-after-auth/);
    ws.close();
    const bad = new WebSocket(f.host.origin.replace('http', 'ws') + '/events', { origin: f.host.origin });
    await once(bad, 'open');
    bad.send(JSON.stringify({ type: 'authenticate', token: 'invalid' }));
    const [code] = await once(bad, 'close');
    assert.equal(code, 4401);
  } finally {
    await f.close();
  }
});

test('model, view, events and export protect copies while native history keeps exact values', async () => {
  const f = await fixture();
  try {
    const session = await f.create(),
      secret = 'opaque-authorized-secret-12345';
    f.host.service.sensitive.add(secret);
    let modelContext = '';
    f.fake.setResponses([
      async (context) => {
        modelContext = JSON.stringify(context);
        return fauxAssistantMessage('safe result');
      },
    ]);
    const events: string[] = [];
    f.host.service.on('event', (e) => events.push(JSON.stringify(e)));
    await f.request(`/sessions/${session.id}/prompt`, 'POST', {
      text: `Do not repeat ${secret}; password="mock phrase value"; contact private@example.com`,
    });
    await f.settle(session.id);
    for (const projected of [
      modelContext,
      JSON.stringify(await (await f.request(`/sessions/${session.id}`)).json()),
      events.join('\n'),
      JSON.stringify(await (await f.request(`/sessions/${session.id}/export`)).json()),
    ]) {
      assert.ok(!projected.includes(secret));
      assert.ok(!projected.includes('mock phrase value'));
      assert.ok(!projected.includes('private@example.com'));
    }
    const saved = await f.host.service.store.read<{ session: ReturnType<typeof snapshot> }>(
      `sessions/${session.id}.enc`,
    );
    assert.ok(JSON.stringify(saved).includes(secret));
    const exported = await (await f.request(`/sessions/${session.id}/export`)).json();
    assert.equal(exported.resumable, false);
    const original = f.host.service.sensitive.copy.bind(f.host.service.sensitive);
    f.host.service.sensitive.copy = () => {
      throw new Error('check unavailable');
    };
    assert.equal((await f.request(`/sessions/${session.id}`)).status, 409);
    assert.equal((await f.request(`/sessions/${session.id}/export`)).status, 409);
    f.host.service.sensitive.copy = original;
  } finally {
    await f.close();
  }
});

test('damaged current checkpoint falls back visibly; a wholly broken session cannot hide a healthy session', async () => {
  const f = await fixture();
  let second: Awaited<ReturnType<typeof startHost>> | undefined;
  let closed = false;
  try {
    const good = await f.create(),
      bad = await f.create();
    f.fake.setResponses([fauxAssistantMessage('checkpoint result')]);
    await f.request(`/sessions/${good.id}/prompt`, 'POST', { text: 'checkpoint prompt' });
    await f.settle(good.id);
    const name = `sessions/${good.id}.enc`;
    const previous = await f.host.service.store.read<{ session: ReturnType<typeof snapshot> }>(name + '.prev');
    assert.ok(previous);
    await f.host.close();
    closed = true;
    await writeFile(join(f.dir, 'data', name), '{truncated');
    await writeFile(join(f.dir, 'data', `sessions/${bad.id}.enc`), 'broken');
    second = await startHost({ dataDir: join(f.dir, 'data'), key: f.key, token: f.token });
    second.service.runtime.registerNativeProvider(f.fake.provider);
    const restored = await second.service.viewSession(good.id);
    assert.equal(restored.interrupted, true);
    assert.match(restored.error!, /上一有效检查点/);
    assert.equal(restored.leafId, previous.session.leafId);
    const list = await second.service.list();
    assert.equal(list.length, 2);
    assert.ok(list.find((row) => row.id === bad.id)?.unavailable);
    await assert.rejects(second.service.viewSession(bad.id));
    f.fake.setResponses([fauxAssistantMessage('continued safely')]);
    await second.service.prompt(good.id, 'user explicitly continued');
    while ((await second.service.viewSession(good.id)).busy) await new Promise((ok) => setTimeout(ok, 10));
    const files = await import('node:fs/promises').then((fs) => fs.readdir(join(f.dir, 'data', 'sessions')));
    assert.ok(files.some((name) => name.includes('.corrupt-')));
  } finally {
    await second?.close();
    if (!closed) await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('no valid checkpoint or a wrong vault key cannot start a replacement empty product', async () => {
  const f = await fixture();
  let closed = false;
  try {
    const session = await f.create();
    await f.host.close();
    closed = true;
    const name = join(f.dir, 'data', 'sessions', `${session.id}.enc`);
    await writeFile(name, 'corrupt');
    await assert.rejects(startHost({ dataDir: join(f.dir, 'data'), key: f.key, token: f.token }));
    assert.equal(await readFile(name, 'utf8'), 'corrupt');
    await new EncryptedStore(join(f.dir, 'data'), f.key).write('credentials.enc', {});
    await assert.rejects(startHost({ dataDir: join(f.dir, 'data'), key: randomBytes(32), token: f.token }));
  } finally {
    if (!closed) await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('completed native tool result is checkpointed while the next model response is still pending', async () => {
  const f = await fixture();
  try {
    const session = await f.create();
    let entered = false;
    f.fake.setResponses([
      fauxAssistantMessage(fauxToolCall('write', { path: 'side-effect.txt', content: 'exactly once' }), {
        stopReason: 'toolUse',
      }),
      async (_context, options) => {
        entered = true;
        await new Promise<void>((ok) => {
          if (options?.signal?.aborted) return ok();
          options?.signal?.addEventListener('abort', () => ok(), { once: true });
        });
        return fauxAssistantMessage('aborted');
      },
    ]);
    await f.request(`/sessions/${session.id}/prompt`, 'POST', { text: 'write then await' });
    const deadline = Date.now() + 5000;
    let saved: { session: ReturnType<typeof snapshot>; record: { interrupted: boolean } } | undefined;
    do {
      await new Promise((ok) => setTimeout(ok, 10));
      saved = await f.host.service.store.read<typeof saved>(`sessions/${session.id}.enc`);
    } while ((!entered || !JSON.stringify(saved).includes('toolResult')) && Date.now() < deadline);
    assert.ok(entered);
    assert.ok(saved);
    assert.ok(saved.session.entries.some((e) => e.type === 'message' && e.message.role === 'toolResult'));
    assert.equal(saved.record.interrupted, true);
    assert.equal(await readFile(join(f.dir, 'side-effect.txt'), 'utf8'), 'exactly once');
    assert.ok(
      restore(saved.session)
        .getEntries()
        .some((e) => e.type === 'message' && e.message.role === 'toolResult'),
    );
    await f.host.service.stop(session.id);
  } finally {
    await f.close();
  }
});

test('failed action checkpoint blocks subsequent mutation and still releases every resource', async () => {
  const f = await fixture();
  let closed = false;
  try {
    const session = await f.create();
    const original = f.host.service.store.write.bind(f.host.service.store);
    f.host.service.store.write = async () => {
      throw new Error('disk failure');
    };
    await assert.rejects(f.host.service.action(session.id, 'model', 'test-model', f.fake.provider.id));
    await assert.rejects(f.host.service.prompt(session.id, 'must not run'));
    assert.equal(f.fake.state.callCount, 0);
    f.host.service.store.write = original;
    await assert.rejects(f.host.close());
    closed = true;
    await assert.rejects(fetch(`${f.host.origin}/api/models`));
    const db = new DatabaseSync(join(f.dir, 'data', 'product.sqlite'));
    db.exec('BEGIN EXCLUSIVE; ROLLBACK');
    db.close();
  } finally {
    if (!closed) await f.host.close().catch(() => {});
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('SIGKILL during an active run preserves the last completed tool without replay', { timeout: 20000 }, async () => {
  const { fork } = await import('node:child_process');
  const root = await mkdtemp(join(tmpdir(), 'agent-crash-')),
    key = randomBytes(32),
    token = randomBytes(32).toString('hex');
  const child = fork(new URL('./fixtures/recovery-host.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let restarted: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    const ready = new Promise<{ type: string; origin: string; provider: string }>((ok, fail) => {
      child.once('message', (message) => ok(message as { type: string; origin: string; provider: string }));
      child.once('error', fail);
    });
    child.send({ dataDir: join(root, 'data'), key: key.toString('base64'), token });
    const config = await ready;
    assert.equal(config.type, 'ready');
    const req = (path: string, body: unknown) =>
      fetch(`${config.origin}/api${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const session = await (
      await req('/sessions', { cwd: root, provider: config.provider, model: 'crash-model' })
    ).json();
    await req(`/sessions/${session.id}/prompt`, { text: 'write a file then await' });
    const store = new EncryptedStore(join(root, 'data'), key);
    let saved: { session: ReturnType<typeof snapshot> } | undefined;
    const deadline = Date.now() + 10000;
    do {
      await new Promise((ok) => setTimeout(ok, 20));
      saved = await store.read<typeof saved>(`sessions/${session.id}.enc`);
    } while (!JSON.stringify(saved).includes('toolResult') && Date.now() < deadline);
    assert.ok(saved);
    assert.ok(saved.session.entries.some((e) => e.type === 'message' && e.message.role === 'toolResult'));
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    restarted = await startHost({ dataDir: join(root, 'data'), key, token });
    const fake = fauxProvider({ models: [{ id: 'crash-model', contextWindow: 100000, maxTokens: 512 }] });
    restarted.service.runtime.registerNativeProvider(fake.provider);
    const state = await restarted.service.viewSession(session.id);
    assert.equal(state.interrupted, true);
    assert.equal(state.leafId, saved.session.leafId);
    assert.ok(state.messages.some((e) => e.role === 'toolResult'));
    assert.equal(fake.state.callCount, 0);
    assert.equal(await readFile(join(root, 'crash-side-effect.txt'), 'utf8'), 'one committed side effect');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
    await restarted?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('every native thinking and tool-argument streaming frame protects credential prefixes', async () => {
  const f = await fixture();
  try {
    const session = await f.create(),
      secret = 'mock-complete-stream-credential-123456789';
    f.host.service.sensitive.add(secret);
    f.fake.setResponses([
      fauxAssistantMessage(
        [fauxThinking(secret), fauxToolCall('write', { path: 'stream-secret.txt', content: secret })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(secret),
    ]);
    const frames: string[] = [];
    f.host.service.on('event', (e) => frames.push(JSON.stringify(e)));
    await f.request(`/sessions/${session.id}/prompt`, 'POST', { text: 'run native tool' });
    await f.settle(session.id);
    assert.ok(frames.some((frame) => frame.includes('thinking')));
    assert.ok(frames.some((frame) => frame.includes('toolCall')));
    for (const frame of frames) for (let n = 8; n <= secret.length; n++) assert.ok(!frame.includes(secret.slice(0, n)));
    assert.equal(await readFile(join(f.dir, 'stream-secret.txt'), 'utf8'), secret);
  } finally {
    await f.close();
  }
});

test('oversize and unauthenticated WebSocket handshakes close without crashing the Host', async () => {
  const f = await fixture();
  try {
    const huge = new WebSocket(f.host.origin.replace('http', 'ws') + '/events', { origin: f.host.origin });
    huge.on('error', () => {});
    await once(huge, 'open');
    huge.send('x'.repeat(2048));
    const [code] = await once(huge, 'close');
    assert.equal(code, 1009);
    const idle = new WebSocket(f.host.origin.replace('http', 'ws') + '/events', { origin: f.host.origin });
    await once(idle, 'open');
    const [idleCode] = await once(idle, 'close');
    assert.equal(idleCode, 4401);
    assert.equal((await f.request('/models')).status, 200);
  } finally {
    await f.close();
  }
});

test('the shared HTTP boundary authenticates before invoking an extracted business route', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const models = f.host.service.models.bind(f.host.service);
    f.host.service.models = async () => {
      calls++;
      return models();
    };
    assert.equal((await fetch(`${f.host.origin}/api/models`)).status, 401);
    assert.equal((await f.request('/models', 'GET', undefined, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal(calls, 0);
    assert.equal((await f.request('/models')).status, 200);
    assert.equal(calls, 1);
    assert.equal((await f.request('/models', 'DELETE')).status, 404);
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});

test('PII protection preserves UUID correlation identities but still protects phone numbers and UUID credentials', () => {
  const sensitive = new SensitiveData();
  const id = '00000000-0000-4000-8000-a13812345678';
  assert.equal(sensitive.copy({ id }).id, id);
  assert.match(sensitive.text('Contact a13812345678'), /身份信息已保护/);
  sensitive.add(id);
  assert.equal(sensitive.text(id), '[已保护]');
});
