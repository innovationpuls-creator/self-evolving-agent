import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const checks = [];
try {
  for (const mode of ['quiet', 'studio']) {
    for (const outcome of ['失败', '无代码', '取消']) {
      const p = await b.newPage();
      await p.goto(`http://127.0.0.1:4176/?route=${mode}`);
      await p.getByRole('button', { name: '能力建议与开发', exact: true }).click();
      assert.equal(await p.getByRole('button', { name: '批准此目标并开始开发' }).count(), 0);
      await p.getByRole('button', { name: '采纳并建立讨论' }).click();
      await p.getByRole('button', { name: '确认目标与开发范围' }).click();
      await p.getByLabel('授权目标').fill('');
      assert(await p.getByRole('button', { name: '批准此目标并开始开发' }).isDisabled());
      await p.getByLabel('授权目标').fill('完善报告指引');
      if (outcome !== '取消') await p.getByLabel('演示分支').selectOption(outcome);
      await p.getByRole('button', { name: '批准此目标并开始开发' }).click();
      if (outcome === '取消') await p.getByRole('button', { name: '取消开发' }).click();
      await p.waitForTimeout(2400);
      await p.getByText('当前正式版本 v1。历史活动保留，未完成请求不会自动重放。').waitFor();
      checks.push(`${mode}: ${outcome} preserves v1; empty goal cannot grant`);
      await p.close();
    }
    const p = await b.newPage();
    await p.goto(`http://127.0.0.1:4176/?route=${mode}`);
    await p.getByRole('button', { name: '模型', exact: true }).click();
    await p.getByRole('button', { name: '模拟设备登录' }).click();
    await p.getByRole('button', { name: '取消登录' }).click();
    await p.getByText('Host 保存副本：存在 · 用户取消登录').waitFor();
    await p.getByRole('button', { name: '退出 Host' }).click();
    await p.getByRole('button', { name: '模拟环境授权仍可用' }).click();
    await p.getByText('Host 保存副本：无 · 环境授权可用').waitFor();
    checks.push(`${mode}: model cancel, logout, environment branch`);
    await p.close();
  }
} finally {
  await b.close();
  await writeFile(new URL('../evidence/failures.json', import.meta.url), JSON.stringify({ checks }, null, 2));
}
