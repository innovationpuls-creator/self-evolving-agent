import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import diagnosticsExtension from '../packages/pi-diagnostics/src/index.js';
import { marker, NativeDiagnostics, traces } from '../packages/pi-diagnostics/src/reader.js';

test('native diagnostic queries share projection, protect before pagination and stay inside the project directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-diag-test-'));
  try {
    const project = join(root, 'project'),
      foreign = join(root, 'foreign'),
      dir = join(root, 'sessions');
    await mkdir(project);
    await mkdir(foreign);
    await mkdir(dir);
    const source = SessionManager.create(project, dir);
    source.appendMessage(fauxAssistantMessage('seed'));
    const traceId = randomUUID();
    source.appendCustomEntry(marker, {
      kind: 'start',
      traceId,
      sessionId: source.getSessionId(),
      at: 1,
      leafId: source.getLeafId(),
    });
    const secret = 'native-custom-exact-secret-123456789';
    const entry = source.appendMessage({
      role: 'toolResult',
      toolCallId: 'read-a',
      toolName: 'read',
      isError: false,
      content: [{ type: 'text', text: `receipt=abc api_key=${secret}` }],
      timestamp: Date.now(),
    });
    source.appendCustomEntry(marker, {
      kind: 'tool',
      traceId,
      sessionId: source.getSessionId(),
      at: 2,
      toolName: 'read',
      toolCallId: 'read-a',
      durationMs: 10,
      isError: false,
    });
    source.appendCustomEntry(marker, {
      kind: 'end',
      traceId,
      sessionId: source.getSessionId(),
      at: 3,
      outcome: 'completed',
      leafId: source.getLeafId(),
    });
    const other = SessionManager.create(foreign, dir);
    other.appendMessage(fauxAssistantMessage('private foreign transcript'));
    other.appendCustomEntry(marker, { kind: 'start', traceId: randomUUID(), sessionId: other.getSessionId(), at: 4 });
    const outside = SessionManager.create(project, join(root, 'outside'));
    outside.appendMessage(fauxAssistantMessage('outside symlink transcript'));
    const outsideFile = outside.getSessionFile();
    assert.ok(outsideFile);
    await symlink(outsideFile, join(dir, 'symlink.jsonl'));
    const current = SessionManager.create(project, dir);
    const reader = new NativeDiagnostics();
    reader.sensitive.add(secret);
    const found = await reader.search(current, project, {});
    assert.equal(found.total, 1);
    assert.equal(found.items[0]?.status, 'ended');
    const detail = await reader.get(current, project, traceId, {});
    assert.equal(detail.items[0]?.resultEntryId, entry);
    const evidence = await reader.evidence(current, project, { sessionId: source.getSessionId(), entryId: entry });
    assert.ok(evidence.content.includes('receipt=abc'));
    assert.ok(!evidence.content.includes(secret));
    let joined = '';
    for (let offset = 0; offset < evidence.total; offset += 7)
      joined += (
        await reader.evidence(current, project, { sessionId: source.getSessionId(), entryId: entry, offset, limit: 7 })
      ).content;
    assert.equal(joined, evidence.content);
    await assert.rejects(
      reader.evidence(current, project, { sessionId: other.getSessionId(), entryId: other.getLeafId() ?? 'missing' }),
    );
    await assert.rejects(
      reader.evidence(current, project, {
        sessionId: outside.getSessionId(),
        entryId: outside.getLeafId() ?? 'missing',
      }),
    );
    assert.equal(traces(other)[0]?.status, 'interrupted');
    assert.equal(traces(other, traces(other)[0]?.id)[0]?.status, 'running');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reading a legacy native Session migrates only an in-memory copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-diag-legacy-'));
  try {
    const dir = join(root, 'sessions');
    await mkdir(dir);
    const source = SessionManager.create(root, dir);
    source.appendMessage(fauxAssistantMessage('legacy evidence'));
    const file = source.getSessionFile();
    assert.ok(file);
    const original = await readFile(file, 'utf8');
    const rows = original
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    rows[0].version = 2;
    const old = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    await writeFile(file, old);
    const current = SessionManager.create(root, dir);
    const reader = new NativeDiagnostics();
    const evidence = await reader.evidence(current, root, {
      sessionId: source.getSessionId(),
      entryId: source.getLeafId() ?? 'missing',
    });
    assert.ok(evidence.content.includes('legacy evidence'));
    assert.equal(await readFile(file, 'utf8'), old, 'diagnostic reads cannot rewrite source format');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('native Extension observes repeated nested failures, precise result references and idle manual compaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-diag-runtime-'));
  const settings = SettingsManager.inMemory(
    {
      defaultTools: ['outer'],
      compaction: { enabled: false, keepRecentTokens: 10, reserveTokens: 256 },
      retry: { enabled: false },
    },
    { projectTrusted: false },
  );
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const fake = fauxProvider({
    models: [{ id: 'native-diag', contextWindow: 262144, maxTokens: 512 }],
    tokensPerSecond: 100000,
  });
  runtime.registerNativeProvider(fake.provider);
  const manager = SessionManager.inMemory(root);
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: 'Native isolated Extension test.',
    extensionFactories: [
      diagnosticsExtension,
      (pi) => {
        pi.registerTool({
          name: 'leaf',
          label: 'leaf',
          description: 'Return a fixture failure.',
          parameters: Type.Object({}),
          execute: async () => ({
            content: [{ type: 'text', text: 'fixture api_key=sk-native-fixture-private-123456' }],
            details: {},
            isError: true,
          }),
        });
        pi.registerTool({
          name: 'outer',
          label: 'outer',
          description: 'Run repeated nested calls.',
          parameters: Type.Object({}),
          async execute(_id, _args, _signal, _update, ctx) {
            await ctx.executeTool('leaf', {});
            await ctx.executeTool('leaf', {});
            return { content: [{ type: 'text', text: 'outer ended' }], details: {} };
          },
        });
      },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    settingsManager: settings,
    modelRuntime: runtime,
    model: fake.getModel(),
    sessionManager: manager,
    resourceLoader: loader,
  });
  try {
    await session.bindExtensions({ onError: (error) => assert.fail(error.error) });
    fake.setResponses([
      fauxAssistantMessage(fauxToolCall('outer', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('ended'),
    ]);
    await session.prompt('Run the outer fixture.');
    const reader = new NativeDiagnostics();
    const catalog = await reader.search(manager, root, {});
    assert.equal(catalog.total, 1);
    const trace = catalog.items[0];
    assert.ok(trace);
    assert.equal(trace.status, 'ended');
    assert.equal(trace.toolCount, 3);
    assert.equal(trace.errorCount, 2);
    const detail = await reader.get(manager, root, trace.id, {});
    const leaves = detail.items.filter((o) => o.kind === 'tool' && o.toolName === 'leaf');
    assert.equal(leaves.length, 2);
    assert.ok(leaves.every((o) => typeof o.parentToolCallId === 'string' && typeof o.durationMs === 'number'));
    assert.deepEqual(
      leaves.map((o) => o.identicalArgumentOccurrence),
      [1, 2],
    );
    const outer = detail.items.find((o) => o.kind === 'tool' && o.toolName === 'outer');
    assert.ok(outer?.resultEntryId);
    assert.ok(!JSON.stringify(detail).includes('sk-native-fixture-private'));
    fake.setResponses([fauxAssistantMessage('Long context received.')]);
    await session.prompt('context '.repeat(6500));
    fake.setResponses([fauxAssistantMessage('A fixture task called outer and two nested leaves failed.')]);
    await session.compact();
    const after = await reader.search(manager, root, {});
    assert.equal(after.sessionEventTotal, 1);
    assert.equal(after.sessionEvents[0]?.reason, 'manual');
    assert.ok(after.sessionEvents[0]?.entryId);
  } finally {
    session.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
