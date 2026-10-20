import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { WebSocket } from 'ws';
import { startHost } from '../apps/host/transport/server.js';

const root = await mkdtemp(join(tmpdir(), 'agent-real-'));
const token = randomBytes(32).toString('hex'),
  key = randomBytes(32);
const receipt: Record<string, unknown> = { time: new Date().toISOString(), reflectionIsolationAcceptance: 'blocked' };
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let host: Awaited<ReturnType<typeof startHost>> | undefined;
try {
  host = await startHost({
    dataDir: join(root, 'data'),
    key,
    token,
    webDir: resolve('dist/web'),
    reflectionAppBundle: resolve('release/Agent-darwin-arm64/Agent.app'),
  });
  const request = async (path: string, method = 'GET', data?: unknown) => {
    const response = await fetch(`${host?.origin}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    assert.ok(response.ok, `HTTP ${response.status} at ${path}`);
    return response.json();
  };
  await request('/credentials', 'POST', { provider: 'openai-codex', importExisting: true });
  const catalog = await request('/models');
  const model =
    catalog.models.find((m: { id: string }) => m.id === (process.env.AGENT_SMOKE_MODEL ?? 'gpt-6-luna')) ??
    catalog.models[0];
  assert.ok(model, '需要可用的真实模型');
  const session = await request('/sessions', 'POST', { cwd: root, provider: model.provider, model: model.id });
  browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(20000);
  await page.goto(`${host.origin}/#token=${token}`);
  await page.waitForFunction(() => document.querySelector('.connection')?.textContent?.includes('已连接'));
  await page.locator('nav button').filter({ hasText: root }).click();
  await page.getByLabel('任务', { exact: true }).waitFor();
  const events: string[] = [];
  const ws = new WebSocket(`${host.origin.replace('http', 'ws')}/events`, {
    origin: host.origin,
    headers: { Authorization: `Bearer ${token}` },
  });
  await new Promise<void>((ok, fail) => {
    ws.once('open', ok);
    ws.once('error', fail);
  });
  ws.on('message', (value) => {
    const data = JSON.parse(value.toString());
    if (data.event?.type) events.push(data.event.type);
  });
  await page
    .getByLabel('任务', { exact: true })
    .fill(
      'Use your native write tool to create acceptance.txt in the current working directory with exactly this content: D1 real model native tool success\nThen use the native read tool to read it and report its content. Do not use bash. No other changes.',
    );
  await page.getByRole('button', { name: '发送 ↑', exact: true }).click();
  const deadline = Date.now() + 180000;
  let state: Awaited<ReturnType<NonNullable<typeof host>['service']['viewSession']>>;
  do {
    await new Promise((ok) => setTimeout(ok, 500));
    state = await request(`/sessions/${session.id}`);
  } while (state.busy && Date.now() < deadline);
  assert.equal(state.busy, false, '真实模型运行超时');
  const failures = state.messages.filter(
    (m: { role: string; stopReason?: string }) => m.role === 'assistant' && m.stopReason === 'error',
  );
  assert.equal(failures.length, 0, '真实模型返回错误（详情留在受保护的会话中）');
  assert.match(await readFile(join(root, 'acceptance.txt'), 'utf8'), /^D1 real model native tool success\n?$/);
  assert.ok(events.includes('message_update'), '必须有流式事件');
  assert.ok(events.includes('tool_execution_end'), '必须使用 Pi 原生工具');
  const toolNames = state.messages.filter((m) => m.role === 'toolResult').map((m) => m.toolName);
  assert.ok(toolNames.includes('write') && toolNames.includes('read'));
  const search = await request(`/diagnostics?sessionId=${session.id}`);
  assert.ok(search.items[0]);
  const diagnostic = await request(`/diagnostics/${search.items[0].id}`);
  const call = diagnostic.calls.find((c: { toolName: string }) => c.toolName === 'read');
  assert.ok(call?.resultEntryId);
  const evidence = await request(`/diagnostics/evidence?sessionId=${session.id}&entryId=${call.resultEntryId}`);
  assert.equal(evidence.available, true);
  assert.match(evidence.content, /D1 real model native tool success/);
  await request('/reflections/expedite', 'POST', { sessionId: session.id });
  await request('/reflections/recheck', 'POST', {});
  const reflection = await request(`/reflections?sessionId=${session.id}`);
  assert.equal(reflection.availability.available, false);
  assert.equal(reflection.jobs[0]?.status, 'waiting_user');
  assert.ok(reflection.jobs[0].sources.length);
  receipt.reflection = { availability: reflection.availability, job: reflection.jobs[0] };
  receipt.diagnostic = {
    traceId: search.items[0].id,
    toolCallId: call.toolCallId,
    resultEntryId: call.resultEntryId,
    source: evidence.source,
  };
  await mkdir('release/web-product-real', { recursive: true });
  await page.screenshot({ path: 'release/web-product-real/conversation.png' });
  ws.close();
  await host.close();
  host = undefined;
  const files = await readdir(join(root, 'data', 'sessions'));
  assert.equal(files.filter((name) => name.endsWith('.enc')).length, 1);
  const bytes = await readFile(join(root, 'data', 'sessions', files[0] ?? 'missing'), 'utf8');
  assert.ok(!bytes.includes('D1 real model native tool success'));
  host = await startHost({
    dataDir: join(root, 'data'),
    key,
    token,
    webDir: resolve('dist/web'),
    reflectionAppBundle: resolve('release/Agent-darwin-arm64/Agent.app'),
  });
  const restored = await request(`/sessions/${session.id}`);
  assert.equal(restored.messages.length, state.messages.length);
  const recoveredReflection = await request(`/reflections?sessionId=${session.id}`);
  assert.equal(recoveredReflection.jobs[0]?.status, 'waiting_user');
  receipt.result = 'passed';
  receipt.realModel = { provider: model.provider, id: model.id };
  receipt.nativeTools = toolNames;
  receipt.streamEvents = events.length;
  receipt.encryptedRecovery = true;
  console.log(
    JSON.stringify({
      realModel: { provider: model.provider, id: model.id },
      nativeTools: toolNames,
      streamEvents: events.length,
      encryptedRecovery: true,
      result: 'passed',
    }),
  );
} finally {
  await mkdir('docs/evidence', { recursive: true });
  await writeFile('docs/evidence/web-product-real.json', JSON.stringify(receipt, null, 2) + '\n');
  await Promise.race([browser?.close(), new Promise<void>((ok) => setTimeout(ok, 5000).unref())]);
  await host?.close();
  await rm(root, { recursive: true, force: true });
}
