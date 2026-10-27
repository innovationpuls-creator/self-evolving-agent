import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
process.env.D6_CONTROLLED = '1';
const { api, launch, context, record, shot, check, save, url, out } = await import('./common.mjs');
const runtime = new URL('../.runtime/', import.meta.url);
const command = async (action) => {
  const id = crypto.randomUUID();
  await fs.writeFile(new URL('control.json', runtime), JSON.stringify({ id, action }), { mode: 0o600 });
  return id;
};
const wait = async (fn) => {
  const end = Date.now() + 20000;
  while (true) {
    const r = await fn();
    if (r) return r;
    assert.ok(Date.now() < end, 'lifecycle control deadline');
    await new Promise((r) => setTimeout(r, 100));
  }
};
const b = await launch();
for (const width of [1440, 850, 390]) {
  const ctx = await context(b, width, width === 1440),
    p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  record(p, width);
  await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false });
  await check('等待环境→重新检查→真实运行→同一Job详情自动出现结论', width, async () => {
    const id = await command('wait');
    const s = await wait(async () => {
      const m = JSON.parse(await fs.readFile(new URL('controlled.json', runtime), 'utf8'));
      return m.command === id ? m : false;
    });
    await p.goto(url({ page: 'reflection', jobId: s.waiting, originSession: s.waitingSource }));
    await p.getByRole('button', { name: '检查环境并恢复等待任务', exact: true }).waitFor();
    assert.equal(await p.getByRole('heading', { name: '已保存的变化', exact: true }).count(), 0);
    await shot(p, 'waiting', width);
    const jobsBefore = (await api('/reflections?view=status')).data.total;
    await command('restore');
    await new Promise((r) => setTimeout(r, 180));
    await p.getByRole('button', { name: '检查环境并恢复等待任务', exact: true }).click();
    await p.getByText('正在检查，尚未保存结论。', { exact: true }).waitFor();
    const before = (await api(`/reflections/jobs/${s.waiting}`)).data.job;
    assert.equal(before.status, 'running');
    await shot(p, 'running', width);
    await command('continue');
    await p.getByText('环境恢复后已完成检查，本次没有新增发现。', { exact: true }).waitFor();
    assert.equal(JSON.parse(new URL(p.url()).searchParams.get('r')).jobId, s.waiting);
    const after = (await api(`/reflections/${s.waiting}`)).data;
    assert.equal(after.job.status, 'succeeded');
    assert.deepEqual(after.record.changes, []);
    const jobsAfter = (await api('/reflections?view=status')).data.total;
    assert.equal(jobsAfter, jobsBefore, 'recheck must not create Reflection Jobs');
    assert.equal(await p.getByRole('heading', { name: '已保存的变化', exact: true }).count(), 0);
    assert.equal(await p.locator('.host-reflection-references[open]').count(), 0);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await shot(p, 'recovered', width);
    return {
      mode: 'controlled actual Host availability and scheduling',
      before: before.status,
      after: after.job.status,
      sameJob: true,
      jobsBefore,
      jobsAfter,
      checksDoNotCreateJobs: true,
    };
  });
  await ctx.tracing.stop({ path: new URL(`lifecycle-${width}.zip`, out).pathname });
  const v = p.video();
  await ctx.close();
  if (v) await v.saveAs(new URL(`videos/lifecycle-${width}.webm`, out).pathname);
}
await b.close();
await save('lifecycle');
