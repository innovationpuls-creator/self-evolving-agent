import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const dir = 'evidence/a-navigation';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  recordVideo: { dir: `${dir}/video`, size: { width: 390, height: 844 } },
});
const p = await context.newPage();
await p.goto('http://127.0.0.1:4176/?route=quiet');
assert.equal(await p.locator('.prototype-bar').count(), 0);
await p.getByRole('button', { name: '打开导航', exact: true }).click();
await p.keyboard.press('Escape');
assert.equal(await p.locator('.sidebar').isVisible(), false);
await p.getByRole('button', { name: '打开导航', exact: true }).click();
await p.getByRole('button', { name: '关闭导航', exact: true }).click({ position: { x: 380, y: 400 } });
assert.equal(await p.locator('.sidebar').isVisible(), false);
await p.getByRole('button', { name: '打开导航', exact: true }).click();
await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: '技能与工具', exact: true }).click();
await p.getByRole('tab', { name: 'Tool', exact: true }).click();
await p.screenshot({ path: `${dir}/after/tools-390.png` });
await p.getByRole('button', { name: '返回上一个位置', exact: true }).click();
assert(await p.getByRole('tab', { name: '轨迹', exact: true }).isVisible());
await p.getByRole('tab', { name: '轨迹', exact: true }).click();
await p.screenshot({ path: `${dir}/after/trace-390.png` });
const video = p.video();
await context.close();
await video.saveAs(`${dir}/video/navigation.webm`);
await video.delete();
await browser.close();
await fs.writeFile(
  `${dir}/interactions.json`,
  JSON.stringify(
    {
      passed: [
        'normal view without test controls',
        'Escape closes navigation',
        'backdrop closes navigation',
        'Skill/Tool tabs',
        'return to session',
        'session trajectory',
      ],
    },
    null,
    2,
  ),
);
console.log('navigation interactions passed');
