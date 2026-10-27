import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const dir = new URL('../evidence/a-refinement/after/interactions/', import.meta.url);
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [],
  errors = [];
async function fresh(name, { width = 1440, height = 1000, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion,
    recordVideo: { dir: fileURLToPath(dir), size: { width, height } },
  });
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('request', (r) => {
    if (
      !r.url().startsWith('http://127.0.0.1:4176/') &&
      !r.url().startsWith('ws://127.0.0.1:4176/') &&
      !r.url().startsWith('data:')
    )
      errors.push(r.url());
  });
  await p.goto('http://127.0.0.1:4176/?route=quiet&test=1');
  return {
    p,
    async close() {
      const video = p.video();
      await context.close();
      await video.saveAs(fileURLToPath(new URL(`${name}.webm`, dir)));
      await video.delete();
    },
  };
}
async function nav(p, name) {
  if (!(await p.locator('.sidebar').isVisible()))
    await p.getByRole('button', { name: '打开导航', exact: true }).click();
  await p.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
}
async function snapshot(p, name) {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(200);
  await p.screenshot({ path: fileURLToPath(new URL(`${name}.png`, dir)) });
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const dlg = p.getByRole('dialog');
  if (await dlg.isVisible())
    assert(await dlg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'dialog overflow');
}
async function noRunningAnimation(p) {
  await p.waitForTimeout(200);
  const running = await p.locator('.app.quiet').evaluate((el) =>
    el
      .getAnimations({ subtree: true })
      .filter((a) => a.playState === 'running')
      .map((a) => ({ name: a.animationName, target: a.effect?.target?.outerHTML?.slice(0, 200) })),
  );
  assert.deepEqual(running, [], 'terminal animation remains');
}
try {
  if (!process.argv.includes('--evolution-only')) {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const s = await fresh(`会话-${reducedMotion}`, { reducedMotion });
      const p = s.p;
      assert.equal(await p.locator('.tool-activity').getByText('5 次调用 · 1 次失败', { exact: true }).count(), 1);
      await p.locator('.tool-activity summary').first().click();
      assert.equal(await p.locator('.tool-activity-calls button').filter({ visible: true }).count(), 3);
      await p.getByRole('button', { name: /read 资料\/兼容说明/ }).click();
      assert((await p.getByRole('dialog').getByText('文件不存在', { exact: false }).count()) > 0);
      await p.getByRole('tab', { name: '调用参数', exact: true }).click();
      await snapshot(p, `工具详情-${reducedMotion}`);
      await p.getByRole('button', { name: '在轨迹中查看', exact: true }).click();
      assert((await p.locator('#ledger-fail').getAttribute('aria-selected')) === 'true');
      await p.getByRole('button', { name: '回到对话', exact: true }).click();
      await p.getByRole('textbox', { name: '发送给 Agent', exact: true }).fill('核对已有材料，不补造执行记录。');
      await p.getByRole('button', { name: '发送任务', exact: true }).click();
      assert.equal(await p.locator('.tool-activity').count(), 0, 'free input fabricated tools');
      const spinner = p.locator('.live-run .spin');
      assert.equal(
        await spinner.evaluate((el) => getComputedStyle(el).animationName),
        reducedMotion === 'reduce' ? 'none' : 'spin',
      );
      await snapshot(p, `会话-运行-${reducedMotion}`);
      await p.getByRole('button', { name: '停止当前执行', exact: true }).click();
      await p.waitForTimeout(2500);
      assert(await p.getByText('执行已停止', { exact: true }).isVisible());
      await noRunningAnimation(p);
      await snapshot(p, `会话-停止-${reducedMotion}`);
      await s.close();
      results.push(
        `会话 ${reducedMotion}: exact calls, tool details, trace selection, no fabricated events, stop invalidates completion`,
      );
    }
    const m = await fresh('记忆-比较冲突保存');
    const p = m.p;
    await nav(p, '记忆');
    await p.getByRole('tab', { name: '修订比较', exact: true }).click();
    const first = p.locator('.revision-history button').first();
    await first.click();
    assert(await p.locator('.revision-context').getByText('历史修订 · 只读', { exact: true }).isVisible());
    const original = await p.locator('.revision-workspace .knowledge-current p').innerText();
    await p.getByRole('button', { name: '查看此修订的来源', exact: true }).click();
    assert(await p.getByRole('dialog').getByText('对应版本', { exact: true }).isVisible());
    await snapshot(p, '记忆-历史来源');
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: '切换演示场景', exact: true }).click();
    await p.getByRole('menuitem', { name: '下次编辑发生冲突', exact: true }).click();
    await p.getByRole('button', { name: '编辑当前版本', exact: true }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByLabel('当前内容', { exact: true }).fill('先说明材料覆盖范围，再列变化和未核实项。');
    await dlg.getByLabel('修正理由', { exact: true }).fill('补充阅读顺序');
    assert(await dlg.getByRole('button', { name: '保存新修订', exact: true }).isDisabled());
    await snapshot(p, '记忆-版本冲突');
    await dlg.getByRole('button', { name: '已核对最新修订', exact: true }).click();
    await dlg.getByRole('button', { name: '保存新修订', exact: true }).click();
    assert(await p.getByText('已保存修订 3', { exact: true }).isVisible());
    assert.equal(await p.locator('.revision-history button').count(), 3);
    await p.locator('.revision-history button').first().click();
    assert.equal(await p.locator('.revision-workspace .knowledge-current p').innerText(), original);
    await p.getByRole('tab', { name: '当前认识', exact: true }).click();
    assert.equal(await p.locator('.knowledge-current > p').innerText(), '先说明材料覆盖范围，再列变化和未核实项。');
    await snapshot(p, '记忆-保存新修订');
    await m.close();
    results.push(
      '记忆: historical source, immutable first revision, latest edit base, conflict retains draft, appended revision',
    );
  }
  for (const outcome of ['success', 'failure', 'nochange', 'cancel']) {
    const e = await fresh(`能力改进-${outcome}`, outcome === 'success' ? { width: 390, height: 844 } : {});
    const p = e.p;
    if (outcome === 'failure' || outcome === 'nochange') {
      await p.getByRole('button', { name: '开发演示结果', exact: true }).click();
      await p.getByRole('menuitem', { name: outcome === 'failure' ? '检查失败' : '无需修改', exact: true }).click();
    }
    await nav(p, '改进建议');
    await p.getByRole('button', { name: '开始讨论目标', exact: true }).click();
    assert(await p.getByRole('button', { name: '审阅开发授权', exact: true }).isDisabled());
    await p.getByRole('button', { name: '发送讨论内容', exact: true }).click();
    await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByText('来源建议与讨论摘要', { exact: true }).click();
    assert(await dlg.getByText('讨论摘要', { exact: true }).isVisible());
    const goal = dlg.getByRole('textbox', { name: '授权目标', exact: true });
    const saved = await goal.inputValue();
    await goal.fill('');
    assert(await dlg.getByRole('button', { name: '批准这个目标与范围', exact: true }).isDisabled());
    assert(await dlg.getByRole('alert').isVisible());
    await goal.fill(saved);
    await dlg.getByRole('checkbox').uncheck();
    assert(await dlg.getByRole('alert').isVisible());
    await dlg.getByLabel('允许新建的 Skill', { exact: true }).fill('text-diff');
    assert(await dlg.getByText('已有同名 Skill，请使用不同名称。', { exact: true }).isVisible());
    await dlg.getByLabel('允许新建的 Skill', { exact: true }).fill('');
    await dlg.getByRole('checkbox').check();
    await dlg.locator('.modal-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await snapshot(p, `授权-${outcome}`);
    await dlg.getByRole('button', { name: '批准这个目标与范围', exact: true }).click();
    assert(await p.getByText('Agent 正在开发', { exact: true }).isVisible());
    if (outcome === 'cancel') await p.getByRole('button', { name: '取消开发', exact: true }).click();
    else {
      await p.getByText('正在检查候选', { exact: true }).waitFor();
      await snapshot(p, `能力改进-检查-${outcome}`);
    }
    await p.waitForTimeout(3800);
    const expected = {
      success: '能力变更已正式生效',
      failure: '检查失败，旧版保留',
      nochange: '调查完成，无需修改',
      cancel: '开发已取消',
    }[outcome];
    assert(await p.getByText(expected, { exact: true }).isVisible());
    await noRunningAnimation(p);
    await snapshot(p, `能力改进-结果-${outcome}`);
    await p.getByRole('button', { name: '查看能力与版本', exact: true }).click();
    if (p.viewportSize().width <= 700) await p.locator('.skill-index button').first().click();
    await p.getByRole('tab', { name: '版本与信任', exact: true }).click();
    assert.equal(
      await p
        .locator('.version-list strong')
        .filter({ hasText: /^v2(?:\s|$)/ })
        .count(),
      outcome === 'success' ? 1 : 0,
      'formal version changed unexpectedly',
    );
    await e.close();
    results.push(
      `能力改进 ${outcome}: discussion guard, readable grant, field feedback, formal version, terminal animations`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await fs.writeFile(
    new URL('results.json', dir),
    JSON.stringify({ results, errors, browser: browser.version() }, null, 2),
  );
  await browser.close();
}
console.log(results.join('\n'));
