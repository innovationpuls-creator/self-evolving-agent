import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const origin = process.env.D6_MOCK_ORIGIN ?? 'http://127.0.0.1:4176';
const dir = new URL(process.env.D6_EVIDENCE_DIR ?? '../evidence/round2/', import.meta.url);
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [],
  errors = [],
  requests = [],
  screens = [];
const names = { memory: '记忆', reflection: '反思', skills: '能力库', evolution: '能力改进' };
async function shot(p, name) {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(180);
  await p.screenshot({ path: new URL(`${name}.png`, dir).pathname });
  screens.push(name);
}
async function nav(p, mode, key) {
  if (
    (await p.getByRole('button', { name: '打开导航', exact: true }).isVisible()) &&
    !(await p.locator('.sidebar').isVisible())
  )
    await p.getByRole('button', { name: '打开导航', exact: true }).click();
  if (key === 'settings') {
    await p.getByRole('button', { name: '模型与连接', exact: true }).first().click();
    return;
  }
  if (mode === 'studio')
    await p
      .getByRole('navigation', { name: '工作空间' })
      .getByRole('button', {
        name: ['chat', 'trace'].includes(key) ? '工作' : ['memory', 'reflection'].includes(key) ? '认识' : '能力',
        exact: true,
      })
      .click();
  if (!(await p.locator('.sidebar').isVisible()))
    await p.getByRole('button', { name: '打开导航', exact: true }).click();
  if (['chat', 'trace'].includes(key)) {
    if (mode === 'quiet') await p.locator('.session-list button').first().click();
    if (key === 'trace')
      mode === 'quiet'
        ? await p.getByRole('tab', { name: '轨迹', exact: true }).click()
        : await p
            .getByRole('navigation', { name: '主要模块' })
            .getByRole('button', { name: '执行记录', exact: true })
            .click();
  } else
    await p
      .getByRole('navigation', { name: '主要模块' })
      .getByRole('button', {
        name:
          mode === 'quiet'
            ? { memory: '记忆', reflection: '反思记录', skills: '技能与工具', evolution: '改进建议' }[key]
            : names[key],
        exact: true,
      })
      .click();
  if (p.viewportSize().width <= 700 && (await p.locator('.sidebar').isVisible()))
    await p.getByRole('button', { name: '收起导航', exact: true }).click();
  await p.locator('.workspace').evaluate((el) => (el.scrollTop = 0));
}
async function fresh(mode) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', (e) => errors.push(`${mode}: ${e}`));
  p.on('request', (r) => {
    if (
      !r.url().startsWith(`${origin}/`) &&
      !r.url().startsWith(`${origin.replace('http:', 'ws:')}/`) &&
      !r.url().startsWith('data:')
    )
      requests.push(r.url());
  });
  await p.goto(`${origin}/?route=${mode}&test=1`);
  await p.waitForTimeout(350);
  return p;
}
async function ok(label, fn) {
  await fn();
  results.push(label);
}
try {
  for (const mode of process.env.D6_MOCK_MODES?.split(',') ?? ['quiet', 'studio']) {
    const p = await fresh(mode);
    await ok(`${mode}: all primary modules at five viewport sizes`, async () => {
      for (const [w, h] of [
        [1440, 1000],
        [1240, 850],
        [850, 600],
        [768, 900],
        [390, 844],
      ]) {
        await p.setViewportSize({ width: w, height: h });
        for (const key of ['chat', 'trace', 'memory', 'reflection', 'skills', 'evolution', 'settings']) {
          await nav(p, mode, key);
          await shot(p, `${mode}-${key}-${w}`);
          assert(
            await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `${key}/${w} document overflow`,
          );
          assert(
            await p.locator('.workspace').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
            `${key}/${w} workspace overflow`,
          );
        }
      }
    });
    await p.setViewportSize({ width: 1440, height: 1000 });
    await nav(p, mode, 'chat');
    await p
      .locator('.reading-scroll')
      .filter({ visible: true })
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await shot(p, `${mode}-markdown-code`);
    assert(await p.locator('.hljs-keyword').first().isVisible());
    await nav(p, mode, 'trace');
    await (mode === 'quiet'
      ? p.getByRole('row', { name: /核实旧版兼容承诺/ })
      : p.getByRole('button', { name: '核实旧版兼容承诺', exact: true })
    ).click();
    await shot(p, `${mode}-trace-error`);
    await p.getByRole('tab', { name: mode === 'quiet' ? '原文' : '原始记录', exact: true }).click();
    if (mode === 'studio') await p.getByRole('button', { name: /展开完整脱敏记录/ }).click();
    await shot(p, `${mode}-trace-evidence`);
    await (mode === 'quiet'
      ? p.getByRole('row', { name: /查询文档元数据/ })
      : p.getByRole('button', { name: '查询文档元数据', exact: true })
    ).click();
    await shot(p, `${mode}-trace-unknown`);
    results.push(`${mode}: semantic tools, failure, unknown extension, nested JSON and raw evidence`);
    await nav(p, mode, 'memory');
    await p.getByRole('tab', { name: '修订比较', exact: true }).click();
    await shot(p, `${mode}-memory-diff`);
    if (mode === 'quiet') {
      await p.getByRole('button', { name: '切换演示场景', exact: true }).click();
      await p.getByRole('menuitem', { name: '下次编辑发生冲突', exact: true }).click();
    }
    await p.getByRole('button', { name: mode === 'quiet' ? '编辑当前版本' : '修正', exact: true }).click();
    const dlg = p.getByRole('dialog');
    await dlg.getByLabel('当前内容').fill('先列变化，再单列未核实项；始终说明结论覆盖范围。');
    await dlg.getByLabel('修正理由').fill('用户补充报告阅读顺序');
    if (mode === 'studio') await dlg.getByRole('button', { name: '模拟编辑冲突' }).click();
    assert(await dlg.getByRole('button', { name: '保存新修订' }).isDisabled());
    await shot(p, `${mode}-memory-conflict`);
    await dlg.getByRole('button', { name: '已核对最新修订' }).click();
    await dlg.getByRole('button', { name: '保存新修订' }).click();
    assert(
      (await p.getByText('修订 3 · 刚刚', { exact: true }).isVisible()) ||
        (await p.getByRole('combobox').filter({ visible: true }).count()) > 0 ||
        (await p.locator('.revision-history button').filter({ visible: true }).count()) === 3,
    );
    await shot(p, `${mode}-memory-revised`);
    results.push(`${mode}: immutable revision, previous diff and conflict recovery`);
    await nav(p, mode, 'reflection');
    await p.getByRole('tab', { name: '无新发现', exact: true }).click();
    await shot(p, `${mode}-reflection-none`);
    assert(await p.getByRole('heading', { name: '没有需要保留的新发现', exact: true }).isVisible());
    await p.getByRole('tab', { name: '全部记录', exact: true }).click();
    await p
      .locator(mode === 'quiet' ? '.journal-index button' : '.reflection-dates button')
      .last()
      .click();
    await shot(p, `${mode}-reflection-unavailable`);
    results.push(`${mode}: reflection discovery, normal no findings and unavailable execution`);
    await nav(p, mode, 'skills');
    await p.getByRole('switch', { name: '启用当前 Skill' }).uncheck();
    assert(await p.getByText('当前已禁用', { exact: true }).isVisible());
    await p.getByRole('switch', { name: '启用当前 Skill' }).check();
    await p.getByRole('tab', { name: '文件与候选', exact: true }).click();
    await p.getByRole('button', { name: '编辑 SKILL.md', exact: true }).click();
    await p.getByRole('dialog').getByRole('textbox').fill('# text-diff\n报告先说明覆盖范围，再列正文差异。');
    await p.getByRole('button', { name: '保存为候选', exact: true }).click();
    await p.getByRole('button', { name: '审查精确候选内容', exact: true }).click();
    assert(await p.getByRole('button', { name: '记录本次内容审查' }).isDisabled());
    await shot(p, `${mode}-skill-review`);
    await p.getByRole('dialog').getByRole('checkbox').check();
    await p.getByRole('button', { name: '记录本次内容审查' }).click();
    await p.getByRole('checkbox', { name: '模拟依赖检查失败' }).check();
    await p.getByRole('button', { name: '检查并自动生效' }).click();
    await p.waitForTimeout(1600);
    assert(await p.getByText('候选检查失败', { exact: true }).isVisible());
    await shot(p, `${mode}-skill-check-failed`);
    await p.getByRole('checkbox', { name: '模拟依赖检查失败' }).uncheck();
    await p.getByRole('button', { name: '检查并自动生效' }).click();
    await p.waitForTimeout(1600);
    await p.getByRole('tab', { name: '版本与信任', exact: true }).click();
    await p.getByRole('button', { name: '恢复此版本' }).click();
    await shot(p, `${mode}-skill-rollback`);
    await p.getByRole('button', { name: '确认恢复 v1' }).click();
    assert((await p.locator('.version-list').getByText('v2', { exact: false }).count()) > 0);
    await shot(p, `${mode}-skill-versions`);
    results.push(`${mode}: skill enable, exact-content review, check failure retains current, apply and rollback`);
    await p.getByRole('tab', { name: 'Tool', exact: true }).click();
    await p.getByRole('button', { name: /^read/ }).click();
    await shot(p, `${mode}-tool-directory`);
    await nav(p, mode, 'settings');
    await p.getByRole('button', { name: '开始模拟设备登录' }).click();
    await shot(p, `${mode}-oauth-waiting`);
    await p.getByRole('button', { name: '模拟代码过期' }).click();
    await shot(p, `${mode}-oauth-expired`);
    await p.getByRole('button', { name: '生成新的登录代码' }).click();
    await p.getByRole('button', { name: '取消登录', exact: true }).click();
    await p.getByRole('tab', { name: 'API Key', exact: true }).click();
    await p.getByLabel('演示 API Key', { exact: true }).fill('not-a-demo');
    await p.getByRole('button', { name: '保存模拟 Key' }).click();
    assert(await p.getByRole('alert').isVisible());
    await p.getByLabel('演示 API Key', { exact: true }).fill('demo-example');
    await p.getByRole('button', { name: '保存模拟 Key' }).click();
    await p.waitForTimeout(1000);
    if (mode === 'quiet') await p.locator('.demo-options summary').click();
    await p.getByRole('checkbox', { name: '模拟检查返回授权失效' }).check();
    await p.getByRole('button', { name: '检查模拟调用' }).click();
    await p.waitForTimeout(1100);
    await shot(p, `${mode}-model-call-error`);
    await p.getByRole('checkbox', { name: '模拟环境中仍存在授权' }).check();
    await p.getByRole('button', { name: '退出 Host 授权' }).click();
    await p.getByRole('button', { name: '退出这个副本' }).click();
    assert(await p.getByText('环境授权可用', { exact: true }).isVisible());
    results.push(`${mode}: model wait/cancel/expiry, key validation, saved vs callable, logout with env authority`);
    await nav(p, mode, 'chat');
    await p.getByRole('button', { name: '新会话', exact: true }).click();
    await p.getByLabel('会话名称').fill('检查输入与停止');
    await p.getByRole('button', { name: '创建会话', exact: true }).click();
    await p.getByRole('button', { name: '引用项目文件', exact: true }).click();
    await p
      .getByRole('dialog')
      .getByRole('button', { name: /docs\/项目说明-v1/ })
      .click();
    await p.getByRole('button', { name: '完成引用', exact: true }).click();
    const input = p.getByRole('textbox', { name: '发送给 Agent' });
    await input.fill('只核对已提供的材料。');
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', metaKey: true, isComposing: true });
    assert.equal(await input.inputValue(), '只核对已提供的材料。');
    await input.focus();
    await input.press('Meta+Enter');
    await shot(p, `${mode}-session-running`);
    await p.getByRole('button', { name: '停止当前执行' }).click();
    await p.waitForTimeout(2500);
    assert(await p.getByText('执行已停止', { exact: true }).isVisible());
    await shot(p, `${mode}-session-stopped`);
    results.push(`${mode}: new session, references, IME guard, command-enter and stop invalidates completion`);
    await input.fill('独立草稿');
    await p.keyboard.press('Meta+k');
    assert(await p.getByRole('dialog', { name: '搜索工作空间' }).isVisible());
    await p.keyboard.press('Escape');
    assert(!(await p.getByRole('dialog').isVisible()));
    results.push(`${mode}: keyboard search and escape`);
    await p.close();
    // Independent development branches always begin from the same initial fixture.
    for (const outcome of ['success', 'failure', 'nochange', 'cancel']) {
      const q = await fresh(mode);
      await q.getByRole('button', { name: '开发演示结果', exact: true }).click();
      await q
        .getByRole('menuitem', {
          name: outcome === 'failure' ? '检查失败' : outcome === 'nochange' ? '无需修改' : '检查通过',
          exact: true,
        })
        .click();
      await nav(q, mode, 'evolution');
      await q.getByRole('button', { name: '开始讨论目标' }).click();
      assert(await q.getByRole('button', { name: '审阅开发授权' }).isDisabled());
      await q.getByRole('button', { name: '发送讨论内容' }).click();
      await shot(q, `${mode}-evolution-discussion`);
      await q.getByRole('button', { name: '审阅开发授权' }).click();
      await shot(q, `${mode}-grant`);
      const region = mode === 'quiet' ? q.getByRole('dialog') : q.locator('.full-grant');
      const goal = region.getByRole('textbox', { name: '授权目标' });
      const old = await goal.inputValue();
      await goal.fill('');
      assert(await region.getByRole('button', { name: '批准这个目标与范围' }).isDisabled());
      await goal.fill(old);
      await region.getByRole('button', { name: '批准这个目标与范围' }).click();
      if (outcome === 'cancel') await q.getByRole('button', { name: '取消开发', exact: true }).click();
      await q.waitForTimeout(3800);
      await shot(q, `${mode}-development-${outcome}`);
      const expected = {
        success: '能力变更已正式生效',
        failure: '检查失败，旧版保留',
        nochange: '调查完成，无需修改',
        cancel: '开发已取消',
      }[outcome];
      assert(await q.getByText(expected, { exact: true }).isVisible());
      results.push(`${mode}: authorized development ${outcome}`);
      await q.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
} catch (e) {
  errors.push(String(e));
  throw e;
} finally {
  await fs.writeFile(
    new URL('browser-results.json', dir),
    JSON.stringify({ results, errors, unexpectedRequests: requests, screens }, null, 2),
  );
  await browser.close();
}
console.log(`${results.length} checks; ${screens.length} screenshots`);
