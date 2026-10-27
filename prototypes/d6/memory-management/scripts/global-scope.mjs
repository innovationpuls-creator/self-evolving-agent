import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { launch, context, url, check, save, shot } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../.runtime/scenario.json', import.meta.url), 'utf8')),
  browser = await launch();
for (const width of [1440, 850, 390]) {
  const ctx = await context(browser, width),
    page = await ctx.newPage();
  await check('无项目的 Global 浏览保留明确范围且无横向溢出', width, async () => {
    await page.goto(url({ page: 'memory', query: s.prefix }));
    await page.locator('.aw-memory-row').first().waitFor();
    assert.match(await page.locator('.project-path').textContent(), /全局记忆/);
    assert.equal(await page.getByLabel('浏览范围').inputValue(), '');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shot(page, 'global', width);
    return { scope: 'global', project: 'none' };
  });
  await ctx.close();
}
await browser.close();
await save('global-scope');
