import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, launch, context, record, shot, check, save, url, out } from './common.mjs';
const s = JSON.parse(await fs.readFile(new URL('../.runtime/scenario.json', import.meta.url), 'utf8'));
const browser = await launch();
async function waitSession(id) {
  const start = Date.now();
  while (Date.now() - start < 180000) {
    const { data } = await api(`/sessions/${id}`);
    if (!data.busy) return data;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('native Session timeout');
}
const poll = async (fn) => {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error('state timeout');
};
for (const width of process.argv.includes('--record') ? [1440] : [1440, 850, 390]) {
  const ctx = await context(browser, width, width === 1440);
  await ctx.tracing.start({ snapshots: true, screenshots: true, sources: false });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  record(page, width);
  const pause = () => page.waitForTimeout(width === 1440 ? 1200 : 50);
  const navigate = async (name) => {
    if (!(await page.locator('.sidebar').isVisible()))
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page.getByRole('navigation', { name: '主要模块' }).getByRole('button', { name, exact: true }).click();
  };
  const session = async (id) => {
    if (!(await page.locator('.sidebar').isVisible()))
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page.locator(`.session-list > button[data-session="${id}"]`).click();
    await poll(async () => JSON.parse(new URL(page.url()).searchParams.get('r')).sessionId === id);
    await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
  };
  const title = `管理闭环 ${s.stamp} ${width}`;
  let id;
  try {
    await page.goto(url({ page: 'session', sessionId: s.first }));
    await page.getByLabel('发送给 Agent', { exact: true }).waitFor();
    await page.getByLabel('发送给 Agent', { exact: true }).fill(`未发送草稿 ${width}`);
    await check('从会话创建项目记忆；空内容不可提交，Host 返回后读取修订', width, async () => {
      await navigate('记忆');
      await page.getByRole('button', { name: '新建记忆', exact: true }).click();
      await page.getByLabel('记忆标题', { exact: true }).fill(title);
      assert.equal(await page.getByRole('button', { name: '保存记忆', exact: true }).isDisabled(), true);
      await page.getByLabel('知识内容').fill('请求重试最多 7 次。');
      await page.getByLabel('修改依据').fill('隔离验证：初始人工设定。');
      await shot(page, 'editor', width);
      await page.getByRole('button', { name: '保存记忆', exact: true }).click();
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      id = JSON.parse(new URL(page.url()).searchParams.get('r')).target.id;
      const detail = (await api(`/memory/${id}?${new URLSearchParams({ project: s.project, includeHistory: 'true' })}`))
        .data;
      assert.equal(detail.current.revision, 1);
      assert.equal(detail.current.actor, 'user');
      assert.deepEqual(detail.current.sources, []);
      s.owned.push(id);
      s[`record${width}`] = id;
      await pause();
      return { id, revision: detail.current.revision, sources: 0 };
    });
    if (!id) throw Error('create failed');
    await check('另一个同项目 Session 可见，实际 Agent 读取并修订生成来源', width, async () => {
      await session(s.second);
      await navigate('记忆');
      await page.getByLabel('搜索记忆内容').fill(title);
      await page.locator('.aw-memory-row').filter({ hasText: title }).click();
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await session(s.second);
      const box = page.getByLabel('发送给 Agent', { exact: true });
      await box.fill(
        `这是隔离 Memory 管理验证，只操作记忆 ${id}。请先调用 memory_get 读取它，然后用 memory_revise 基于刚读取的版本将正文改为“请求重试最多 5 次。”，保持其余 knowledge 字段不变，reason 为“隔离验证：来源会话复核上限为 5。”。不创建其他记忆，不操作其他文件，最后简短说明。`,
      );
      await page.getByRole('button', { name: '发送任务', exact: true }).click();
      await page.getByRole('button', { name: '停止当前执行', exact: true }).waitFor();
      const native = await waitSession(s.second);
      const detail = (await api(`/memory/${id}?${new URLSearchParams({ project: s.project, includeHistory: 'true' })}`))
        .data;
      assert.equal(detail.current.content, '请求重试最多 5 次。');
      assert.equal(detail.current.actor, 'agent');
      assert.equal(detail.current.revision, 2);
      assert.ok(detail.current.sources.some((r) => r.sessionId === s.second));
      assert.ok(native.messages.some((m) => m.role === 'toolResult' && m.toolName === 'memory_get' && !m.isError));
      await pause();
      return { revision: 2, actor: detail.current.actor, sources: detail.current.sources };
    });
    await check('用户修订、真实版本差异与重新确认，不改写原来源归属', width, async () => {
      await navigate('记忆');
      await page.getByLabel('搜索记忆内容').fill(title);
      await page.locator('.aw-memory-row').filter({ hasText: title }).click();
      await page.getByRole('button', { name: '编辑记忆', exact: true }).click();
      await page.getByLabel('知识内容').fill('请求重试最多 3 次。');
      await page.getByLabel('修改依据').fill('隔离验证：人工复核后收紧为 3 次。');
      await page.getByRole('button', { name: '保存修订', exact: true }).click();
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await page.getByRole('button', { name: /修订历史/ }).click();
      await page.getByLabel('查看修订').waitFor();
      assert.match(await page.locator('.aw-note').innerText(), /5 次/);
      assert.match(await page.locator('.aw-note').innerText(), /3 次/);
      await shot(page, 'history', width);
      await pause();
      await page.getByRole('button', { name: '重新确认认识', exact: true }).click();
      await page.getByLabel('修改依据').fill('隔离验证：确认 3 次是当前认识。');
      await page.getByRole('button', { name: '重新确认认识', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      const d = (await api(`/memory/${id}?${new URLSearchParams({ project: s.project, includeHistory: 'true' })}`))
        .data;
      assert.equal(d.current.operation, 'confirm');
      assert.equal(d.current.revision, 4);
      assert.equal(d.current.usable, true);
      assert.ok(d.current.sources.length);
      await shot(page, 'detail', width);
      await pause();
      return { revision: 4, operation: d.current.operation, usable: true, sources: d.current.sources.length };
    });
    await check('撤销退出真实 Agent 普通检索，历史仍保留', width, async () => {
      await page.getByRole('button', { name: '撤销记忆', exact: true }).click();
      await page.getByLabel('修改依据').fill('隔离验证：暂不继续使用此认识。');
      await page.getByRole('button', { name: '撤销记忆', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      assert.match(await page.getByLabel('检索状态').innerText(), /已撤销/);
      const ordinary = await api(`/memory/${id}?${new URLSearchParams({ project: s.project })}`);
      assert.equal(ordinary.status, 409);
      const d = (await api(`/memory/${id}?${new URLSearchParams({ project: s.project, includeHistory: 'true' })}`))
        .data;
      assert.equal(d.current.usable, false);
      assert.equal(d.current.status, 'withdrawn');
      await shot(page, 'withdrawn', width);
      await session(s.second);
      await page
        .getByLabel('发送给 Agent', { exact: true })
        .fill(
          `请只调用 memory_search，query 为“${title}”，includeHistory=false；再调用 memory_get 读取 ${id} 且 includeHistory=false。不要修改记忆。说明这条记忆是否可用于当前检索。`,
        );
      await page.getByRole('button', { name: '发送任务', exact: true }).click();
      await page.getByRole('button', { name: '停止当前执行', exact: true }).waitFor();
      const native = await waitSession(s.second),
        messages = native.messages.filter((m) => m.role === 'toolResult');
      const get = messages.filter((m) => m.toolName === 'memory_get').at(-1);
      assert.equal(get?.isError, true);
      assert.match(JSON.stringify(get), /MEMORY_NOT_CURRENT/);
      return { status: ordinary.status, nativeMemoryGetError: true, history: d.history.length };
    });
    await check('历史查询定位原生来源、返回原会话保留草稿，三尺寸不溢出', width, async () => {
      await navigate('记忆');
      await page.getByRole('button', { name: '历史查询', exact: true }).click();
      await page.getByLabel('搜索记忆内容').fill(title);
      await page.locator('.aw-memory-row').first().click();
      await page.getByRole('button', { name: '记忆来源 1', exact: true }).click();
      await page.getByRole('heading', { name: '依据与来源', exact: true }).waitFor();
      await shot(page, 'source', width);
      await pause();
      await page.getByRole('button', { name: '在来源会话中定位', exact: true }).click();
      await page.locator('.host-located-message').waitFor();
      await shot(page, 'located', width);
      await session(s.first);
      assert.equal(await page.getByLabel('发送给 Agent', { exact: true }).inputValue(), `未发送草稿 ${width}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      return { draft: 'retained', source: 'native Session Entry', overflow: false };
    });
  } finally {
    await fs.writeFile(new URL('../.runtime/scenario.json', import.meta.url), JSON.stringify(s, null, 2));
    await ctx.tracing.stop({ path: new URL(`journey-${width}.zip`, out).pathname });
    const video = page.video();
    await ctx.close();
    if (video) {
      await video.saveAs(new URL('videos/memory-management-1440.webm', out).pathname);
      await video.delete();
    }
  }
}
await browser.close();
await save('journey');
