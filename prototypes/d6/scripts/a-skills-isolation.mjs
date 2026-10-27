import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = 'evidence/a-skills-20261023',
  results = [],
  errors = [];
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
for (const width of [1440, 850, 390]) {
  const p = await b.newPage({ viewport: { width, height: 1000 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  async function nav(n) {
    if (!(await p.locator('.sidebar').isVisible()))
      await p.getByRole('button', { name: '打开导航', exact: true }).click();
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: n, exact: true }).click();
  }
  async function shot(n) {
    await p.evaluate(() => document.activeElement?.blur());
    await p.mouse.move(width - 1, 999);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${root}/after/${n}-${width}.png` });
  }
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  await shot('chat');
  for (const n of ['记忆', '反思记录', '改进建议']) {
    await nav(n);
    await shot(n);
  }
  await nav('技能与工具');
  await p.locator('.asm-item').filter({ hasText: '文档比较' }).click();
  await p.getByRole('button', { name: '在会话中引用', exact: true }).click();
  assert(await p.locator('.composer').isVisible());
  results.push({ width, check: 'skill-reference-returns-to-conversation' });
  await p.goto('http://127.0.0.1:4186/?route=studio');
  await shot('B');
  for (const n of ['记忆', '反思', '能力库', '能力改进', '会话']) {
    const btn = p.getByRole('button', { name: n, exact: true });
    if (await btn.isVisible()) await btn.click();
  }
  results.push({ width, check: 'other-A-and-B-navigation', errors: errors.length });
  await p.close();
}
await fs.writeFile(`${root}/isolation.json`, JSON.stringify({ results, errors }, null, 2));
await b.close();
assert.equal(errors.length, 0);
console.log(results);
