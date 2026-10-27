import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, launch, context, record, shot, check, save, url } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../.runtime/memory-scenario.json', import.meta.url), 'utf8')),
  real = JSON.parse(await fs.readFile(new URL('../.runtime/real.json', import.meta.url), 'utf8')),
  model = (await api(`/sessions/${process.env.D6_REFERENCE ? real.source : s.first}`)).data;
const browser = await launch();
for (const width of [1440, 850, 390]) {
  const session = (await api('/sessions', 'POST', { cwd: s.project, provider: model.provider, model: model.model }))
      .data,
    ctx = await context(browser, width),
    page = await ctx.newPage();
  record(page, width);
  const frames = [];
  page.on('websocket', (ws) =>
    ws.on('framereceived', ({ payload }) => {
      try {
        const e = JSON.parse(payload);
        frames.push({ type: e.type, event: e.event?.type, stateVersion: e.stateVersion });
      } catch {}
    }),
  );
  await check('原会话空间真实发送、可见流式文本与停止', width, async () => {
    await page.goto(url({ page: 'session', sessionId: session.id }));
    await page
      .getByLabel('发送给 Agent', { exact: true })
      .fill(
        '隔离会话回归：请直接输出一篇较长的中文介绍，主题是植物生长，需要至少 3000 字。不要调用工具，不要读写 Memory 或文件。',
      );
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
    await page.locator('.host-stream').waitFor({ timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('.host-stream')?.textContent.trim().length > 20, {
      timeout: 120000,
    });
    const partial = await page.locator('.host-stream').innerText();
    await shot(page, 'session-stream', width);
    await page.getByRole('button', { name: '停止当前执行', exact: true }).click();
    await page.getByRole('button', { name: '发送任务', exact: true }).waitFor({ timeout: 30000 });
    const d = (await api(`/sessions/${session.id}`)).data;
    assert.equal(d.busy, false);
    assert.ok(d.messages.some((m) => m.stopReason === 'aborted'));
    assert.ok(frames.some((e) => e.event === 'message_update'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    return {
      session: session.id,
      partialLength: partial.length,
      busy: false,
      outcome: 'aborted',
      messageUpdates: frames.filter((e) => e.event === 'message_update').length,
    };
  });
  await ctx.close();
}
await browser.close();
await save('session-regression');
