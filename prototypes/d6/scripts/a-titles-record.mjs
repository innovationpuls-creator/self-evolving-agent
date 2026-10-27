import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = 'evidence/a-titles-20261023';
await fs.rm(`${root}/recording`, { recursive: true, force: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  slowMo: 260,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: `${root}/recording`, size: { width: 1440, height: 1000 } },
});
const p = await context.newPage();
p.setDefaultTimeout(6000);
const click = (name) => p.getByRole('button', { name, exact: true }).click();
const nav = (name) =>
  p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
const pause = () => p.waitForTimeout(1100);
await p.goto('http://127.0.0.1:4186/?route=quiet');
await nav('记忆');
await pause();
await p.locator('.aw-memory-row').filter({ hasText: '发布检查需区分已运行与未运行的测试' }).click();
await pause();
await click('编辑记忆');
await p.getByLabel('记忆标题', { exact: true }).fill('发布报告需列出实际运行的检查');
await p.getByLabel('修改依据', { exact: true }).fill('用户明确区分构建结果与集成测试结果');
await pause();
await click('保存新修订');
await pause();
await click('修订历史 · 3');
await p.getByLabel('查看修订', { exact: true }).selectOption('1');
await pause();
await click('查看修订来源');
await pause();
await click('关闭');
await nav('反思记录');
await p.locator('.aw-journal-row').filter({ hasText: '核验备份恢复结果' }).click();
await pause();
await p
  .locator('.aw:visible')
  .getByRole('button', { name: /恢复核验只覆盖了清单中的两个文件/ })
  .click();
await pause();
await nav('改进建议');
await p.locator('.aw-proposal-row').filter({ hasText: '为发布报告附上实际运行的测试范围' }).click();
await pause();
await click('讨论这项建议');
await pause();
await p.getByLabel('讨论内容', { exact: true }).fill('先核对已有项目说明的报告规则，再判断是否需要修改。');
await click('发送讨论内容');
await pause();
await click('审阅开发授权');
assert(!(await p.getByRole('button', { name: '授权并开始开发', exact: true }).isEnabled()));
await p.getByLabel('选择现有技能', { exact: true }).selectOption('project-notes');
await p.getByRole('checkbox').check();
await p.getByLabel('授权目标', { exact: true }).fill('核对项目说明是否已有测试覆盖范围规则，已有则不修改。');
await pause();
await click('授权并开始开发');
await p.getByText('开发结束，未记录版本发布', { exact: true }).waitFor();
await pause();
await p.locator('.aw:visible .aw-return').click();
await p.getByRole('tab', { name: '处理历史', exact: true }).click();
await p.locator('.aw-proposal-row').filter({ hasText: '核对备份报告中的文件校验结果' }).click();
await pause();
await p.getByText('查看完整发布标识', { exact: true }).click();
await pause();
const video = p.video();
await context.close();
const path = await video.path();
await fs.rename(path, `${root}/flow.webm`);
await fs.rmdir(`${root}/recording`);
await browser.close();
console.log('Continuous browser recording saved: flow.webm');
