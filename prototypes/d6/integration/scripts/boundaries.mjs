import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
const out = new URL('../evidence/', import.meta.url),
  config = JSON.parse(await fs.readFile(new URL('../../host/.runtime/connection.json', import.meta.url), 'utf8')),
  s = JSON.parse(await fs.readFile(new URL('../../host/.runtime/scenario.json', import.meta.url), 'utf8'));
const results = [],
  requests = [];
const clean = (v) =>
  JSON.parse(
    JSON.stringify(v)
      .replaceAll(config.token, '<TOKEN>')
      .replaceAll('/Users/torch/Documents/ChatGPT/agent', '<WORKSPACE>'),
  );
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'zh-CN',
  timezoneId: 'America/Los_Angeles',
  reducedMotion: 'reduce',
});
await context.addInitScript((t) => sessionStorage.setItem('agent-connection-token', t), config.token);
let wire,
  networkDown = false,
  connections = 0;
await context.routeWebSocket('**/events', (ws) => {
  connections++;
  wire = ws;
  if (networkDown) {
    void ws.close({ code: 1001, reason: 'test transport interruption' });
    return;
  }
  ws.connectToServer();
});
await context.tracing.start({ snapshots: true, screenshots: true, sources: false });
const page = await context.newPage();
page.on('response', async (r) => {
  if (!r.url().includes('/api/')) return;
  try {
    requests.push(
      clean({
        path: new URL(r.url()).pathname + new URL(r.url()).search,
        method: r.request().method(),
        status: r.status(),
        response: await r.json(),
      }),
    );
  } catch {}
});
async function test(name, expected, fn) {
  try {
    const actual = await fn();
    results.push({ name, expected, actual: actual ?? expected, status: 'passed', width: 1440 });
    console.log('PASS', name);
  } catch (e) {
    results.push({ name, expected, status: 'failed', actual: e.message, width: 1440 });
    console.log('FAIL', name, e.message);
    process.exitCode = 1;
    await page.screenshot({ path: new URL(`after/boundary-failure-${results.length}.png`, out).pathname });
  }
}
async function navigate(r) {
  await page.goto(`${config.origin}/?${new URLSearchParams({ r: JSON.stringify(r) })}`);
}
async function shot(n) {
  await page.screenshot({ path: new URL(`after/${n}-1440.png`, out).pathname });
}
try {
  await test(
    'no records and distinct cross-project Sessions',
    'actual empty Session; source filter preserves separate IDs',
    async () => {
      await navigate({ page: 'reflections', sessionId: s.empty, offset: 0 });
      await page.getByRole('heading', { name: '还没有反思记录', exact: true }).waitFor();
      await page.getByLabel('筛选来源会话').locator(`option[value="${s.empty}"]`).waitFor({ state: 'attached' });
      assert.equal(await page.getByLabel('筛选来源会话').inputValue(), s.empty);
      const ids = await page
        .getByLabel('筛选来源会话')
        .locator('option')
        .evaluateAll((nodes) => nodes.map((n) => n.value));
      assert.ok(ids.includes(s.failed) && ids.includes(s.interrupted) && ids.includes(s.sibling));
      await shot('empty');
      return { records: 0, distinctSessionIds: true };
    },
  );
  for (const state of ['failed', 'interrupted'])
    await test(
      `persisted real Reflection ${state}`,
      'actual failure reason remains readable; no invented successful change',
      async () => {
        await navigate({ page: 'reflections', sessionId: s[state], offset: 0 });
        await page.locator(`[data-status="${state}"]`).first().click();
        await page.getByText('检查未完成', { exact: true }).waitFor();
        const text = await page.locator('.aw-review-article').innerText();
        assert.match(text, state === 'failed' ? /反思未完成/ : /反思已中断/);
        await shot(state);
        return text;
      },
    );
  await test('missing source', 'Host available=false and actual entry_missing_from_checkpoint', async () => {
    await navigate({
      page: 'source',
      reference: { sessionId: s.source, entryId: 'missing-integration-entry' },
      project: s.project,
      originSession: s.source,
    });
    await page.getByText(/entry_missing_from_checkpoint/).waitFor();
    assert.equal(await page.locator('.host-reading .memory-tool-feedback').count(), 0);
    await shot('missing-source');
    return 'available=false; no invented Tool feedback';
  });
  await test('wrong project cannot reveal Memory', 'actual Host 404, no project/global fallback', async () => {
    await navigate({
      page: 'result',
      target: { kind: 'memory', id: s.memory, project: s.otherProject, revision: 2 },
      originSession: s.source,
    });
    await page.getByRole('alert').first().waitFor();
    assert.equal(await page.getByRole('heading', { name: '请求重试上限', exact: true }).count(), 0);
    assert.ok(requests.some((r) => r.path.includes(s.memory) && r.status === 404));
    await shot('project-denied');
    return await page.getByRole('alert').first().innerText();
  });
  const nativeResponse = await fetch(`${config.origin}/api/sessions/${s.source}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  assert.equal(nativeResponse.status, 200);
  const native = await nativeResponse.json(),
    entries = [];
  function collect(nodes) {
    for (const n of nodes || []) {
      if (
        n.entry.message?.role === 'toolResult' &&
        n.entry.message.toolName === 'memory_revise' &&
        !n.entry.message.isError
      )
        entries.push(n.entry);
      collect(n.children);
    }
  }
  collect(native.tree);
  assert.ok(entries.length);
  const ref = { sessionId: s.source, entryId: entries.at(-1).id };
  await test(
    '403 Origin denial then retry',
    'actual Host response forwarded unchanged, 403 → normal same-origin 200',
    async () => {
      await page.route('**/api/diagnostics/evidence?*', async (route) => {
        const response = await route.fetch({
          headers: { ...route.request().headers(), origin: 'http://untrusted.invalid' },
        });
        assert.equal(response.status(), 403);
        await route.fulfill({ response });
      });
      await navigate({ page: 'source', reference: ref, project: s.project, originSession: s.source });
      await page.getByText(/来源不受信任/).waitFor();
      assert.equal(await page.getByRole('button', { name: '查看本次修订', exact: true }).count(), 0);
      await shot('origin-denied');
      await page.unroute('**/api/diagnostics/evidence?*');
      await page.getByRole('button', { name: '重试证据', exact: true }).click();
      await page.getByRole('button', { name: '查看本次修订', exact: true }).waitFor();
      return { denied: 403, retry: 200, syntheticResponse: false };
    },
  );
  await test(
    'actual transport interruption and authoritative reconnect',
    'draft retained; send disabled offline; new authenticated socket and refreshed Session',
    async () => {
      await navigate({ page: 'session', sessionId: s.source });
      await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
      await page.getByLabel('发送给 Agent', { exact: true }).fill('断线期间继续保留的草稿');
      const before = connections,
        reads = requests.filter((r) => r.path === `/api/sessions/${s.source}`).length;
      networkDown = true;
      await context.setOffline(true);
      await wire.close({ code: 1001, reason: 'controlled connection drop' });
      await page.getByText('连接中断，草稿已保留。', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '发送任务', exact: true }).isDisabled(), true);
      await shot('offline');
      networkDown = false;
      await context.setOffline(false);
      await page.waitForFunction(() => !document.querySelector('.session-send')?.disabled);
      assert.equal(await page.getByLabel('发送给 Agent', { exact: true }).inputValue(), '断线期间继续保留的草稿');
      assert.ok(connections > before);
      assert.ok(requests.filter((r) => r.path === `/api/sessions/${s.source}`).length > reads);
      await shot('reconnected');
      return { newConnections: connections - before, refreshedNativeSnapshot: true, draftRetained: true };
    },
  );
  await test('401 removes readable protected views', 'actual Host 401 → auth_required; content unmounted', async () => {
    await page.route('**/api/diagnostics/evidence?*', async (route) => {
      const headers = { ...route.request().headers() };
      delete headers.authorization;
      await route.continue({ headers });
    });
    await navigate({ page: 'source', reference: ref, project: s.project });
    await page.getByRole('heading', { name: '连接 Agent Host', exact: true }).waitFor();
    assert.equal(await page.locator('.session-room,.host-reading').count(), 0);
    assert.ok(requests.some((r) => r.path.includes('/diagnostics/evidence') && r.status === 401));
    await shot('auth-required');
    return 'protected views absent after real 401';
  });
  await test(
    'failed reauthentication cannot expose retained content during pending request',
    'auth screen remains until authenticated snapshot is ready',
    async () => {
      await page.unroute('**/api/diagnostics/evidence?*');
      let release, started;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const seen = new Promise((resolve) => {
        started = resolve;
      });
      await page.route('**/api/connect', async (route) => {
        const response = await route.fetch();
        assert.equal(response.status(), 401);
        started();
        await held;
        await route.fulfill({ response });
      });
      await page.getByLabel('连接令牌', { exact: true }).fill('intentionally-invalid-integration-token');
      await page.getByRole('button', { name: '连接', exact: true }).click();
      await seen;
      assert.equal(await page.locator('.session-room,.host-reading').count(), 0);
      release();
      await page.getByRole('button', { name: '连接', exact: true }).waitFor();
      await page.unroute('**/api/connect');
      await page.getByLabel('连接令牌', { exact: true }).fill(config.token);
      await page.getByRole('button', { name: '连接', exact: true }).click();
      await page.getByRole('button', { name: '查看本次修订', exact: true }).waitFor();
      return { pendingProtectedViews: 0, invalidTokenStatus: 401, reconnected: true };
    },
  );
  await test(
    '403 during Host synchronization locks product views',
    'actual foreign-Origin /sessions response yields forbidden screen',
    async () => {
      await page.route('**/api/sessions', async (route) => {
        const response = await route.fetch({
          headers: { ...route.request().headers(), origin: 'http://untrusted.invalid' },
        });
        assert.equal(response.status(), 403);
        await route.fulfill({ response });
      });
      await navigate({ page: 'session', sessionId: s.source });
      await page.getByRole('heading', { name: '连接 Agent Host', exact: true }).waitFor();
      assert.equal(await page.locator('.session-room,.host-reading').count(), 0);
      return { status: 403, protectedViews: 0 };
    },
  );
} finally {
  await context.tracing.stop({ path: new URL('boundaries-trace.zip', out).pathname });
  await context.close();
  await browser.close();
  await fs.writeFile(new URL('boundary-results.json', out), JSON.stringify(clean(results), null, 2));
  await fs.writeFile(new URL('boundary-requests.json', out), JSON.stringify(clean(requests), null, 2));
}
