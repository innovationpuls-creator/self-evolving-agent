import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch, context, record, shot, check, save, url } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../.runtime/scenario.json', import.meta.url), 'utf8'));
const browser = await launch();
for (const width of [1440, 850, 390]) {
  const ctx = await context(browser, width),
    page = await ctx.newPage();
  record(page, width);
  const nav = async (name) => {
    if (!(await page.locator('.sidebar').isVisible()))
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
    if (name === '模型与连接') await page.getByRole('button', { name, exact: true }).click();
    else await page.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
  };
  try {
    await check('最终界面保留项目、搜索、分页、编辑和历史上下文', width, async () => {
      await page.goto(url({ page: 'memory', project: s.project, scope: 'project', query: s.prefix }));
      await page.locator('.aw-memory-row').first().waitFor();
      await shot(page, 'list-final', width);
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await page.locator('.aw-memory-row').first().waitFor();
      await page.getByLabel('浏览范围').selectOption(s.other);
      await page.getByLabel('记忆作用域筛选').selectOption('project');
      await page.getByText('此范围内没有符合条件的记忆', { exact: true }).waitFor();
      if (!(await page.locator('.sidebar').isVisible()))
        await page.getByRole('button', { name: '打开导航', exact: true }).click();
      assert.match(await page.locator('.project-path').innerText(), /beta/);
      await nav('模型与连接');
      await nav('记忆');
      assert.equal(await page.getByLabel('浏览范围').inputValue(), s.other);
      assert.equal(await page.getByLabel('搜索记忆内容').inputValue(), s.prefix);
      await page.getByLabel('浏览范围').selectOption(s.project);
      await page.getByLabel('搜索记忆内容').fill(`${s.prefix} 02`);
      await page.locator('.aw-memory-row').click();
      await page.getByRole('button', { name: '编辑记忆', exact: true }).click();
      assert.ok((await page.getByLabel('知识内容').inputValue()).length > 8000);
      await shot(page, 'editor-long', width);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('button', { name: '暂时离开', exact: true }).click();
      await page.locator('.aw-document-heading').waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('data-focus') === 'memory-edit');
      await page.getByRole('button', { name: '修订历史 · 1', exact: true }).click();
      await shot(page, 'history-final', width);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      return { scope: 'beta retained, then alpha explicitly selected', longContent: true, overflow: false };
    });
  } finally {
    await ctx.close();
  }
}
await browser.close();
await save('final-ui');
