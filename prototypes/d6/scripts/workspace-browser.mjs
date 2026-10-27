import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = 'evidence/a-workspace-20261024';
await fs.mkdir(`${root}/after`, { recursive: true });
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const checks = [],
  errors = [];
for (const width of [1440, 850, 390]) {
  const ctx = await b.newContext({
    viewport: { width, height: 1000 },
    ...(width === 1440 ? { recordVideo: { dir: `${root}/recording`, size: { width: 1440, height: 1000 } } } : {}),
  });
  const p = await ctx.newPage();
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
    await p.waitForTimeout(180);
    await p.screenshot({ path: `${root}/after/${name}-${width}.png` });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name);
    checks.push({ width, name });
  }
  const row = (title) => p.locator('.aw-memory-row').filter({ hasText: title });
  const tab = (name) => p.getByRole('tab', { name, exact: true }).click();
  const scope = (value) => p.getByLabel('浏览范围', { exact: true }).selectOption(value);
  async function list() {
    await click('所有记忆');
  }
  async function manage(name) {
    await click('管理这条记忆');
    await p.getByRole('menuitem', { name, exact: true }).click();
  }
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  await nav('记忆');
  await shot('memory');
  assert.equal(await row('研究摘录保留原文页码').count(), 0);
  await row('新版使用设备授权登录').click();
  await shot('memory-detail');
  await click('查看修订来源');
  await p.getByRole('dialog').getByRole('button', { name: '查看来源片段', exact: true }).click();
  await shot('memory-source');
  assert.match(await p.getByRole('dialog').last().innerText(), /设备授权/);
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await list();
  await scope('/Users/person/Projects/research');
  await row('研究摘录保留原文页码').waitFor();
  assert.equal(await row('新版使用设备授权登录').count(), 0);
  await shot('memory-research');
  await row('引用中区分观察与推断').click();
  await click('查看修订来源');
  assert.match(await p.getByRole('dialog').innerText(), /整理研究笔记/);
  await p.keyboard.press('Escape');
  await list();
  await scope('/Users/person/Projects/agent');
  await row('引用中区分观察与推断').click();
  await click('查看修订来源');
  assert.match(await p.getByRole('dialog').innerText(), /未返回可查看的证据引用/);
  assert.doesNotMatch(await p.getByRole('dialog').innerText(), /research-note/);
  await shot('memory-filtered-source');
  await p.keyboard.press('Escape');
  await list();
  await row('差异报告应单列未核实内容').click();
  await click('修订历史 · 2');
  await p.getByLabel('查看修订', { exact: true }).selectOption('1');
  await p.getByRole('heading', { name: '差异报告默认使用表格', exact: true }).waitFor();
  assert.equal(await p.getByRole('button', { name: '编辑记忆', exact: true }).count(), 0);
  await shot('memory-history');
  await list();
  await scope('/Users/person/Projects/research');
  await row('差异报告应单列未核实内容').click();
  await click('修订历史 · 1');
  assert.equal(await p.getByLabel('查看修订', { exact: true }).locator('option').count(), 1);
  await shot('memory-scoped-history');
  await list();
  await scope('global');
  await shot('memory-global');
  assert.equal(await row('研究摘录保留原文页码').count(), 0);
  await click('添加记忆');
  await p.getByLabel('记忆标题', { exact: true }).fill('报告标注材料日期');
  await p.getByLabel('记忆内容', { exact: true }).fill('引用外部材料时同时记录发布日期。');
  await p.getByLabel('记忆类别', { exact: true }).selectOption('experience');
  await p.getByLabel('记录依据', { exact: true }).fill('便于跨项目核对资料时效');
  assert.equal(await p.getByLabel('适用范围', { exact: true }).inputValue(), 'global');
  await shot('memory-create');
  await click('保存记忆');
  await p.getByRole('heading', { name: '报告标注材料日期', exact: true }).waitFor();
  await click('编辑记忆');
  await p.getByLabel('记忆标题', { exact: true }).fill('报告标注材料日期与版本');
  await p.getByLabel('修改依据', { exact: true }).fill('版本变化会影响适用范围');
  await click('保存新修订');
  await p.getByRole('heading', { name: '报告标注材料日期与版本', exact: true }).waitFor();
  await shot('memory-revised');
  await manage('撤销记忆');
  await p.getByLabel('操作依据', { exact: true }).fill('需要先核对资料版本标注方式');
  await shot('memory-retire');
  await p.getByRole('dialog').getByRole('button', { name: '撤销记忆', exact: true }).click();
  assert.match(await p.locator('.aw:visible').innerText(), /这条记忆已撤销/);
  await shot('memory-withdrawn');
  await click('重新确认记忆');
  await p.getByLabel('记忆内容', { exact: true }).fill('引用外部材料时记录发布日期与适用版本。');
  await p.getByLabel('修改依据', { exact: true }).fill('已核对，保留日期和版本两个字段');
  await click('保存并重新确认');
  await shot('memory-confirmed');
  await manage('移除记忆');
  await p.getByLabel('操作依据', { exact: true }).fill('不再作为单独条目维护');
  await p.getByRole('dialog').getByRole('button', { name: '移除记忆', exact: true }).click();
  assert.equal(await p.getByRole('button', { name: '编辑记忆', exact: true }).count(), 0);
  await list();
  await tab('全部修订');
  await p.getByLabel('搜索记忆内容').fill('报告标注材料');
  assert.equal(await p.locator('.aw-memory-row').count(), 5);
  await shot('memory-deleted-history');
  await p.getByLabel('搜索记忆内容').fill('');
  await scope('/Users/person/Projects/agent');
  await tab('暂不可用');
  await row('恢复前保留旧数据目录').click();
  assert.equal(await p.getByRole('button', { name: '编辑记忆', exact: true }).isEnabled(), false);
  await shot('memory-unavailable');
  await list();
  await tab('可使用');
  await nav('反思记录');
  await shot('reflection');
  await p.getByLabel('筛选来源会话', { exact: true }).selectOption('10000000-0000-4000-8000-000000000003');
  assert.equal(await p.locator('.aw-journal-row').count(), 1);
  await p.locator('.aw-journal-row').click();
  await shot('reflection-detail');
  await click('查看来源记录');
  assert.match(await p.getByRole('dialog').innerText(), /集成测试：未运行/);
  await shot('reflection-source');
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: /记忆 · 修订 2.*发布检查需区分/ }).click();
  assert.equal(await p.getByLabel('浏览范围', { exact: true }).inputValue(), '/Users/person/Projects/agent');
  await p.getByRole('heading', { name: '发布检查需区分已运行与未运行的测试', exact: true }).waitFor();
  await shot('reflection-memory-link');
  await nav('反思记录');
  await click('所有反思记录');
  await p.getByLabel('筛选来源会话', { exact: true }).selectOption('all');
  await p.locator('.aw-journal-row').filter({ hasText: '核验备份恢复结果' }).click();
  assert.match(await p.locator('.aw:visible').innerText(), /恢复核验只覆盖了清单中的两个文件/);
  await shot('reflection-failed');
  await nav('改进建议');
  await shot('evolution');
  await p.locator('.aw-proposal-row').filter({ hasText: '为发布报告附上实际运行的测试范围' }).click();
  await shot('suggestion');
  await click('讨论这项建议');
  await shot('discussion');
  assert.match(await p.locator('.aw-discussion-intro').innerText(), /不把构建通过当作集成测试通过/);
  await p.getByLabel('讨论内容', { exact: true }).fill('先核对已有报告指引是否已记录未运行的检查，再决定是否修改。');
  await click('发送讨论内容');
  await click('审阅开发授权');
  assert.equal(await p.getByRole('button', { name: '授权并开始开发', exact: true }).isEnabled(), false);
  await shot('grant');
  await p.getByRole('dialog').getByRole('checkbox').check();
  await click('授权并开始开发');
  await p.getByRole('heading', { name: '开发结束，未记录版本发布', exact: true }).waitFor();
  await shot('development-no-release');
  await nav('技能与工具');
  await shot('skills');
  await p.getByRole('tablist', { name: '能力类型' }).getByRole('tab', { name: '工具', exact: true }).click();
  await p.locator('.asm-item').filter({ hasText: '比较文本' }).click();
  await shot('tools');
  await p.getByLabel('查看会话中的工具', { exact: true }).selectOption('10000000-0000-4000-8000-000000000002');
  assert.match(
    await p.locator('.asm-tool-states').innerText(),
    /已加载到会话[\s\S]*是[\s\S]*已向模型声明[\s\S]*否[\s\S]*不可调用/,
  );
  await shot('tool-loaded-not-callable');
  await nav('记忆');
  await scope('follow');
  await row('新版使用设备授权登录').waitFor();
  assert.equal(await row('研究摘录保留原文页码').count(), 0);
  await shot('memory-shared-project');
  await nav('技能与工具');
  await p.getByLabel('查看会话中的工具', { exact: true }).selectOption('10000000-0000-4000-8000-000000000007');
  assert.match(await p.locator('.asm-tool-states').innerText(), /已加载到会话[\s\S]*否/);
  await shot('tool-other-project');
  await p.getByLabel('查看会话中的工具', { exact: true }).selectOption('');
  await nav('记忆');
  await scope('follow');
  await shot('memory-no-session');
  assert.equal(await row('新版使用设备授权登录').count(), 0);
  assert.equal(await row('差异报告应单列未核实内容').count(), 1);
  const video = p.video();
  await ctx.close();
  if (video) await video.saveAs(`${root}/flow.webm`);
}
await b.close();
assert.deepEqual(errors, []);
await fs.rm(`${root}/recording`, { recursive: true, force: true });
await fs.writeFile(`${root}/browser.json`, JSON.stringify({ checks, errors }, null, 2));
console.log(JSON.stringify({ checks: checks.length, errors }));
