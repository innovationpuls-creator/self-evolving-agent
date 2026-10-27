import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, launch, context, record, shot, check, save, url, out } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../.runtime/real.json', import.meta.url), 'utf8'));
const browser = await launch();
const recording = process.argv.includes('--record');
for (const width of recording ? [1440] : [1440, 850, 390]) {
  const ctx = await context(browser, width, width === 1440),
    page = await ctx.newPage();
  record(page, width);
  const pause = async () => {
    if (recording) await page.waitForTimeout(2800);
  };
  await ctx.tracing.start({ snapshots: true, screenshots: true, sources: false });
  await check('真实模型：会话→无变化反思→实际来源→原始Entry→原会话草稿', width, async () => {
    await page.goto(url({ page: 'session', sessionId: s.source }));
    const composer = page.getByLabel('发送给 Agent', { exact: true });
    await composer.waitFor();
    await composer.fill(`继续阅读草稿 ${width}`);
    await pause();
    await page.locator('[data-focus="session-reflections"]').click();
    await page.locator(`[data-job="${s.job}"]`).waitFor();
    assert.equal(await page.locator('.host-check-summary').innerText(), '本次没有新增发现。');
    await shot(page, 'real-list', width);
    await pause();
    await page.locator(`[data-job="${s.job}"]`).click();
    await page.getByText('本次没有新增发现。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '已保存的变化', exact: true }).count(), 0);
    await shot(page, 'real-detail', width);
    await pause();
    await page.locator('.host-reflection-references > summary').click();
    await page.locator('[data-focus="evidence-0"]').click();
    await page.getByRole('heading', { name: '依据与来源', exact: true }).waitFor();
    await page.getByText('完整原始证据', { exact: true }).click();
    await shot(page, 'real-source', width);
    await pause();
    const ref = JSON.parse(new URL(page.url()).searchParams.get('r')).reference;
    const original = await api(
      `/diagnostics/evidence?${new URLSearchParams({ sessionId: ref.sessionId, entryId: ref.entryId, limit: '32768' })}`,
    );
    assert.equal(original.data.available, true);
    await page.getByRole('button', { name: '在来源会话中定位', exact: true }).click();
    await page.locator('.host-located-message').waitFor();
    await pause();
    assert.equal(JSON.parse(new URL(page.url()).searchParams.get('r')).entryId, ref.entryId);
    assert.equal(await composer.inputValue(), `继续阅读草稿 ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    return { mode: 'real configured model / signed native Worker', changes: 0, source: ref, draftRetained: true };
  });
  await ctx.tracing.stop({ path: new URL(`real-${width}.zip`, out).pathname });
  const v = page.video();
  await ctx.close();
  if (v) await v.saveAs(new URL(`videos/real-chain-${width}.webm`, out).pathname);
}
await browser.close();
await save(recording ? 'real-recording' : 'real-browser');
