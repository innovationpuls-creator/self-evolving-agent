import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const before = process.argv.includes('--before');
const dir = `evidence/a-navigation/${before ? 'before' : 'after'}`;
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [];
for (const width of [1440, 850, 390]) {
  const p = await browser.newPage({ viewport: { width, height: width === 1440 ? 1000 : 844 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('http://127.0.0.1:4176/?route=quiet');
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${dir}/session-${width}.png`, animations: 'disabled' });
  if (width <= 700) await p.getByRole('button', { name: '打开导航', exact: true }).click();
  await p.screenshot({ path: `${dir}/navigation-${width}.png`, animations: 'disabled' });
  for (const [old, label] of [
    ['能力改进', '改进建议'],
    ['记忆', '记忆'],
    ['能力库', '技能与工具'],
    ['反思', '反思记录'],
  ]) {
    if (!(await p.locator('.sidebar').isVisible()))
      await p.getByRole('button', { name: '打开导航', exact: true }).click();
    await p
      .getByRole('navigation', { name: '主要模块' })
      .getByRole('button', { name: before ? old : label, exact: true })
      .click();
    await p.screenshot({ path: `${dir}/${label}-${width}.png`, animations: 'disabled' });
  }
  await p.close();
}
const b = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await b.goto('http://127.0.0.1:4176/?route=studio');
await b.evaluate(() => document.fonts.ready);
await b.screenshot({ path: `${dir}/B.png`, animations: 'disabled' });
assert.deepEqual(errors, []);
await browser.close();
console.log(dir);
