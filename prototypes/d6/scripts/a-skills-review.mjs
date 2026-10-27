import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = 'evidence/a-skills-20261023';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  slowMo: 250,
});
const results = [],
  errors = [];
for (const width of [1440, 850, 390]) {
  const c = await browser.newContext({
    viewport: { width, height: 1000 },
    recordVideo: { dir: `${root}/video`, size: { width, height: 1000 } },
  });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto('http://127.0.0.1:4186/?route=quiet');
  async function nav(label) {
    if (!(await p.locator('.sidebar').isVisible()))
      await p.getByRole('button', { name: '打开导航', exact: true }).click();
    await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name: label, exact: true }).click();
  }
  async function click(name) {
    await p.getByRole('button', { name, exact: true }).click();
  }
  async function shot(name) {
    await p.mouse.move(width - 1, 999);
    await p.evaluate(() => document.activeElement?.blur());
    await p.waitForTimeout(1200);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name);
    await p.screenshot({ path: `${root}/after/${name}-${width}.png` });
  }
  await nav('技能与工具');
  await shot('catalog');
  await p.getByRole('textbox', { name: '搜索已添加的技能' }).fill('文档');
  await p.locator('.asm-item').filter({ hasText: '文档比较' }).click();
  await shot('detail');
  await click('编辑技能');
  await p
    .getByRole('textbox', { name: '编辑 SKILL.md', exact: true })
    .fill(
      '# text-diff\n比较文本的语义与行级变化，保留章节和文件位置。\n\n## 报告规则\n- 先给出主要变化与影响，再展示细节。\n- 每项变化附上章节位置，便于逐条核对。\n- 保留新增、删除和上下文；不要仅依赖颜色。\n- 对无法读取的材料说明缺口，不补造结论。\n\n## 工具\n按需使用 text_diff，比较前确认输入材料覆盖范围。',
    );
  await shot('editor');
  await click('保存候选');
  await shot('candidate');
  await click('审查与发布');
  assert(!(await p.getByRole('button', { name: '检查并生效', exact: true }).isEnabled()));
  await click('审查内容与依赖');
  await shot('trust');
  await p.getByRole('checkbox', { name: '我已审查完整内容与依赖引用' }).check();
  await click('记录本次内容审查');
  await p.getByRole('dialog').waitFor({ state: 'hidden' });
  await shot('release');
  await click('检查并生效');
  await p.getByText('必要检查通过，新版本已生效。', { exact: true }).waitFor();
  await shot('published');
  assert(await p.getByText('当前正式 v2', { exact: true }).isVisible());
  await p.getByRole('tab', { name: '版本', exact: true }).click();
  await p.getByRole('button', { name: 'v1 历史版本', exact: true }).click();
  await shot('versions');
  await click('恢复此版本');
  await shot('restore');
  await click('确认恢复 v1');
  await p.getByRole('dialog').waitFor({ state: 'hidden' });
  assert(await p.getByText('已恢复 v1，版本历史仍保留。', { exact: true }).isVisible());
  await shot('restored');
  // Continue naturally into the skill's actual tools.
  await p.getByRole('tablist', { name: '技能管理内容' }).getByRole('tab', { name: '工具', exact: true }).click();
  await p.locator('.asm-contribution').click();
  await shot('tools');
  await click('管理文档比较');
  await p.getByRole('switch', { name: '启用当前技能' }).uncheck();
  await p.getByRole('tablist', { name: '技能管理内容' }).getByRole('tab', { name: '工具', exact: true }).click();
  await p.locator('.asm-contribution').click();
  assert(await p.getByText('来源不可用', { exact: true }).isVisible());
  await shot('disabled-tool');
  await click('管理文档比较');
  await p.getByRole('switch', { name: '启用当前技能' }).check();
  results.push({
    width,
    checks: [
      'find-status',
      'edit-candidate',
      'formal-unchanged-until-publish',
      'trust-required',
      'check-publish-v2',
      'history-restore-v1',
      'disabled-owner-removes-tool',
    ],
  });
  await p.waitForTimeout(900);
  const v = p.video();
  await c.close();
  await v.saveAs(`${root}/video/skill-lifecycle-${width}.webm`);
  await v.delete();
}
await fs.writeFile(`${root}/regression.json`, JSON.stringify({ results, errors }, null, 2));
await browser.close();
assert.equal(errors.length, 0);
console.log(JSON.stringify(results));
