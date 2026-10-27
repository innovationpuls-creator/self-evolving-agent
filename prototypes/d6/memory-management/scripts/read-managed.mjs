import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch, context, record, check, save, url, shot } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../.runtime/scenario.json', import.meta.url), 'utf8')),
  browser = await launch();
for (const width of [1440, 850, 390]) {
  const ctx = await context(browser, width),
    page = await ctx.newPage();
  record(page, width);
  await check('本轮管理记录的确切来源定位，返回会话草稿与导航焦点', width, async () => {
    await page.goto(url({ page: 'session', sessionId: s.first }));
    await page.getByLabel('发送给 Agent', { exact: true }).fill(`阅读回归草稿 ${width}`);
    if (!(await page.locator('.sidebar').isVisible()))
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: '记忆', exact: true }).click();
    await page.getByRole('button', { name: '历史查询', exact: true }).click();
    await page.getByLabel('搜索记忆内容').fill(`管理闭环 ${s.stamp} ${width}`);
    await page.locator('.aw-memory-row').first().click();
    await page.getByRole('button', { name: '记忆来源 1', exact: true }).click();
    await page.getByRole('heading', { name: '依据与来源', exact: true }).waitFor();
    const source = JSON.parse(new URL(page.url()).searchParams.get('r')).reference;
    assert.equal(source.sessionId, s.second);
    await shot(page, 'managed-source', width);
    await page.getByRole('button', { name: '在来源会话中定位', exact: true }).click();
    await page.locator('.host-located-message').waitFor();
    assert.equal(JSON.parse(new URL(page.url()).searchParams.get('r')).entryId, source.entryId);
    if (!(await page.locator('.sidebar').isVisible()))
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page.locator(`.session-list > button[data-session="${s.first}"]`).click();
    await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('发送给 Agent', { exact: true }).inputValue(), `阅读回归草稿 ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    return { source, exactEntryLocated: true, draftRetained: true };
  });
  await ctx.close();
}
await browser.close();
await save('read-managed');
