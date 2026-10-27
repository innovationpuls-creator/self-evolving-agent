import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
process.env.D6_CONTROLLED = '1';
const { api, launch, context, record, check, save, url, config, shot } = await import('./common.mjs');
const s = JSON.parse(await fs.readFile(new URL('../.runtime/controlled.json', import.meta.url), 'utf8'));
const b = await launch(),
  ctx = await context(b, 1440),
  p = await ctx.newPage();
record(p, 1440);
p.setDefaultTimeout(12000);
await check('Reflection 详情真实 Origin403、重试；401锁定与重新认证', 1440, async () => {
  const detail = `**/api/reflections/${s.effect}`;
  await p.route(detail, async (r) => {
    const headers = { ...r.request().headers(), origin: 'https://not-allowed.invalid' };
    const response = await r.fetch({ headers });
    assert.equal(response.status(), 403);
    await r.fulfill({ response });
  });
  await p.goto(url({ page: 'reflection', jobId: s.effect, recordId: s.effect }));
  await p.getByRole('alert').waitFor();
  assert.equal(await p.locator('[data-focus="change-0"]').count(), 0);
  await shot(p, 'reflection-403', 1440);
  await p.unroute(detail);
  await p.getByRole('button', { name: '重新读取', exact: true }).click();
  await p.locator('[data-focus="change-0"]').waitFor();
  await p.route(detail, async (r) => {
    const headers = { ...r.request().headers() };
    delete headers.authorization;
    const response = await r.fetch({ headers });
    assert.equal(response.status(), 401);
    await r.fulfill({ response });
  });
  await p.getByRole('button', { name: '刷新', exact: true }).click();
  await p.getByRole('heading', { name: '连接 Agent Host', exact: true }).waitFor();
  assert.equal(await p.locator('[data-focus="change-0"]').count(), 0);
  await p.unroute(detail);
  await p.getByLabel('连接令牌', { exact: true }).fill(config.token);
  await p.getByRole('button', { name: '连接', exact: true }).click();
  await p.locator('[data-focus="change-0"]').waitFor();
  return { origin: 403, bearer: 401, noProtectedContentAfter401: true, recovered: true };
});
await check('超出末页恢复；Memory成果跨项目404不回退到其他项目', 1440, async () => {
  await p.goto(url({ page: 'reflections', sessionId: s.source, offset: 1000 }));
  await p.getByRole('heading', { name: '这一页已没有记录', exact: true }).waitFor();
  await p.getByRole('button', { name: '返回第一页', exact: true }).click();
  await p.locator('[data-job]').first().waitFor();
  assert.equal(JSON.parse(new URL(p.url()).searchParams.get('r')).offset, 0);
  const record = (await api(`/reflections/${s.effect}`)).data.record;
  const id = record.changes[1].id;
  const actual = await api(`/memory/${id}?${new URLSearchParams({ project: s.other, includeHistory: 'true' })}`);
  assert.equal(actual.status, 404);
  await p.goto(url({ page: 'result', target: { kind: 'memory', id, revision: 2, project: s.other } }));
  await p.getByRole('alert').waitFor();
  assert.equal(await p.getByRole('heading', { name: '受控反思成果 effect', exact: true }).count(), 0);
  return { outOfRangeRecovered: 0, wrongProject: 404, noScopeFallback: true };
});
await check('列表240字符投影与完整长结论分开；不同记录不借Session标题区分', 1440, async () => {
  const cat = (await api(`/reflections?view=summary&sessionId=${s.source}&limit=20&offset=0`)).data;
  const long = cat.records.find((r) => r.summary.length === 240);
  assert.ok(long);
  await p.goto(url({ page: 'reflections', sessionId: s.source, offset: 0 }));
  const row = p.locator(`[data-job="${long.jobId}"]`);
  await row.waitFor();
  assert.equal(await row.locator('.host-check-summary').innerText(), long.summary);
  await row.click();
  const full = (await api(`/reflections/${long.id}`)).data.record;
  await p.locator('.aw-review-lead').waitFor();
  assert.equal((await p.locator('.aw-review-lead').innerText()).trim(), full.summary);
  assert.ok(full.summary.length > 240);
  await p.locator('.host-reflection-task > summary').click();
  assert.match(await p.locator('.host-reflection-task').innerText(), /检查第/);
  return { list: 240, detail: full.summary.length, fullTaskTitleAvailable: true };
});
await ctx.close();
await b.close();
await save('reflection-boundaries');
