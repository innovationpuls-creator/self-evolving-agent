import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = 'evidence/a-titles-20261023';
await fs.mkdir(`${root}/after`, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const inventory = [],
  errors = [],
  checks = [];
for (const width of [1440, 850, 390]) {
  const p = await browser.newPage({ viewport: { width, height: 1000 } });
  p.setDefaultTimeout(6000);
  p.on('pageerror', (e) => errors.push(String(e)));
  const click = (name) => p.getByRole('button', { name, exact: true }).click();
  const h = (text) => p.getByRole('heading', { name: text, exact: true }).waitFor();
  async function nav(name) {
    if (!(await p.locator('.sidebar').isVisible())) await click('打开导航');
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
  }
  async function shot(name) {
    await p.evaluate(() => document.activeElement?.blur());
    await p.mouse.move(width - 1, 999);
    await p.waitForTimeout(140);
    await p.screenshot({ path: `${root}/after/${name}-${width}.png` });
    const state = await p.evaluate(() => {
      const visible = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
      return {
        headings: [...document.querySelectorAll('h1,h2,h3,legend')]
          .filter(visible)
          .map((e) => ({ level: e.tagName, text: e.innerText })),
        controls: [...document.querySelectorAll('.aw button,[role="dialog"] button,[role="tab"]')]
          .filter(visible)
          .map((e) => e.innerText || e.getAttribute('aria-label')),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    inventory.push({ width, name, ...state });
    assert(!state.overflow, `${name}-${width} overflow`);
  }
  const memoryRow = (title) => p.locator('.aw-memory-row').filter({ hasText: title });
  const reflectionRow = (title) => p.locator('.aw-journal-row').filter({ hasText: title });
  const proposalRow = (title) => p.locator('.aw-proposal-row').filter({ hasText: title });
  await p.goto('http://127.0.0.1:4186/?route=quiet&test=1');
  await nav('记忆');
  await shot('memory-list');
  await memoryRow('差异报告应单列未核实内容').click();
  await h('差异报告应单列未核实内容');
  await shot('memory-detail');
  await click('修订历史 · 2');
  await p.getByLabel('查看修订', { exact: true }).selectOption('1');
  await h('差异报告默认使用表格');
  await shot('memory-history');
  await click('查看修订来源');
  await shot('memory-source');
  assert(
    await p
      .getByRole('dialog')
      .innerText()
      .then((t) => t.includes('形成初始报告习惯')),
  );
  await click('关闭');
  await click('编辑记忆');
  await shot('memory-edit');
  await p.getByLabel('记忆标题', { exact: true }).fill('报告同时列出已核实与未核实内容');
  await p.getByLabel('修改依据', { exact: true }).fill('用户补充报告覆盖范围');
  await click('保存新修订');
  await h('报告同时列出已核实与未核实内容');
  await shot('memory-revised');
  await click('修订历史 · 3');
  await p.getByLabel('查看修订', { exact: true }).selectOption('2');
  await h('差异报告应单列未核实内容');
  await shot('memory-renamed-history');
  await click('最新修订');
  await click('管理这条记忆');
  await p.getByRole('menuitem', { name: '调整适用范围', exact: true }).click();
  await shot('memory-scope');
  await click('关闭');
  await click('管理这条记忆');
  await p.getByRole('menuitem', { name: '移除记忆', exact: true }).click();
  await shot('memory-delete');
  await click('保留记忆');
  await click('所有记忆');
  await memoryRow('旧客户端是否仍可登录').click();
  await shot('memory-doubt');
  await click('所有记忆');
  await memoryRow('恢复前保留旧数据目录').click();
  assert(!(await p.getByRole('button', { name: '编辑记忆', exact: true }).isEnabled()));
  await shot('memory-unavailable');
  await click('所有记忆');
  await p.getByRole('tab', { name: '已撤销', exact: true }).click();
  await memoryRow('保留密码登录作为默认入口').click();
  await shot('memory-revoked');
  await click('所有记忆');
  await click('添加记忆');
  await shot('memory-add');
  await click('取消');
  await p.getByRole('tab', { name: '当前记忆', exact: true }).click();
  await memoryRow('发布检查需区分已运行与未运行的测试').click();
  await shot('memory-other-task');
  await click('所有记忆');
  await click('切换演示场景');
  await p.getByRole('menuitem', { name: '下次编辑发生冲突', exact: true }).click();
  await memoryRow('发布检查需区分已运行与未运行的测试').click();
  await click('编辑记忆');
  await shot('memory-conflict');
  await click('已核对，继续编辑');
  await p.getByLabel('修改依据', { exact: true }).fill('核对后保留原内容');
  await click('保存新修订');
  await nav('反思记录');
  await shot('reflection-list');
  for (const [title, name, heading] of [
    ['比较两版项目说明', 'reflection-detail', '两版正文已比较，旧客户端支持范围仍待核实。'],
    ['整理版本发布说明', 'reflection-none', '本次没有新增发现。'],
    ['整理项目结构', 'reflection-unavailable', '检查等待处理'],
    ['核对发布测试范围', 'reflection-other-task', '增量构建已通过，集成测试未运行。'],
    ['核验备份恢复结果', 'reflection-failed', '检查失败'],
    ['排查下载中断', 'reflection-interrupted', '检查已中断'],
    ['整理研究笔记', 'reflection-pending', '等待检查'],
    ['核对旧版 API 兼容范围', 'reflection-insufficient', '已保存的检查结论'],
  ]) {
    await reflectionRow(title).click();
    await h(heading);
    await shot(name);
    if (name === 'reflection-detail') {
      await click('查看证据与原始记录');
      await shot('reflection-source');
      await p.getByRole('dialog').getByRole('button', { name: '打开来源会话', exact: true }).click();
      assert.equal(await p.getByRole('dialog').count(), 0);
      await nav('反思记录');
    }
    if (name === 'reflection-unavailable') {
      await click('查看重新检查的条件');
      await shot('reflection-recovery');
      await p.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).last().click();
    }
    if (name === 'reflection-failed') {
      assert(
        await p
          .locator('.aw:visible')
          .innerText()
          .then((t) => t.includes('恢复核验只覆盖了清单中的两个文件')),
      );
      await p
        .locator('.aw:visible')
        .getByRole('button', { name: /恢复核验只覆盖了清单中的两个文件/ })
        .click();
      await h('恢复核验只覆盖了清单中的两个文件');
      await nav('反思记录');
    }
    await click('所有反思记录');
  }
  await p.getByRole('tab', { name: '待核实', exact: true }).click();
  assert.equal(await p.locator('.aw-journal-row').count(), 3);
  await shot('reflection-uncertainties');
  await nav('改进建议');
  await shot('evolution-list');
  await proposalRow('为发布报告附上实际运行的测试范围').click();
  await shot('evolution-pending');
  await p
    .locator('.aw:visible')
    .getByRole('button', { name: /记忆 · 修订 2 发布检查/ })
    .click();
  await h('发布检查需区分已运行与未运行的测试');
  assert.equal(await p.getByLabel('查看修订', { exact: true }).inputValue(), '2');
  await nav('改进建议');
  await click('所有改进建议');
  await p.getByRole('tab', { name: '处理历史', exact: true }).click();
  await shot('evolution-history');
  for (const [title, name] of [
    ['核对文档比较对缺失材料的处理', 'evolution-covered'],
    ['备份报告区分已核验与未核验的文件', 'evolution-adopted'],
    ['迁移脚本记录运行环境', 'evolution-no-evidence'],
  ]) {
    await proposalRow(title).click();
    await shot(name);
    if (name === 'evolution-covered')
      assert(
        await p
          .locator('.aw:visible')
          .innerText()
          .then((t) => !t.includes('现有规则已覆盖') && t.includes('记录未保存忽略原因')),
      );
    await click('所有改进建议');
  }
  for (const [title, name] of [
    ['让发布报告区分实际运行的测试范围', 'evolution-released'],
    ['核对文档比较是否需要调整缺失材料规则', 'evolution-no-release'],
    ['核对备份报告中的文件校验结果', 'evolution-partial-release'],
    ['整理迁移报告的环境信息', 'evolution-cancelled-history'],
  ]) {
    await proposalRow(title).click();
    await shot(name);
    if (name === 'evolution-partial-release') await h('已记录的版本发布 · 1');
    await click('处理历史');
  }
  await click('发起改进讨论');
  await shot('evolution-discussion');
  await click('审阅开发授权');
  await shot('evolution-grant');
  assert(!(await p.getByRole('button', { name: '授权并开始开发', exact: true }).isEnabled()));
  await p.getByLabel('授权目标', { exact: true }).fill('在差异报告中附上对应章节，保留材料缺失说明');
  await click('授权并开始开发');
  await shot('evolution-developing');
  await p.getByText('正在检查候选', { exact: true }).waitFor();
  await shot('evolution-checking');
  await p.getByText('开发结束，未记录版本发布', { exact: true }).waitFor();
  await shot('evolution-nochange');
  await click('查看授权与检查记录');
  await shot('evolution-record');
  await click('关闭');
  for (const [outcome, name] of [
    ['检查通过', 'applied'],
    ['检查失败', 'failed'],
    ['无需修改', 'cancelled'],
  ]) {
    await click('重新讨论');
    await click('开发演示结果');
    await p.getByRole('menuitem', { name: outcome, exact: true }).click();
    await click('审阅开发授权');
    await p.getByLabel('授权目标', { exact: true }).fill('在差异报告中附上对应章节，保留材料缺失说明');
    await click('授权并开始开发');
    if (name === 'cancelled') await click('取消开发');
    else await p.waitForTimeout(3700);
    await shot(`evolution-${name}`);
  }
  for (const module of ['记忆', '反思记录', '改进建议']) {
    await nav(module);
    for (const [scene, key] of [
      ['加载', 'loading'],
      ['空内容', 'empty'],
      ['读取失败', 'error'],
    ]) {
      await click('切换演示场景');
      await p.getByRole('menuitem', { name: scene, exact: true }).click();
      await shot(`${module}-${key}`);
    }
  }
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  await shot('isolation-chat');
  await nav('技能与工具');
  await shot('isolation-skills');
  await p.goto('http://127.0.0.1:4186/?route=studio');
  await shot('isolation-B');
  checks.push({ width, result: 'passed' });
  await p.close();
  console.log(`${width}px passed`);
}
await browser.close();
await fs.writeFile(`${root}/after-inventory.json`, JSON.stringify({ inventory, errors, checks }, null, 2));
assert.equal(errors.length, 0);
