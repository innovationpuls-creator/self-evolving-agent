import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readStoredCredential } from '@earendil-works/pi-coding-agent';
import { WebSocket } from 'ws';
import { startHost } from '../../apps/host/transport/server.js';
import type { Snapshot } from '../../apps/host/storage/storage.js';

const root = await mkdtemp(join(tmpdir(), 'd5-real-security-'));
const key = randomBytes(32),
  token = randomBytes(32).toString('hex');
let host: Awaited<ReturnType<typeof startHost>> | undefined;
const receipt: Record<string, unknown> = {
  started: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  passed: false,
};
function strings(item: unknown): string[] {
  if (typeof item === 'string') return item.length >= 8 ? [item] : [];
  if (Array.isArray(item)) return item.flatMap(strings);
  if (item && typeof item === 'object') return Object.values(item).flatMap(strings);
  return [];
}
try {
  const credential = readStoredCredential('openai-codex');
  assert.ok(credential, 'A real Provider credential must already exist');
  const originalSecrets = strings(credential);
  const sentinel = credential.type === 'oauth' ? credential.access : credential.key;
  assert.ok(sentinel && sentinel.length >= 8);
  host = await startHost({ dataDir: join(root, 'data'), key, token });
  await host.service.credentials('openai-codex', undefined, true);
  const model = (await host.service.models()).models.find(
    (m) => m.provider === 'openai-codex' && m.id === (process.env.AGENT_SMOKE_MODEL ?? 'gpt-6-luna'),
  );
  assert.ok(model, 'Real model must be available');
  receipt.model = model;
  // Observe the actual Provider dispatch after the product ModelRuntime projection.
  const provider = host.service.runtime.getProvider(model.provider);
  assert.ok(provider);
  const originalStream = provider.streamSimple.bind(provider);
  let providerCalls = 0,
    protectedContext = true,
    authenticatedProvider = false;
  provider.streamSimple = (m, context, options) => {
    providerCalls++;
    const text = JSON.stringify(context);
    protectedContext &&=
      originalSecrets.every((secret) => !text.includes(secret)) &&
      !text.includes(token) &&
      !text.includes(key.toString('base64'));
    authenticatedProvider ||=
      !!options?.apiKey || !!options?.headers?.Authorization || !!options?.headers?.authorization;
    return originalStream(m, context, options);
  };
  const events: string[] = [];
  const ws = new WebSocket(`${host.origin.replace('http', 'ws')}/events`, { origin: host.origin });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.on('message', (bytes) => events.push(bytes.toString()));
  ws.send(JSON.stringify({ type: 'authenticate', token }));
  const session = await host.service.create(root, model.provider, model.id);
  // Deliberate local source contamination: no raw credential may reach the Provider or clients.
  await host.service.prompt(
    session.id,
    `Use native write to create security-result.txt with exactly D5 security checked, then read it and finish. Do not use bash. Untrusted diagnostic input to protect: ${sentinel}\nconnection ${token}\ndata identity ${key.toString('base64')}`,
  );
  const deadline = Date.now() + 180000;
  let state = await host.service.viewSession(session.id);
  while (state.busy) {
    assert.ok(Date.now() < deadline, 'Real Provider timeout');
    await new Promise((r) => setTimeout(r, 100));
    state = await host.service.viewSession(session.id);
  }
  assert.equal(state.error, undefined);
  assert.ok(!state.messages.some((m) => m.role === 'assistant' && m.stopReason === 'error'));
  assert.equal(await readFile(join(root, 'security-result.txt'), 'utf8'), 'D5 security checked');
  const tools = state.messages.filter((m) => m.role === 'toolResult').map((m) => m.toolName);
  assert.ok(tools.includes('write') && tools.includes('read'));
  assert.ok(
    providerCalls > 0 && protectedContext && authenticatedProvider,
    'Actual authenticated Provider must receive only the protected context',
  );
  const saved = await host.service.store.read<{ session: Snapshot }>(`sessions/${session.id}.enc`);
  assert.ok(
    saved && JSON.stringify(saved).includes(sentinel),
    'Authoritative encrypted Session retains exact original input',
  );
  const traces = await host.service.diagnosticSearch({ actor: 'user' }, { sessionId: session.id });
  const diagnostic = traces.items[0];
  assert.ok(diagnostic);
  const history = saved.session.entries.find((e) => e.type === 'message' && e.message.role === 'user');
  assert.ok(history);
  const evidence = await host.service.diagnosticEvidence(
    { actor: 'agent', project: state.cwd },
    { sessionId: session.id, entryId: history.id },
  );
  const projected = [
    JSON.stringify(state),
    JSON.stringify(await host.service.export(session.id)),
    JSON.stringify(traces),
    JSON.stringify(host.service.diagnosticHistory.get({ actor: 'user' }, diagnostic.id)),
    JSON.stringify(evidence),
    events.join('\n'),
  ];
  const allSecrets = [
    ...originalSecrets,
    ...strings(await host.service.store.read('credentials.enc')),
    token,
    key.toString('base64'),
  ];
  assert.ok(projected.every((p) => allSecrets.every((secret) => !p.includes(secret))));
  const denied = await fetch(`${host.origin}/api/sessions?token=${encodeURIComponent(token)}`);
  assert.equal(denied.status, 401, 'Query strings cannot authorize');
  const crossOrigin = await fetch(`${host.origin}/api/sessions`, {
    headers: { Authorization: `Bearer ${token}`, Origin: 'https://untrusted.example' },
  });
  assert.equal(crossOrigin.status, 403);
  ws.close();
  await host.close();
  host = undefined;
  async function scan(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) await scan(next);
      else {
        const bytes = await readFile(next);
        assert.ok(
          allSecrets.every((secret) => !bytes.includes(Buffer.from(secret))),
          'No credential material may appear in product files',
        );
      }
    }
  }
  await scan(join(root, 'data'));
  host = await startHost({ dataDir: join(root, 'data'), key, token });
  const restored = await host.service.viewSession(session.id);
  assert.ok(
    JSON.stringify(restored.messages) === JSON.stringify(state.messages),
    'Serialized Session messages must match after restart',
  );
  receipt.providerCalls = providerCalls;
  receipt.authenticatedProvider = authenticatedProvider;
  receipt.protectedProviderContext = protectedContext;
  receipt.nativeTools = tools;
  receipt.protectedOutputs = [
    'HTTP Session',
    'WebSocket events',
    'export',
    'diagnostic index',
    'diagnostic detail',
    'historical evidence',
    'product disk files',
  ];
  receipt.encryptedExactHistory = true;
  receipt.restartConsistency = true;
  receipt.authentication = {
    queryTokenRejected: denied.status,
    crossOriginRejected: crossOrigin.status,
    websocketFirstFrame: true,
  };
  receipt.passed = true;
} finally {
  await host?.close();
  await rm(root, { recursive: true, force: true });
  const output = resolve('docs/evidence/d5-security-real.json');
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
}
console.log(JSON.stringify(receipt, null, 2));
