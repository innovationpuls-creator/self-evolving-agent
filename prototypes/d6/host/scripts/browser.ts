import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Page, type BrowserContext } from 'playwright-core';
import { connection, request, root, saveTranscript } from './client';
import type { ReflectionCatalog } from '../../../../apps/web/src/features/reflection/reflection-state';
import type { Session } from '../../../../apps/web/src/features/chat/session-state';
import type { Detail } from '../src/data';
import type { Route } from '../src/navigation';
const scenario = JSON.parse(await readFile(join(root, '.runtime/scenario.json'), 'utf8')) as {
  source: string;
  empty: string;
  sibling: string;
  project: string;
  otherProject: string;
  memory: string;
  failed: string;
  interrupted: string;
};
const out = join(root, 'evidence');
await mkdir(join(out, 'screenshots'), { recursive: true });
await mkdir(join(out, 'videos'), { recursive: true });
await mkdir(join(out, 'traces'), { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  slowMo: 80,
});
const results: Array<Record<string, unknown>> = [],
  errors: string[] = [],
  network: Array<Record<string, unknown>> = [];
let page: Page,
  context: BrowserContext,
  width = 1440;
const catalog = await request<ReflectionCatalog>(`/reflections?view=summary&sessionId=${scenario.source}`);
const job = catalog.jobs[0];
if (!job) throw new Error('Real source Reflection not found');
const detail = await request<Detail>(`/reflections/${job.id}`);
const source = await request<Session>(`/sessions/${scenario.source}`);
const operation = source.messages?.find((message) => message.details?.memory?.revision === 2);
assert.ok(operation?.details?.memory);
const snap = async (name: string) => {
  const path = `screenshots/${name}-${width}.png`;
  await page.screenshot({ path: join(out, path) });
  return path;
};
const test = async (name: string, expected: string, check: () => Promise<unknown>) => {
  try {
    const actual = await check();
    results.push({
      name,
      expected,
      actual: actual ?? 'assertion passed',
      status: 'passed',
      width,
      height: 1000,
      data: 'real Host HTTP/SQLite/native history',
      trace: `traces/journey-${width}.zip`,
    });
  } catch (reason) {
    const error = reason instanceof Error ? reason.message : String(reason);
    results.push({
      name,
      expected,
      actual: error,
      status: 'failed',
      width,
      screenshot: await snap(`failure-${results.length}`),
      trace: `traces/journey-${width}.zip`,
    });
  }
};
const navigate = async (route: Route) => {
  await page.goto(`${connection.origin}/?${new URLSearchParams({ r: JSON.stringify(route) })}`);
  await page.locator('.live-page h1').first().waitFor();
};
const visible = async (text: string) => {
  await page.getByText(text, { exact: true }).first().waitFor();
  return text;
};
const noOverflow = async () => {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    body: document.documentElement.scrollWidth,
    workspace: document.querySelector('.workspace')?.scrollWidth,
    width: document.querySelector('.workspace')?.clientWidth,
  }));
  assert.ok(dimensions.body <= dimensions.viewport);
  assert.ok((dimensions.workspace || 0) <= (dimensions.width || 0) + 1);
  return dimensions;
};
try {
  for (width of [1440, 850, 390]) {
    context = await browser.newContext({
      viewport: { width, height: 1000 },
      deviceScaleFactor: 1,
      locale: 'zh-CN',
      timezoneId: 'America/Los_Angeles',
      reducedMotion: 'reduce',
      recordVideo: width === 1440 ? { dir: join(out, 'videos'), size: { width, height: 1000 } } : undefined,
    });
    await context.addInitScript((token) => sessionStorage.setItem('agent-connection-token', token), connection.token);
    page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', async (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/api/')) return;
      network.push({
        width,
        path:
          url.pathname +
          url.search.replaceAll(scenario.project, '<PROJECT_A>').replaceAll(scenario.otherProject, '<PROJECT_B>'),
        method: response.request().method(),
        status: response.status(),
      });
    });
    await page.goto(connection.origin);
    await page.locator('.live-session-picker button').first().waitFor();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    await test(
      'Session → scoped Reflection → real source memory operation → revision → source → original Session',
      'all destinations retain actual ids and revision 2',
      async () => {
        await page.locator(`.live-session-picker [data-focus="${scenario.source}"]`).click();
        await page.getByRole('button', { name: '反思记录', exact: true }).last().waitFor();
        await page.getByLabel('继续会话', { exact: true }).fill('保留这条尚未发送的草稿');
        await snap('session');
        const beforeCalls = network.length;
        await page.getByRole('button', { name: '反思记录', exact: true }).last().click();
        await page.locator(`[data-job="${job.id}"]`).waitFor();
        assert.equal(await page.getByLabel('筛选来源会话').inputValue(), scenario.source);
        const listCalls = network.slice(beforeCalls).filter((call) => String(call.path).startsWith('/api/reflections'));
        assert.ok(listCalls.some((call) => String(call.path).includes('view=summary')));
        assert.ok(!listCalls.some((call) => /\/reflections\/[a-f0-9-]{36}$/.test(String(call.path))));
        await snap('reflection-list');
        await page.locator(`[data-job="${job.id}"]`).click();
        await page.getByText(detail.record?.summary || '', { exact: true }).waitFor();
        await snap('reflection-detail');
        await page.getByRole('button', { name: /任务来源 1/ }).click();
        await page.getByRole('button', { name: /^memory_revise/ }).click();
        await page.getByRole('button', { name: '查看本次修订', exact: true }).waitFor();
        await snap('source-operation');
        await page.getByRole('button', { name: '查看本次修订', exact: true }).click();
        await page.getByRole('heading', { name: '请求重试上限', exact: true }).waitFor();
        await page.getByText('项目请求的重试上限是 3 次。', { exact: true }).first().waitFor();
        await page.getByRole('heading', { name: '实际变化', exact: true }).waitFor();
        await snap('memory-revision');
        await page.getByRole('button', { name: '记忆来源 1', exact: true }).click();
        await page.locator('.diagnostics-evidence pre').waitFor();
        await snap('memory-source');
        await page.getByRole('button', { name: '在来源会话中定位', exact: true }).click();
        await page.getByRole('heading', { name: '定位的原始条目', exact: true }).waitFor();
        await page.getByLabel('继续会话', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('继续会话').inputValue(), '保留这条尚未发送的草稿');
        return {
          session: scenario.source,
          reflection: job.id,
          memory: scenario.memory,
          revision: 2,
          savedBy: 'source task memory_revise; Reflection.changes remains authoritative and empty',
          requests: listCalls,
        };
      },
    );
    await test('primary page has no horizontal overflow', 'document and workspace fit viewport', noOverflow);
    await test(
      'browser Back restores detail row focus and list scope',
      'same job focused after returning to list',
      async () => {
        await navigate({ page: 'reflections', sessionId: scenario.source, offset: 0 });
        const row = page.locator(`[data-job="${job.id}"]`);
        await row.waitFor();
        await row.focus();
        await row.click();
        await page.getByRole('button', { name: /任务来源 1/ }).waitFor();
        await page.getByRole('button', { name: '反思记录', exact: true }).last().click();
        await row.waitFor();
        await page.waitForFunction((id) => document.activeElement?.getAttribute('data-focus') === id, job.id);
        return {
          focus: await row.evaluate((node) => document.activeElement === node),
          session: await page.getByLabel('筛选来源会话').inputValue(),
        };
      },
    );
    await test(
      'cross Session and project filtering plus empty records',
      'Host returns no records for unused Session',
      async () => {
        await page.getByLabel('筛选来源会话').selectOption(scenario.empty);
        await visible('还没有反思记录');
        await snap('empty');
        const value = new URL(page.url()).searchParams.get('r');
        assert.equal(JSON.parse(value || '{}').sessionId, scenario.empty);
        return { session: scenario.empty, records: 0 };
      },
    );
    await test(
      'same-title tasks stay separately addressable across Sessions',
      'both actual failed/interrupted session ids in picker',
      async () => {
        await page.getByLabel('筛选来源会话').selectOption('');
        await page.locator(`[data-status="failed"]`).first().waitFor();
        const ids = await page
          .getByLabel('筛选来源会话')
          .locator('option')
          .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
        assert.ok(ids.includes(scenario.failed) && ids.includes(scenario.interrupted));
        return { distinctSessions: [scenario.failed, scenario.interrupted] };
      },
    );
    for (const status of ['failed', 'interrupted'] as const)
      await test(
        `real native Reflection ${status}`,
        `persisted ${status} detail and actual reason remain visible`,
        async () => {
          await navigate({ page: 'reflections', offset: 0 });
          await page.getByLabel('筛选来源会话').selectOption(scenario[status]);
          await page.locator(`[data-status="${status}"]`).first().click();
          await page.getByText('检查未完成', { exact: true }).waitFor();
          const text = await page.locator('.aw-review-article').innerText();
          assert.match(text, status === 'failed' ? /反思未完成/ : /反思已中断/);
          await snap(status);
          await noOverflow();
          return { status, text };
        },
      );
    await test(
      'missing evidence is reported by actual Host',
      'entry_missing_from_checkpoint without invented text',
      async () => {
        await navigate({
          page: 'source',
          reference: { sessionId: scenario.source, entryId: 'missing-d6-entry' },
          project: scenario.project,
          originSession: scenario.source,
        });
        await page.getByText(/entry_missing_from_checkpoint/).waitFor();
        assert.equal(await page.locator('.diagnostics-evidence pre').count(), 0);
        await snap('missing-source');
        return 'Host available=false, reason=entry_missing_from_checkpoint';
      },
    );
    await test(
      'wrong project cannot read project Memory',
      'real Host 404, no fallback to global or different project',
      async () => {
        await navigate({
          page: 'result',
          target: { kind: 'memory', id: scenario.memory, revision: 2, project: scenario.otherProject },
          originSession: scenario.source,
        });
        await page.getByRole('alert').first().waitFor();
        assert.equal(await page.getByText('项目请求的重试上限是 3 次。', { exact: true }).count(), 0);
        await snap('project-denied');
        return page.getByRole('alert').first().innerText();
      },
    );
    await test(
      'source Origin rejection and retry use actual Host',
      '403 surfaces actual reason, retry restores source after restoring request Origin',
      async () => {
        await page.route('**/api/diagnostics/evidence?*', async (route) => {
          const response = await route.fetch({
            headers: { ...route.request().headers(), origin: 'http://untrusted.invalid' },
          });
          assert.equal(response.status(), 403);
          await route.fulfill({ response });
        });
        await navigate({
          page: 'source',
          reference: detail.record?.evidence.find((ref) => ref.entryId) || {
            sessionId: scenario.source,
            entryId: 'missing',
          },
          project: scenario.project,
          originSession: scenario.source,
        });
        await page.getByText(/来源不受信任/).waitFor();
        await snap('origin-denied');
        assert.equal(await page.locator('.diagnostics-evidence pre').count(), 0);
        await page.unroute('**/api/diagnostics/evidence?*');
        await page.getByRole('button', { name: '重试证据', exact: true }).click();
        await page.locator('.diagnostics-evidence pre').waitFor();
        return 'real 403 → normal same-origin GET 200';
      },
    );
    await test(
      'revoked/absent Bearer cannot leave readable stale data',
      'actual 401 removes protected view and asks to reconnect',
      async () => {
        await page.route('**/api/diagnostics/evidence?*', async (route) => {
          const headers = route.request().headers();
          delete headers.authorization;
          await route.continue({ headers });
        });
        await navigate({
          page: 'source',
          reference: { sessionId: scenario.source, entryId: 'missing' },
          project: scenario.project,
        });
        await page.getByRole('heading', { name: '连接 Agent Host', exact: true }).waitFor();
        assert.equal(await page.locator('.diagnostics-evidence').count(), 0);
        return 'actual Host 401 → auth_required; evidence unmounted';
      },
    );
    await context.tracing.stop({ path: join(out, `traces/journey-${width}.zip`) });
    const video = page.video();
    await context.close();
    if (video) {
      await video.saveAs(join(out, 'videos/browser-suite-1440.webm'));
      await video.delete();
    }
  }
  width = 1440;
  await test(
    'server explicitly rejects unauthenticated and foreign-Origin requests',
    '401 without token;403 with token but wrong Origin',
    async () => {
      const unauthorized = await fetch(`${connection.origin}/api/sessions`);
      const forbidden = await fetch(`${connection.origin}/api/sessions`, {
        headers: { Authorization: `Bearer ${connection.token}`, Origin: 'http://untrusted.invalid' },
      });
      assert.equal(unauthorized.status, 401);
      assert.equal(forbidden.status, 403);
      return {
        unauthorized: { status: unauthorized.status, body: await unauthorized.json() },
        forbidden: { status: forbidden.status, body: await forbidden.json() },
      };
    },
  );
} finally {
  await browser.close();
  await saveTranscript('browser-fixture-verification');
  const receipt = {
    origin: connection.origin,
    time: new Date().toISOString(),
    summary: {
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      pageErrors: errors.length,
    },
    results,
    errors,
    requests: network,
  };
  await writeFile(join(out, 'browser-results.json'), JSON.stringify(receipt, null, 2).replaceAll(root, '<D6_HOST>'));
  execFileSync('python3', [join(root, 'scripts/redact.py')], { stdio: 'pipe' });
  console.log(JSON.stringify(receipt.summary));
  if (receipt.summary.failed || errors.length) process.exitCode = 1;
}
