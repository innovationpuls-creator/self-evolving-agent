import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
process.env.D6_CONTROLLED = '1';
const { api, launch, context, record, shot, check, save, url, out, requests } = await import('./common.mjs');
const s = JSON.parse(await fs.readFile(new URL('../.runtime/controlled.json', import.meta.url), 'utf8'));
const browser = await launch();
const recording = process.argv.includes('--record');
for (const width of recording ? [1440] : [1440, 850, 390]) {
  const ctx = await context(browser, width, width === 1440),
    page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  record(page, width);
  const pause = async () => {
    if (recording) await page.waitForTimeout(2300);
  };
  await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false });
  await check('Host 权威分页125条，同一Session多次检查，跨页返回和焦点', width, async () => {
    await page.goto(url({ page: 'reflections', sessionId: s.source, offset: 0 }));
    await page.locator('[data-job]').first().waitFor();
    const ids = new Set();
    for (let offset = 0; offset < 125; offset += 20) {
      await page.waitForFunction((n) => JSON.parse(new URL(location.href).searchParams.get('r')).offset === n, offset);
      await page.getByRole('button', { name: '刷新', exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.host-reading [role="status"]'));
      const authoritative = (await api(`/reflections?view=summary&sessionId=${s.source}&limit=20&offset=${offset}`))
        .data;
      await page.locator(`[data-job="${authoritative.jobs[0].id}"]`).waitFor();
      const actual = await page.locator('[data-job]').evaluateAll((els) => els.map((e) => e.dataset.job));
      assert.deepEqual(
        actual,
        authoritative.jobs.map((j) => j.id),
      );
      for (const id of actual) ids.add(id);
      if (offset === 0) await shot(page, 'controlled-list', width);
      if (offset < 120) await page.getByRole('button', { name: '下一页', exact: true }).click();
    }
    assert.equal(ids.size, 125);
    assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
    await shot(page, 'page7', width);
    await pause();
    const target = page.locator('[data-job]').last(),
      id = await target.getAttribute('data-job');
    await target.click();
    await page.locator('.host-reflection-references').waitFor();
    await page.getByRole('button', { name: '反思记录', exact: true }).last().click();
    await page.locator(`[data-job="${id}"]`).waitFor();
    assert.equal(JSON.parse(new URL(page.url()).searchParams.get('r')).offset, 120);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-job')), id);
    assert.ok(
      !requests.some(
        (r) => r.width === width && /\/api\/reflections\/[a-f0-9-]{36}$/.test(r.path) && r.response?.record?.id !== id,
      ),
    );
    return { mode: s.mode, total: 125, unique: ids.size, offset: 120, focus: id };
  });
  await check('后台成果→精确Memory修订差异→只读Worker来源→返回记录', width, async () => {
    await page.goto(url({ page: 'reflection', jobId: s.effect, recordId: s.effect, originSession: s.source }));
    await page.locator('[data-focus="change-1"]').waitFor();
    await shot(page, 'controlled-detail', width);
    await pause();
    await page.locator('[data-focus="change-1"]').click();
    await page.getByRole('heading', { name: '受控反思成果 effect', exact: true }).waitFor();
    assert.equal(JSON.parse(new URL(page.url()).searchParams.get('r')).target.revision, 2);
    assert.match(await page.locator('.host-reading').innerText(), /经过证据核对后的第二次正文/);
    assert.equal(await page.getByRole('button', { name: /修订历史/ }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('heading', { name: '实际变化', exact: true }).waitFor();
    assert.match(await page.locator('.diff-lines .removed').innerText(), /最初正文/);
    assert.match(await page.locator('.diff-lines .added').innerText(), /第二次正文/);
    await shot(page, 'controlled-diff', width);
    await pause();
    await page.getByRole('button', { name: '记忆来源 2', exact: true }).click();
    await page.getByRole('heading', { name: '依据与来源', exact: true }).waitFor();
    await page.getByText('来源不在当前会话目录中，可在此阅读保存的执行历史。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '在来源会话中定位', exact: true }).count(), 0);
    await page.getByText('完整原始证据', { exact: true }).click();
    await page.locator('.host-raw-evidence[open]').waitFor();
    await shot(page, 'controlled-source', width);
    await pause();
    await page.getByRole('button', { name: '返回上一页', exact: true }).click();
    await page.getByRole('heading', { name: '受控反思成果 effect', exact: true }).waitFor();
    await page.getByRole('button', { name: '返回上一页', exact: true }).click();
    await page.locator('[data-focus="change-1"]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-focus')), 'change-1');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    return { mode: 'controlled actual Host commits', revision: 2, readonlySource: true, returnedToReflection: true };
  });
  await check('失败与中断后仍展示部分已提交成果；不把空结论作为无成果', width, async () => {
    for (const id of [s.failed, s.interrupted]) {
      await page.goto(url({ page: 'reflection', jobId: id, recordId: id, originSession: s.source }));
      await page.getByRole('heading', { name: '已保存的变化', exact: true }).waitFor();
      assert.match(await page.locator('.host-reading').innerText(), /下列变化已保存/);
      assert.equal(await page.locator('[data-focus="change-0"]').count(), 1);
    }
    await shot(page, 'partial-interrupted', width);
    await pause();
    return { failed: s.failed, interrupted: s.interrupted, committedLinkRetained: true };
  });
  await check('空Session筛选与来源缺失保留真实失败，不替换内容', width, async () => {
    await page.goto(url({ page: 'reflections', sessionId: s.foreign, offset: 0 }));
    await page.getByRole('heading', { name: '还没有反思记录', exact: true }).waitFor();
    await page.goto(
      url({
        page: 'source',
        reference: { sessionId: s.source, entryId: 'entry-that-does-not-exist' },
        project: s.project,
        originSession: s.source,
      }),
    );
    await page.getByText('来源暂不可用', { exact: true }).waitFor();
    assert.match(await page.locator('.host-reading').innerText(), /entry_missing_from_checkpoint/);
    await shot(page, 'missing-source', width);
    return { empty: true, missing: 'entry_missing_from_checkpoint' };
  });
  await ctx.tracing.stop({ path: new URL(`controlled-${width}.zip`, out).pathname });
  const v = page.video();
  await ctx.close();
  if (v) await v.saveAs(new URL(`videos/controlled-chain-${width}.webm`, out).pathname);
}
await browser.close();
await save(recording ? 'controlled-recording' : 'controlled-browser');
