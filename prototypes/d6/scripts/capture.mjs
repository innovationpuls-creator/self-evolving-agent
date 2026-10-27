import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const out = new URL('../evidence/round2/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [];
for (const mode of ['quiet', 'studio']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:4176/?route=${mode}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: new URL(`${mode}-chat.png`, out).pathname });
  for (const [target, name] of [
    ['记忆', 'memory'],
    ['反思', 'reflection'],
    ['能力库', 'skills'],
    ['能力改进', 'evolution'],
    ['模型与连接', 'settings'],
  ]) {
    if (mode === 'studio' && ['memory', 'reflection'].includes(name))
      await page
        .getByRole('navigation', { name: '工作空间' })
        .getByRole('button', { name: '认识', exact: true })
        .click();
    if (mode === 'studio' && ['skills', 'evolution'].includes(name))
      await page
        .getByRole('navigation', { name: '工作空间' })
        .getByRole('button', { name: '能力', exact: true })
        .click();
    if (name === 'settings') await page.getByRole('button', { name: '模型与连接', exact: true }).first().click();
    else
      await page
        .getByRole('navigation', { name: '主要模块' })
        .getByRole('button', { name: target, exact: true })
        .click();
    await page.waitForTimeout(140);
    await page.screenshot({ path: new URL(`${mode}-${name}.png`, out).pathname });
  }
  await page.close();
}
await fs.writeFile(new URL('initial-console.json', out), JSON.stringify(errors, null, 2));
await browser.close();
