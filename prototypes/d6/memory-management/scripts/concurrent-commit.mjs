import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, launch, context, record, check, save, url, shot } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../.runtime/scenario.json', import.meta.url), 'utf8'));
const browser = await launch(),
  ctx = await context(browser, 1440),
  page = await ctx.newPage();
record(page, 1440);
await check('自己的提交后又被他人修订，仍打开本次保存的确切版本', 1440, async () => {
  const r = await api(`/memory?${new URLSearchParams({ project: s.project })}`, 'POST', {
    knowledge: { title: `${s.prefix} advancing-head`, content: 'base 1', scope: 'project', kind: 'fact' },
    reason: '隔离提交竞态测试',
  });
  assert.equal(r.status, 201);
  const m = r.data;
  await page.goto(url({ page: 'result', target: { kind: 'memory', id: m.id, project: s.project } }));
  await page.getByRole('button', { name: '编辑记忆', exact: true }).click();
  await page.getByLabel('知识内容').fill('my commit 2');
  await page.getByLabel('修改依据').fill('本次用户保存');
  await page.route(`**/api/memory/${m.id}/revise?*`, async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    const remote = await api(`/memory/${m.id}/revise?${new URLSearchParams({ project: s.project })}`, 'POST', {
      baseRevision: 2,
      knowledge: { title: m.title, content: 'another writer 3', kind: m.kind, scope: m.scope },
      reason: '他人随后提交',
    });
    assert.equal(remote.status, 200);
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await page.getByRole('heading', { name: m.title, exact: true }).waitFor();
  assert.equal(JSON.parse(new URL(page.url()).searchParams.get('r')).target.revision, 2);
  assert.match(await page.locator('.aw-note').innerText(), /my commit 2/);
  assert.match(await page.locator('.aw-note').innerText(), /当前已是修订 3/);
  assert.doesNotMatch(await page.locator('.aw-note').innerText(), /another writer 3/);
  await page.waitForFunction(() => document.activeElement?.tagName === 'H1');
  await shot(page, 'advancing-head', 1440);
  return { saved: 2, current: 3, opened: 2, focus: await page.evaluate(() => document.activeElement?.tagName) };
});
await ctx.close();
await browser.close();
await save('concurrent-commit');
