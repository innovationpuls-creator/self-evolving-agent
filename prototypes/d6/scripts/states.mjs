import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const origin = process.env.D6_MOCK_ORIGIN ?? 'http://127.0.0.1:4176';
import assert from 'node:assert/strict';
const dir = new URL(process.env.D6_EVIDENCE_DIR ?? '../evidence/round2/', import.meta.url);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const results = [];
const errors = [];
for (const mode of process.env.D6_MOCK_MODES?.split(',') ?? ['quiet', 'studio']) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${origin}/?route=${mode}&test=1`);
  await p.waitForTimeout(350);
  for (const key of ['chat', 'trace', 'memory', 'reflection', 'skills', 'evolution', 'settings']) {
    if (key === 'settings') await p.getByRole('button', { name: '模型与连接', exact: true }).first().click();
    else if (['chat', 'trace'].includes(key)) {
      if (key === 'trace')
        mode === 'quiet'
          ? await p.getByRole('tab', { name: '轨迹', exact: true }).click()
          : await p
              .getByRole('navigation', { name: '主要模块' })
              .getByRole('button', { name: '执行记录', exact: true })
              .click();
    } else {
      if (mode === 'studio')
        await p
          .getByRole('navigation', { name: '工作空间' })
          .getByRole('button', { name: ['memory', 'reflection'].includes(key) ? '认识' : '能力', exact: true })
          .click();
      await p
        .getByRole('navigation', { name: '主要模块' })
        .getByRole('button', {
          name: (mode === 'quiet'
            ? { memory: '记忆', reflection: '反思记录', skills: '技能与工具', evolution: '改进建议' }
            : { memory: '记忆', reflection: '反思', skills: '能力库', evolution: '能力改进' })[key],
          exact: true,
        })
        .click();
    }
    for (const [state, label] of [
      ['loading', '加载'],
      ['empty', '空内容'],
      ['error', '读取失败'],
      ['long', '长内容'],
    ]) {
      await p.getByRole('button', { name: '切换演示场景', exact: true }).click();
      await p.getByRole('menuitem', { name: label, exact: true }).click();
      await p.waitForTimeout(70);
      await p.screenshot({ path: new URL(`${mode}-${key}-${state}.png`, dir).pathname });
      assert(await p.locator('.workspace').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
    }
    await p.getByRole('button', { name: '切换演示场景', exact: true }).click();
    await p.getByRole('menuitem', { name: '日常状态', exact: true }).click();
    results.push(`${mode}/${key}: empty, loading, read failure, long fixture`);
  }
  // Dialog focus management uses the actual keyboard, including an Escape return.
  await p.getByRole('button', { name: '模型与连接', exact: true }).first().click();
  await p.getByRole('button', { name: '退出 Host 授权', exact: true }).click();
  assert(await p.getByRole('dialog').isVisible());
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press('Tab');
    assert(await p.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]'))));
  }
  await p.keyboard.press('Escape');
  await p.waitForTimeout(220);
  assert(
    await p
      .getByRole('button', { name: '退出 Host 授权', exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  results.push(`${mode}: modal Tab containment and Escape focus return`);
  await p.getByRole('button', { name: '切换演示场景' }).click();
  await p.getByRole('menuitem', { name: '连接中断', exact: true }).click();
  await p.screenshot({ path: new URL(`${mode}-offline.png`, dir).pathname });
  await p.getByRole('button', { name: '重新连接', exact: true }).click();
  assert(!(await p.locator('.connection-banner').isVisible()));
  results.push(`${mode}: connection loss and reconnect`);
  await p.close();
}
assert.deepEqual(errors, []);
await fs.writeFile(new URL('states-results.json', dir), JSON.stringify({ results, errors }, null, 2));
await browser.close();
console.log(`${results.length} state/focus groups`);
