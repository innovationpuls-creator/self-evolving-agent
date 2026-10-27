import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
const phase = process.argv[2] ?? 'before';
await fs.mkdir(`evidence/a-workspace-20261024/${phase}`, { recursive: true });
import { chromium } from 'playwright-core';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
for (const width of [1440, 850, 390]) {
  const p = await b.newPage({ viewport: { width, height: 1000 } });
  async function nav(name) {
    if (!(await p.locator('.sidebar').isVisible()))
      await p.getByRole('button', { name: '打开导航', exact: true }).click();
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
  }
  async function shot(name) {
    await p.mouse.move(width - 1, 999);
    await p.screenshot({ path: `evidence/a-workspace-20261024/${phase}/${name}-${width}.png` });
  }
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  await shot('chat');
  await nav('记忆');
  await shot('memory');
  await p.locator('.aw-memory-row').filter({ hasText: '新版使用设备授权登录' }).click();
  await shot('memory-detail');
  await nav('反思记录');
  await shot('reflection');
  await nav('改进建议');
  await shot('evolution');
  await p.locator('.aw-proposal-row').filter({ hasText: '为发布报告附上实际运行的测试范围' }).click();
  await shot('suggestion');
  await nav('技能与工具');
  await shot('skills');
  await p.getByRole('tablist', { name: '能力类型' }).getByRole('tab', { name: '工具', exact: true }).click();
  await shot('tools');
  await p.goto('http://127.0.0.1:4186/?route=studio');
  await shot('studio');
  await p.close();
}
await b.close();
