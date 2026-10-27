import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, launch, context, record, shot, check, save, url, out, config } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../.runtime/scenario.json', import.meta.url), 'utf8'));
const browser = await launch(),
  ctx = await context(browser, 1440);
await ctx.tracing.start({ snapshots: true, screenshots: true, sources: false });
let wire,
  networkDown = false,
  connections = 0;
await ctx.routeWebSocket('**/events', (ws) => {
  connections++;
  wire = ws;
  if (networkDown) {
    void ws.close({ code: 1001, reason: 'network test' });
    return;
  }
  ws.connectToServer();
});
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
record(page, 1440);
const suffix = (p) => new URLSearchParams({ project: p, includeHistory: 'true' });
const create = async (title, scope = 'project') => {
  const r = await api(`/memory?${new URLSearchParams({ project: s.project })}`, 'POST', {
    knowledge: { title: `${s.prefix} ${title}`, content: 'baseline', kind: 'fact', scope },
    reason: '本轮隔离边界测试',
  });
  assert.equal(r.status, 201);
  s.owned.push(r.data.id);
  await fs.writeFile(new URL('../.runtime/boundary-owned.json', import.meta.url), JSON.stringify(s.owned));
  return r.data;
};
const edit = async (m) => {
  await page.goto(url({ page: 'result', target: { kind: 'memory', id: m.id, project: s.project } }));
  await page.getByRole('button', { name: '编辑记忆', exact: true }).click();
  await page.getByLabel('知识内容').waitFor();
};
const until = async (fn) => {
  const start = Date.now();
  while (Date.now() - start < 12000) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error('state timeout');
};
try {
  await check('并发修订真实 409，草稿不覆盖；明确采用最新基础后追加修订', 1440, async () => {
    const m = await create('conflict');
    await edit(m);
    await page.getByLabel('知识内容').fill('本地仍在编辑');
    await page.getByLabel('修改依据').fill('本地合并理由');
    const remote = await api(`/memory/${m.id}/revise?${new URLSearchParams({ project: s.project })}`, 'POST', {
      baseRevision: 1,
      knowledge: { title: m.title, content: '另一会话保存的内容', scope: m.scope, kind: m.kind },
      reason: '并发编辑者写入',
    });
    assert.equal(remote.status, 200);
    await page.getByRole('button', { name: '保存修订', exact: true }).click();
    await page.getByText('记忆已有新的修订', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('知识内容').inputValue(), '本地仍在编辑');
    await page.getByRole('button', { name: '读取最新修订', exact: true }).click();
    await page.getByRole('heading', { name: '最新修订 2', exact: true }).waitFor();
    await shot(page, 'conflict', 1440);
    await page.getByRole('button', { name: '以最新修订继续编辑', exact: true }).click();
    await page.getByRole('button', { name: '保存修订', exact: true }).click();
    await page.getByRole('heading', { name: m.title, exact: true }).waitFor();
    const d = (await api(`/memory/${m.id}?${suffix(s.project)}`)).data;
    assert.equal(d.current.revision, 3);
    assert.equal(d.current.content, '本地仍在编辑');
    return { conflictStatus: 409, revision: 3, remoteRevision: 2 };
  });
  await check('真实 POST 已提交但回复丢失：保持结果未确认，不自动重试', 1440, async () => {
    const m = await create('lost-reply');
    await edit(m);
    await page.getByLabel('知识内容').fill('reply lost after commit');
    await page.getByLabel('修改依据').fill('丢失响应测试');
    let writes = 0;
    await page.route(`**/api/memory/${m.id}/revise?*`, async (route) => {
      writes++;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('connectionreset');
    });
    await page.getByRole('button', { name: '保存修订', exact: true }).click();
    await page.getByText('操作结果尚未确认', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '保存修订', exact: true }).isDisabled(), true);
    assert.equal(writes, 1);
    await shot(page, 'uncertain', 1440);
    await page.unroute(`**/api/memory/${m.id}/revise?*`);
    await page.getByRole('button', { name: '核对权威状态', exact: true }).click();
    await page.getByRole('heading', { name: '最新修订 2', exact: true }).waitFor();
    assert.equal(await page.getByLabel('知识内容').inputValue(), 'reply lost after commit');
    assert.equal(writes, 1);
    await page.getByRole('button', { name: '以最新修订继续编辑', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    assert.equal((await api(`/memory/${m.id}?${suffix(s.project)}`)).data.current.revision, 2);
    return { actualCommit: 2, automaticRetries: 0, uncertainUntilExplicitReview: true };
  });
  await check('已收到提交修订但后续 GET 失败：只核对，不重复写入', 1440, async () => {
    const m = await create('read-failure');
    await edit(m);
    await page.getByLabel('知识内容').fill('acknowledged write');
    await page.getByLabel('修改依据').fill('后续读取失败');
    let writes = 0,
      blockRead = false;
    await page.route('**/api/memory/**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST' && req.url().includes(`${m.id}/revise`)) {
        writes++;
        blockRead = true;
        const response = await route.fetch();
        await route.fulfill({ response });
      } else if (blockRead && req.method() === 'GET' && req.url().includes(m.id)) await route.abort('connectionreset');
      else await route.continue();
    });
    await page.getByRole('button', { name: '保存修订', exact: true }).click();
    await page.getByText('操作结果尚未确认', { exact: true }).waitFor();
    assert.match(await page.locator('.host-reading').innerText(), /已收到修订 2/);
    await page.unroute('**/api/memory/**');
    await page.getByRole('button', { name: '核对权威状态', exact: true }).click();
    await page.getByRole('button', { name: '查看记录', exact: true }).waitFor();
    assert.equal(writes, 1);
    await page.getByRole('button', { name: '查看记录', exact: true }).click();
    await page.getByRole('heading', { name: m.title, exact: true }).waitFor();
    return { acknowledged: 2, authoritativeReadRecovered: true, writes };
  });
  await check('创建提交后断开响应，不凭相似记录推断成功；离开返回保留草稿', 1440, async () => {
    await page.goto(url({ page: 'memory', project: s.project }));
    await page.getByRole('button', { name: '新建记忆', exact: true }).click();
    const title = `${s.prefix} create-lost`;
    await page.getByLabel('记忆标题', { exact: true }).fill(title);
    await page.getByLabel('知识内容').fill('create-lost body');
    await page.getByLabel('修改依据').fill('创建响应丢失');
    let id;
    await page.route('**/api/memory?*', async (route) => {
      if (route.request().method() === 'POST') {
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        id = (await response.json()).id;
        await route.abort('connectionreset');
      } else await route.continue();
    });
    await page.getByRole('button', { name: '保存记忆', exact: true }).click();
    await page.getByText('操作结果尚未确认', { exact: true }).waitFor();
    await page.unroute('**/api/memory?*');
    s.owned.push(id);
    await page.getByRole('button', { name: '核对列表', exact: true }).click();
    await page.locator(`.aw-memory-row[data-focus="${id}:1"]`).waitFor();
    await page.getByRole('button', { name: /继续草稿.*create-lost/ }).click();
    await page.getByText('操作结果尚未确认', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('记忆标题', { exact: true }).inputValue(), title);
    assert.equal(await page.getByRole('button', { name: '保存记忆', exact: true }).isDisabled(), true);
    return { id, UIReportsSuccess: false, automaticRetry: false };
  });
  await check('跨项目真实 404：读写均拒绝；Global 可见、缩小作用域后旧项目不再可见', 1440, async () => {
    const m = await create('scope');
    const wrong = await api(`/memory/${m.id}?${suffix(s.other)}`);
    assert.equal(wrong.status, 404);
    const write = await api(`/memory/${m.id}/revise?${new URLSearchParams({ project: s.other })}`, 'POST', {
      baseRevision: 1,
      reason: '越界测试',
      retire: true,
    });
    assert.equal(write.status, 404);
    await page.goto(url({ page: 'result', target: { kind: 'memory', id: m.id, project: s.other } }));
    await page.getByRole('button', { name: '重新读取', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '编辑记忆', exact: true }).count(), 0);
    await edit(m);
    await page.getByLabel('记忆作用域', { exact: true }).selectOption('global');
    await page.getByLabel('修改依据').fill('提升为全局的隔离测试');
    await page.getByRole('button', { name: '保存修订', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByText(/所有项目读取/)
      .waitFor();
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await page.getByRole('heading', { name: m.title, exact: true }).waitFor();
    const other = (await api(`/memory/${m.id}?${suffix(s.other)}`)).data;
    assert.equal(other.current.scope, 'global');
    assert.equal(other.history.length, 1);
    await page.getByRole('button', { name: '编辑记忆', exact: true }).click();
    await page.getByLabel('记忆作用域', { exact: true }).selectOption('project');
    await page.getByLabel('修改依据').fill('缩小为当前验证项目');
    await page.getByRole('button', { name: '保存修订', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await page.getByRole('heading', { name: m.title, exact: true }).waitFor();
    assert.equal((await api(`/memory/${m.id}?${suffix(s.other)}`)).status, 404);
    return { wrongRead: wrong.status, wrongWrite: write.status, globalVisibleHistory: 1, afterNarrowing: 404 };
  });
  await check('实际 Origin 403 拒绝写入，失败反馈且版本未变化', 1440, async () => {
    const m = await create('forbidden');
    await edit(m);
    await page.getByLabel('修改依据').fill('权限拒绝测试');
    await page.route(`**/api/memory/${m.id}/revise?*`, async (route) => {
      const response = await route.fetch({
        headers: { ...route.request().headers(), origin: 'http://untrusted.invalid' },
      });
      assert.equal(response.status(), 403);
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '保存修订', exact: true }).click();
    await page.getByText('操作未完成', { exact: true }).waitFor();
    assert.equal((await api(`/memory/${m.id}?${suffix(s.project)}`)).data.current.revision, 1);
    await shot(page, 'forbidden', 1440);
    await page.unroute(`**/api/memory/${m.id}/revise?*`);
    return { status: 403, revision: 1 };
  });
  await check('真实 WebSocket 断开、离线编辑保留，认证重连后读取权威状态', 1440, async () => {
    const m = await create('offline');
    await edit(m);
    await page.getByLabel('知识内容').fill('离线草稿');
    await page.getByLabel('修改依据').fill('离线恢复测试');
    const prior = connections;
    networkDown = true;
    wire.close({ code: 1001, reason: 'network interruption' });
    await ctx.setOffline(true);
    await until(() => page.getByRole('button', { name: '保存修订', exact: true }).isDisabled());
    assert.equal(await page.getByLabel('知识内容').inputValue(), '离线草稿');
    await shot(page, 'offline', 1440);
    networkDown = false;
    await ctx.setOffline(false);
    if (await page.getByRole('button', { name: '重新读取', exact: true }).first().isVisible())
      await page.getByRole('button', { name: '重新读取', exact: true }).first().click();
    await until(
      async () =>
        connections > prior && !(await page.getByRole('button', { name: '保存修订', exact: true }).isDisabled()),
    );
    await page.getByRole('button', { name: '保存修订', exact: true }).click();
    await page.getByRole('heading', { name: m.title, exact: true }).waitFor();
    return { connections, revision: (await api(`/memory/${m.id}?${suffix(s.project)}`)).data.current.revision };
  });
  await check('实际无 Bearer 401 卸载受保护界面，重新认证后草稿恢复', 1440, async () => {
    const m = await create('unauthorized');
    await edit(m);
    await page.getByLabel('知识内容').fill('认证中保留的草稿');
    await page.getByLabel('修改依据').fill('401 测试');
    await page.route(`**/api/memory/${m.id}/revise?*`, async (route) => {
      const headers = { ...route.request().headers() };
      delete headers.authorization;
      const response = await route.fetch({ headers });
      assert.equal(response.status(), 401);
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '保存修订', exact: true }).click();
    await page.getByRole('heading', { name: '连接 Agent Host', exact: true }).waitFor();
    assert.equal(await page.locator('.host-reading').count(), 0);
    await page.unroute(`**/api/memory/${m.id}/revise?*`);
    await page.getByLabel('连接令牌', { exact: true }).fill(config.token);
    await page.getByRole('button', { name: '连接', exact: true }).click();
    await page.getByLabel('知识内容').waitFor();
    assert.equal(await page.getByLabel('知识内容').inputValue(), '认证中保留的草稿');
    assert.equal((await api(`/memory/${m.id}?${suffix(s.project)}`)).data.current.revision, 1);
    return { status: 401, draftRetained: true, revision: 1 };
  });
  await check('移除为逻辑删除：保留历史，Host 拒绝后续修订', 1440, async () => {
    const m = await create('delete');
    await page.goto(url({ page: 'result', target: { kind: 'memory', id: m.id, project: s.project } }));
    await page.getByRole('button', { name: '移除记忆', exact: true }).click();
    await page.getByLabel('修改依据').fill('隔离测试：不再保留为可用记忆');
    await page.getByRole('button', { name: '移除记忆', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await page.getByRole('heading', { name: m.title, exact: true }).waitFor();
    assert.match(await page.getByLabel('检索状态').innerText(), /已移除/);
    assert.equal(await page.getByRole('button', { name: '编辑记忆', exact: true }).count(), 0);
    const d = (await api(`/memory/${m.id}?${suffix(s.project)}`)).data;
    assert.equal(d.current.status, 'deleted');
    assert.equal(d.history.length, 2);
    const r = await api(`/memory/${m.id}/revise?${new URLSearchParams({ project: s.project })}`, 'POST', {
      baseRevision: 2,
      reason: '不能恢复',
      knowledge: { title: m.title, content: 'not restored', scope: m.scope, kind: m.kind },
      confirm: true,
    });
    assert.equal(r.status, 410);
    return { status: 'deleted', history: 2, subsequentRevision: r.status };
  });
} finally {
  await ctx.tracing.stop({ path: new URL('boundaries.zip', out).pathname });
  await ctx.close();
  await browser.close();
  await save(process.env.ONLY_CHECK ? 'boundary-retry' : 'boundaries');
}
