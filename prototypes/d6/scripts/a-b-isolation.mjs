import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const dir = new URL('../evidence/a-refinement/b-isolation/', import.meta.url);
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
for (const [phase, port] of [
  ['before', 4178],
  ['after', 4176],
]) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`http://127.0.0.1:${port}/?route=studio`);
  async function shot(name) {
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(200);
    await p.screenshot({ path: fileURLToPath(new URL(`${phase}-${name}.png`, dir)), animations: 'disabled' });
  }
  await shot('chat');
  for (const [space, label, key] of [
    ['工作', '执行记录', 'trace'],
    ['认识', '记忆', 'memory'],
    ['认识', '反思', 'reflection'],
    ['能力', '能力库', 'skills'],
    ['能力', '能力改进', 'evolution'],
  ]) {
    await p.getByRole('navigation', { name: '工作空间' }).getByRole('button', { name: space, exact: true }).click();
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: label, exact: true }).click();
    await shot(key);
  }
  await p.getByRole('button', { name: '开始讨论目标', exact: true }).click();
  await p.getByRole('button', { name: '发送讨论内容', exact: true }).click();
  await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
  await shot('grant');
  await p.getByRole('button', { name: '模型与连接', exact: true }).first().click();
  await shot('settings');
  await p.keyboard.press('Meta+k');
  await shot('search-dialog');
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: '开发演示结果', exact: true }).click();
  await shot('menu');
  await p.keyboard.press('Escape');
  await p.close();
}
await browser.close();
console.log('B: stable primary pages, grant, dialog and menu captured before/after');
