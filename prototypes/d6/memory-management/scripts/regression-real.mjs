import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
const root = new URL('../', import.meta.url),
  out = new URL('evidence/', root);
const config = JSON.parse(await fs.readFile(new URL('../../host/.runtime/connection.json', import.meta.url), 'utf8'));
const scenario = JSON.parse(await fs.readFile(new URL('../../host/.runtime/scenario.json', import.meta.url), 'utf8'));
const results = [],
  requests = [],
  frames = [],
  errors = [];
const clean = (value) =>
  JSON.parse(
    JSON.stringify(value)
      .replaceAll(config.token, '<TOKEN>')
      .replaceAll(config.key || '__NO_KEY__', '<KEY>')
      .replaceAll('/Users/torch/Documents/ChatGPT/agent', '<WORKSPACE>'),
  );
const request = async (path, method = 'GET', body) => {
  const r = await fetch(`${config.origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  requests.push(clean({ channel: 'setup', path, method, status: r.status, response: data }));
  assert.ok(r.ok, `${path}: ${r.status}`);
  return data;
};
const routeURL = (route) => `${config.origin}/?${new URLSearchParams({ r: JSON.stringify(route) })}`;
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
await fs.mkdir(new URL('videos/', out), { recursive: true });
async function check(name, width, fn, expected) {
  const t = Date.now();
  try {
    const actual = await fn();
    results.push({
      name,
      width,
      height: 1000,
      status: 'passed',
      expected,
      actual: actual ?? expected,
      durationMs: Date.now() - t,
    });
    console.log('PASS', width, name);
  } catch (e) {
    results.push({
      name,
      width,
      height: 1000,
      status: 'failed',
      expected,
      actual: e.message,
      durationMs: Date.now() - t,
    });
    console.log('FAIL', width, name, e.message);
    process.exitCode = 1;
  }
}
const sourceCatalog = await request(`/reflections?view=summary&sessionId=${scenario.source}`),
  job = sourceCatalog.jobs.find((j) => sourceCatalog.records.some((r) => r.jobId === j.id));
assert.ok(job);
const recording = process.argv.includes('--record');
for (const width of recording ? [1440] : [1440, 850, 390]) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'America/Los_Angeles',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    recordVideo: width === 1440 ? { dir: new URL('videos/', out).pathname, size: { width, height: 1000 } } : undefined,
  });
  await context.addInitScript((token) => sessionStorage.setItem('agent-connection-token', token), config.token);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push({ width, message: e.message }));
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      try {
        const e = JSON.parse(String(payload));
        frames.push(
          clean({
            width,
            type: e.type,
            sessionId: e.sessionId,
            stateVersion: e.stateVersion,
            eventType: e.event?.type,
            bytes: String(payload).length,
          }),
        );
      } catch {}
    }),
  );
  page.on('response', async (res) => {
    if (!res.url().includes('/api/')) return;
    try {
      let data = await res.json();
      if (res.url().endsWith('/models'))
        data = {
          models: data.models?.map((m) => ({ id: m.id, provider: m.provider })),
          providers: data.providers?.map((p) => ({ id: p.id })),
        };
      const serialized = JSON.stringify(data);
      requests.push(
        clean({
          channel: 'browser',
          width,
          path: new URL(res.url()).pathname + new URL(res.url()).search,
          method: res.request().method(),
          status: res.status(),
          response:
            serialized.length > 100000 ? { length: serialized.length, excerpt: serialized.slice(0, 100000) } : data,
        }),
      );
    } catch {}
  });
  const shot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: new URL(`after/${name}-${width}.png`, out).pathname });
  };
  try {
    await page.goto(routeURL({ page: 'session', sessionId: scenario.source }));
    await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
    const pause = async () => {
      if (width === 1440) await page.waitForTimeout(2500);
    };
    await check(
      'existing A shell, reader and floating composer with actual Session',
      width,
      async () => {
        assert.equal(await page.locator('.app.quiet.host-product').count(), 1);
        assert.equal(await page.locator('.session-dock .session-composer').count(), 1);
        assert.ok(await page.locator('.session-message').count());
        await shot('session');
        return { messages: await page.locator('.session-message').count(), mockProvider: false };
      },
      'real native messages inside original A shell',
    );
    const draft = `返回后继续核对重试策略 · ${width}`;
    await page.getByLabel('发送给 Agent', { exact: true }).fill(draft);
    await page.locator('.session-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.focus();
    });
    await page.waitForTimeout(120);
    const originalTop = await page.locator('.session-scroll').evaluate((el) => el.scrollTop);
    const beforeDetails = requests.filter(
      (r) => r.channel === 'browser' && r.width === width && /^\/api\/reflections\/[^/?]+/.test(r.path),
    ).length;
    await page
      .getByRole('navigation', { name: '关联工作空间' })
      .getByRole('button', { name: /反思记录/ })
      .click();
    await page.locator(`[data-job="${job.id}"]`).waitFor();
    await check(
      'Session-scoped summary list without per-row detail prefetch',
      width,
      async () => {
        const after = requests.filter(
          (r) => r.channel === 'browser' && r.width === width && /^\/api\/reflections\/[^/?]+/.test(r.path),
        ).length;
        assert.equal(after, beforeDetails);
        assert.equal(await page.getByLabel('筛选来源会话').inputValue(), scenario.source);
        assert.ok(sourceCatalog.jobs.length > 1);
        await shot('reflections');
        return {
          jobs: sourceCatalog.jobs.length,
          detailPrefetch: after - beforeDetails,
          summaryLengths: sourceCatalog.records.map((r) => r.summary.length),
        };
      },
      'same Session; summary endpoint only; multiple actual checks',
    );
    await pause();
    await page.locator(`[data-job="${job.id}"]`).click();
    await page.getByRole('button', { name: /任务来源 1/ }).waitFor();
    await check(
      'Reflection changes remain distinct from source task Memory operation',
      width,
      async () => {
        const detail = await request(`/reflections/${job.id}`);
        assert.equal(detail.record.changes.length, 0);
        assert.equal(await page.getByRole('button', { name: '查看本次修订', exact: true }).count(), 0);
        await page.getByLabel('展开完整任务标题').click();
        const h = page.locator('.host-task-title h1');
        assert.equal(await h.innerText(), (await request(`/sessions/${scenario.source}`)).title);
        await shot('reflection-detail');
        return { reflectionChanges: 0, fullTitleAvailable: true };
      },
      'no invented change count; full original title can expand',
    );
    await pause();
    await page.getByRole('button', { name: /任务来源 1/ }).click();
    await page.getByRole('button', { name: /^memory_revise/ }).click();
    await page.getByRole('button', { name: '查看本次修订', exact: true }).waitFor();
    await check(
      'native Tool feedback leads to exact persisted Memory revision',
      width,
      async () => {
        assert.match(await page.locator('.host-reading > .host-tool').innerText(), /memory_revise/);
        assert.equal(await page.locator('.host-raw-evidence[open]').count(), 0);
        await shot('source-operation');
      },
      'semantic native result visible; raw protocol collapsed',
    );
    await pause();
    await page.getByRole('button', { name: '查看本次修订', exact: true }).click();
    await page.getByRole('heading', { name: '实际变化', exact: true }).waitFor();
    await check(
      'historical body diff and basis',
      width,
      async () => {
        const txt = await page.locator('.aw-note').innerText();
        assert.match(txt, /7 次/);
        assert.match(txt, /3 次/);
        assert.match(txt, /修订 1 → 2/);
        await shot('memory');
        await page.getByLabel('查看修订', { exact: true }).selectOption('1');
        await page.getByText('当前已是修订 2', { exact: false }).waitFor();
        assert.match(await page.locator('.aw-note').innerText(), /7 次/);
        await page.getByLabel('查看修订', { exact: true }).selectOption('2');
        await page.getByRole('heading', { name: '实际变化', exact: true }).waitFor();
      },
      'revision 1=7, revision 2=3; selecting history never replaces with current',
    );
    await pause();
    await page.getByRole('button', { name: '记忆来源 1', exact: true }).click();
    await page.locator('.host-source-person').waitFor();
    await page.getByText('完整原始证据', { exact: true }).click();
    await page.locator('.diagnostics-evidence pre').waitFor();
    await shot('basis');
    await pause();
    await page.getByRole('button', { name: '在来源会话中定位', exact: true }).click();
    await page.locator('.host-located-message').waitFor();
    await check(
      'basis locates exact native entry and draft survives route changes',
      width,
      async () => {
        assert.equal(await page.getByLabel('发送给 Agent', { exact: true }).inputValue(), draft);
        assert.equal(await page.locator('.host-located-message').count(), 1);
        await shot('located-session');
      },
      'exact source Entry highlighted; unsent draft unchanged',
    );
    await pause();
    await page.goBack();
    await page.getByRole('button', { name: '返回原会话', exact: true }).click();
    await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
    await check(
      'return to original Session restores reading position and draft',
      width,
      async () => {
        await page.waitForTimeout(150);
        assert.equal(await page.getByLabel('发送给 Agent', { exact: true }).inputValue(), draft);
        const top = await page.locator('.session-scroll').evaluate((el) => el.scrollTop);
        assert.ok(Math.abs(top - originalTop) < 4, `scroll ${top} vs ${originalTop}`);
        assert.ok(
          await page.locator('.session-scroll').evaluate((el) => document.activeElement === el),
          'reader focus restored',
        );
        return { before: originalTop, after: top, draftRetained: true };
      },
      'original conversation anchor retained independently of source-entry anchor',
    );
    await check(
      'no horizontal overflow; composer remains inside viewport',
      width,
      async () => {
        const geom = await page.evaluate(() => ({
          width: innerWidth,
          doc: document.documentElement.scrollWidth,
          composer: document.querySelector('.session-composer').getBoundingClientRect().toJSON(),
        }));
        assert.ok(geom.doc <= width + 1);
        assert.ok(geom.composer.right <= width + 1 && geom.composer.left >= 0 && geom.composer.bottom <= 1000);
        return geom;
      },
      'all primary controls fit current width',
    );
    // Session changes are actual UI clicks, including mobile navigation.
    if (await page.getByRole('button', { name: '打开导航', exact: true }).isVisible())
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await check(
      'switch actual Sessions and restore each unsent draft',
      width,
      async () => {
        const target = page.locator('.session-list button').filter({ has: page.locator(`strong[title]`) });
        const titles = await target.locator('strong').allTextContents();
        const sibling = (await request(`/sessions/${scenario.sibling}`)).title;
        await target.filter({ hasText: sibling }).first().click();
        await page.waitForFunction(
          (id) => JSON.parse(new URLSearchParams(location.search).get('r')).sessionId === id,
          scenario.sibling,
        );
        await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
        await page.getByLabel('发送给 Agent', { exact: true }).fill('另一会话的独立草稿');
        if (await page.getByRole('button', { name: '打开导航', exact: true }).isVisible())
          await page.getByRole('button', { name: '打开导航', exact: true }).click();
        const source = (await request(`/sessions/${scenario.source}`)).title;
        await page.locator('.session-list button').filter({ hasText: source }).click();
        await page.waitForFunction(
          (id) => JSON.parse(new URLSearchParams(location.search).get('r')).sessionId === id,
          scenario.source,
        );
        await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('发送给 Agent', { exact: true }).inputValue(), draft);
        return { availableSessions: titles.length, independentDrafts: true };
      },
      'switch via existing navigation; project and unsent text remain separate',
    );
  } catch (e) {
    results.push({ name: 'journey continuation', width, status: 'failed', actual: e.message });
    process.exitCode = 1;
  } finally {
    await context.tracing.stop({ path: new URL(`${recording ? 'recording' : 'trace'}-${width}.zip`, out).pathname });
    const video = page.video();
    await context.close();
    if (video) {
      await video.saveAs(new URL('videos/prior-chain-1440.webm', out).pathname);
      await video.delete();
    }
  }
}
await fs.writeFile(
  new URL(recording ? 'journey-recording.json' : 'prior-chain-results.json', out),
  JSON.stringify(clean({ results, errors, syntheticResponses: false }), null, 2),
);
await fs.writeFile(
  new URL(recording ? 'recording-requests.json' : 'prior-chain-requests.json', out),
  JSON.stringify(clean(requests), null, 2),
);
await fs.writeFile(
  new URL(recording ? 'recording-events.json' : 'prior-chain-events.json', out),
  JSON.stringify(clean(frames), null, 2),
);
await browser.close();
