import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-workspace-20261024',
  checks = [],
  errors = [];
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
for (const width of [1440, 850, 390]) {
  const p = await b.newPage({ viewport: { width, height: 1000 } });
  p.setDefaultTimeout(6000);
  p.on('pageerror', (e) => errors.push(String(e)));
  const click = (name) => p.getByRole('button', { name, exact: true }).click();
  async function nav(name) {
    if (!(await p.locator('.sidebar').isVisible())) await click('打开导航');
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
  }
  async function shot(name) {
    await p.evaluate(() => document.activeElement?.blur());
    await p.mouse.move(width - 1, 999);
    await p.waitForTimeout(150);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await p.screenshot({ path: `${root}/after/${name}-${width}.png` });
    checks.push({ width, name });
  }
  const row = (title) => p.locator('.aw-memory-row').filter({ hasText: title });
  await p.goto('http://127.0.0.1:4186/?route=quiet&test=1');
  await nav('记忆');
  await p.getByRole('tab', { name: '全部修订', exact: true }).click();
  await row('差异报告默认使用表格').click();
  await p.getByRole('heading', { name: '差异报告默认使用表格', exact: true }).waitFor();
  assert.equal(await p.getByRole('button', { name: '编辑记忆', exact: true }).count(), 0);
  await shot('memory-history-search');
  await click('所有记忆');
  await p.getByRole('tab', { name: '可使用', exact: true }).click();
  await row('引用中区分观察与推断').click();
  await click('编辑记忆');
  await p.getByLabel('修改依据', { exact: true }).fill('核对措辞后保留原认识');
  await click('保存新修订');
  await click('所有记忆');
  await p.getByLabel('浏览范围', { exact: true }).selectOption('/Users/person/Projects/research');
  await row('引用中区分观察与推断').click();
  await click('查看修订来源');
  assert.match(await p.getByRole('dialog').innerText(), /整理研究笔记/);
  await shot('memory-preserved-private-source');
  await p.keyboard.press('Escape');
  await click('所有记忆');
  await nav('反思记录');
  await p.locator('.aw-journal-row').filter({ hasText: '核对发布测试范围' }).click();
  await p.getByRole('button', { name: /记忆 · 修订 2.*发布检查需区分/ }).click();
  assert.equal(await p.getByLabel('浏览范围', { exact: true }).inputValue(), '/Users/person/Projects/agent');
  await shot('memory-cross-project-link');
  await nav('反思记录');
  await click('所有反思记录');
  await p.locator('.aw-journal-row').filter({ hasText: '整理项目结构' }).click();
  await click('查看来源记录');
  assert.match(await p.getByRole('dialog').innerText(), /来源片段不可用/);
  await shot('source-unavailable');
  await p.keyboard.press('Escape');
  await nav('改进建议');
  await p.locator('.aw-proposal-row').filter({ hasText: '为发布报告附上实际运行的测试范围' }).click();
  await click('暂不采纳这项建议');
  await shot('suggestion-decision');
  await click('暂不采纳');
  assert.match(await p.locator('.aw:visible').innerText(), /已忽略/);
  assert.doesNotMatch(await p.locator('.aw:visible').innerText(), /无需修改|已覆盖/);
  await shot('suggestion-ignored');
  await click('所有改进建议');
  await p.getByRole('tab', { name: '待决定', exact: true }).click();
  assert.equal(await p.locator('.aw-proposal-row').count(), 0);
  await p.getByRole('tab', { name: '处理历史', exact: true }).click();
  await p.locator('.aw-proposal-row').filter({ hasText: '备份报告区分已核验与未核验的文件' }).click();
  await click('继续讨论这项建议');
  assert.match(await p.locator('.aw-discussion-intro').innerText(), /拟议目标/);
  await shot('discussion-adopted');
  await p.locator('.aw-return:visible').click();
  await p.getByRole('tab', { name: '处理历史', exact: true }).click();
  await p.locator('.aw-proposal-row').filter({ hasText: '迁移脚本记录运行环境' }).click();
  assert.equal(await p.getByRole('button', { name: '讨论这项建议', exact: true }).count(), 0);
  await shot('suggestion-archived');
  for (const module of ['记忆', '反思记录', '改进建议']) {
    await nav(module);
    for (const [label, name] of [
      ['加载', 'loading'],
      ['空内容', 'empty'],
      ['读取失败', 'error'],
    ]) {
      await click('切换演示场景');
      await p.getByRole('menuitem', { name: label, exact: true }).click();
      await shot(`${module}-${name}`);
    }
  }
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  await shot('chat');
  await nav('记忆');
  await shot('memory');
  await row('新版使用设备授权登录').click();
  await shot('memory-detail');
  await nav('反思记录');
  await shot('reflection');
  await nav('改进建议');
  await shot('evolution');
  await p.locator('.aw-proposal-row').filter({ hasText: '为发布报告附上实际运行的测试范围' }).click();
  await shot('suggestion');
  await nav('技能与工具');
  await shot('skills');
  await p.goto('http://127.0.0.1:4186/?route=studio');
  await shot('studio');
  await p
    .getByRole('navigation', { name: '工作空间', exact: true })
    .getByRole('button', { name: '认识', exact: true })
    .click();
  assert.equal(await p.locator('h1:visible').count(), 1);
  await nav('反思');
  assert.equal(await p.locator('h1:visible').count(), 1);
  await p
    .getByRole('navigation', { name: '工作空间', exact: true })
    .getByRole('button', { name: '能力', exact: true })
    .click();
  assert.equal(await p.locator('h1:visible').count(), 1);
  await nav('能力改进');
  assert.equal(await p.locator('h1:visible').count(), 1);
  await p.close();
}
await b.close();
assert.deepEqual(errors, []);
await fs.writeFile(`${root}/extra.json`, JSON.stringify({ checks, errors }, null, 2));
console.log(JSON.stringify({ checks: checks.length, errors }));
