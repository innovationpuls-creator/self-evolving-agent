import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, launch, context, record, shot, check, save, url } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../.runtime/scenario.json', import.meta.url), 'utf8'));
const browser = await launch();
for (const width of [1440, 850, 390]) {
  const ctx = await context(browser, width),
    page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  record(page, width);
  try {
    await check('Global / Project 范围、真实跨页与返回条件和焦点', width, async () => {
      await page.goto(url({ page: 'memory', project: s.project, scope: 'project', query: s.prefix }));
      await page.locator('.aw-memory-row').first().waitFor();
      assert.equal(await page.locator('.aw-memory-row').count(), 30);
      const first = await page.locator('.aw-memory-row').first().innerText();
      await shot(page, 'list', width);
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await page.waitForFunction(() => JSON.parse(new URL(location.href).searchParams.get('r')).offset === 30);
      await page.locator('.aw-memory-row').first().waitFor();
      const second = await page.locator('.aw-memory-row').first().innerText();
      assert.notEqual(first, second);
      await shot(page, 'page-two', width);
      const key = await page.locator('.aw-memory-row').first().getAttribute('data-focus');
      await page.locator('.aw-memory-row').first().click();
      await page.locator('.aw-document-heading').waitFor();
      await page.getByRole('button', { name: '返回上一页', exact: true }).click();
      await page.locator('.aw-memory-row').first().waitFor();
      assert.equal(JSON.parse(new URL(page.url()).searchParams.get('r')).offset, 30);
      assert.equal(await page.getByLabel('搜索记忆内容').inputValue(), s.prefix);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-focus')), key);
      await page.getByLabel('记忆作用域筛选').selectOption('global');
      await page.locator('.aw-memory-row').first().waitFor();
      assert.match(await page.locator('.aw-memory-collection').innerText(), /Global/);
      await page.getByLabel('浏览范围').selectOption('');
      await page.locator('.aw-memory-row').first().waitFor();
      assert.equal(await page.getByLabel('记忆作用域筛选').count(), 0);
      await shot(page, 'global', width);
      return { pageSize: 30, offsetRestored: 30, focus: key, globalOnly: true };
    });
    await check('无结果、长正文完整阅读、空内容真实拒绝', width, async () => {
      await page.getByLabel('搜索记忆内容').fill(`none-${s.stamp}`);
      await page.getByText('此范围内没有符合条件的记忆', { exact: true }).waitFor();
      await shot(page, 'empty', width);
      await page.getByLabel('浏览范围').selectOption(s.project);
      await page.getByLabel('搜索记忆内容').fill(`${s.prefix} 02`);
      await page.locator('.aw-memory-row').click();
      await page.locator('.aw-document-heading').waitFor();
      const d = (
        await api(`/memory/${s.owned[1]}?${new URLSearchParams({ project: s.project, includeHistory: 'true' })}`)
      ).data;
      assert.ok(
        (
          await page
            .locator('.aw-note .markdown')
            .innerText()
            .catch(() => page.locator('.aw-note').innerText())
        ).includes('长内容段落'),
      );
      assert.ok(d.current.content.length > 8000);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      return { length: d.current.content.length, overflow: false };
    });
    await check('当前与不可访问修订不混用，管理草稿跨页面保持', width, async () => {
      await page.goto(
        url({ page: 'result', target: { kind: 'memory', id: s.owned[0], project: s.project, revision: 99999 } }),
      );
      await page.getByText('引用的修订未返回', { exact: true }).waitFor();
      assert.equal(await page.locator('.aw-document-heading').count(), 0);
      await page.goto(url({ page: 'memory', project: s.project }));
      await page.getByRole('button', { name: '新建记忆', exact: true }).click();
      await page.getByLabel('记忆标题', { exact: true }).fill(`待继续 ${width}`);
      await page.getByLabel('知识内容').fill('尚未发送的内容');
      await page.getByRole('button', { name: '暂时离开', exact: true }).click();
      await page.getByRole('button', { name: /继续草稿.*待继续/ }).click();
      assert.equal(await page.getByLabel('知识内容').inputValue(), '尚未发送的内容');
      await shot(page, 'editor-final', width);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      return { missingRevisionFallback: false, draftRetained: true };
    });
  } finally {
    await ctx.close();
  }
}
await check('Global 创建与短查询来自真实 Host；空白写入 400', 1440, async () => {
  const ctx = await context(browser, 1440),
    page = await ctx.newPage();
  record(page, 1440);
  try {
    await page.goto(url({ page: 'memory' }));
    await page.getByRole('button', { name: '新建记忆', exact: true }).click();
    const title = `${s.prefix} Global UI`;
    await page.getByLabel('记忆标题', { exact: true }).fill(title);
    await page.getByLabel('知识内容').fill('短');
    await page.getByLabel('修改依据').fill('隔离全局创建验证');
    assert.equal(await page.getByLabel('记忆作用域', { exact: true }).inputValue(), 'global');
    await page.getByRole('button', { name: '保存记忆', exact: true }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const id = JSON.parse(new URL(page.url()).searchParams.get('r')).target.id;
    await fs.writeFile(new URL('../.runtime/global-ui.json', import.meta.url), JSON.stringify({ id }));
    const data = (await api(`/memory/${id}?${new URLSearchParams({ project: s.other })}`)).data;
    assert.equal(data.current.scope, 'global');
    const blank = await api('/memory', 'POST', {
      knowledge: { title: '', content: ' ', kind: 'fact', scope: 'global' },
      reason: 'invalid test',
    });
    assert.equal(blank.status, 400);
    const short = (await api(`/memory?${new URLSearchParams({ query: '短', scope: 'global' })}`)).data;
    assert.ok(short.items.some((m) => m.id === id));
    return { global: id, crossProjectVisible: true, blank: 400, shortQuery: '短' };
  } finally {
    await ctx.close();
  }
});
await browser.close();
await save('browse');
