import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, launch, context, record, shot, check, save, url, out } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../.runtime/scenario.json', import.meta.url), 'utf8'));
const model = (await api('/sessions')).data.find((x) => x.id === s.first),
  session = (await api('/sessions', 'POST', { cwd: s.project, provider: model.provider, model: model.model })).data;
const browser = await launch(),
  ctx = await context(browser, 1440),
  page = await ctx.newPage();
record(page, 1440);
await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false });
try {
  await check('真实项目决定来源回档追加系统撤销；历史来源可读且不自动复活', 1440, async () => {
    const title = `${s.prefix} branch decision`;
    await page.goto(url({ page: 'session', sessionId: session.id }));
    await page
      .getByLabel('发送给 Agent', { exact: true })
      .fill(
        `隔离验证，请只调用 memory_save 保存一条项目决定。knowledge 为 {"title":"${title}","content":"本隔离项目使用 2 次重试上限。","kind":"decision","scope":"project"}，reason 为“当前验证任务确认的项目约束”。不创建其他记忆，不修改文件。`,
      );
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
    await page.getByRole('button', { name: '停止当前执行', exact: true }).waitFor();
    let native;
    const start = Date.now();
    while (Date.now() - start < 180000) {
      native = (await api(`/sessions/${session.id}`)).data;
      if (!native.busy) break;
      await page.waitForTimeout(1000);
    }
    assert.equal(native.busy, false);
    const list = (await api(`/memory?${new URLSearchParams({ project: s.project, query: title })}`)).data;
    assert.equal(list.items.length, 1);
    const memory = list.items[0];
    assert.equal(memory.kind, 'decision');
    assert.ok(memory.basis.length);
    const flatten = (nodes) => nodes.flatMap((n) => [n.entry, ...flatten(n.children || [])]),
      entries = flatten(native.tree || []);
    const prior = entries.find((e) => e.message?.role === 'user');
    assert.ok(prior);
    const branch = await api(`/sessions/${session.id}/branch`, 'POST', { value: prior.id });
    assert.equal(branch.status, 200);
    const d = (await api(`/memory/${memory.id}?${new URLSearchParams({ project: s.project, includeHistory: 'true' })}`))
      .data;
    assert.equal(d.current.status, 'withdrawn');
    assert.equal(d.current.operation, 'branch');
    assert.equal(d.current.actor, 'system');
    assert.equal(d.current.usable, false);
    assert.equal(d.current.revision, 2);
    await page.goto(url({ page: 'result', target: { kind: 'memory', id: memory.id, project: s.project } }));
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.match(await page.getByLabel('检索状态').innerText(), /已撤销/);
    await shot(page, 'source-withdrawal', 1440);
    await page.getByRole('button', { name: '记忆来源 1', exact: true }).click();
    await page.getByText('历史分支', { exact: true }).waitFor();
    await shot(page, 'historical-source', 1440);
    const after = (
      await api(`/memory/${memory.id}?${new URLSearchParams({ project: s.project, includeHistory: 'true' })}`)
    ).data;
    assert.equal(after.current.revision, 2);
    await fs.writeFile(
      new URL('../.runtime/source-state.json', import.meta.url),
      JSON.stringify({ id: memory.id, session: session.id, entry: memory.sources[0].entryId }),
    );
    return {
      id: memory.id,
      revision: 2,
      status: 'withdrawn',
      operation: 'branch',
      basis: memory.basis,
      sourceView: 'historical branch',
    };
  });
  await check('不存在的原始来源不补造事实，保留实际不可用原因', 1440, async () => {
    await page.goto(
      url({
        page: 'source',
        reference: { sessionId: session.id, entryId: 'nonexistent-memory-qa-entry' },
        project: s.project,
      }),
    );
    await page.getByText('来源暂不可用', { exact: true }).waitFor();
    const r = await api(
      `/diagnostics/evidence?${new URLSearchParams({ sessionId: session.id, entryId: 'nonexistent-memory-qa-entry' })}`,
    );
    assert.equal(r.data.available, false);
    await shot(page, 'missing-source', 1440);
    return r.data;
  });
} finally {
  await ctx.tracing.stop({ path: new URL('source-state.zip', out).pathname });
  await ctx.close();
  await browser.close();
  await save('source-state');
}
