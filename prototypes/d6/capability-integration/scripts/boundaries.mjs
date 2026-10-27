import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, launch, context, url, out, record, shot, check, save } from './common.mjs';
const m = JSON.parse(await fs.readFile(new URL('../.runtime/manifest.json', import.meta.url), 'utf8'));
const b = await launch(),
  c = await context(b, 1440),
  p = await c.newPage();
record(p, 1440);
await c.tracing.start({ screenshots: true, snapshots: true });
const detail = async () => (await api(`/skills/${m.skillId}`)).data;
async function poll(fn) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('authority deadline');
}
async function open() {
  await p.goto(url({ page: 'skills', project: m.sourceProject }));
  await p.locator(`[data-skill="${m.skillId}"]`).click();
  await p.locator('.asm-files button').first().waitFor();
}
async function review() {
  await p.getByRole('tab', { name: '审查与发布', exact: true }).click();
  await p.getByRole('button', { name: '记录精确内容审查', exact: true }).click();
  const d = p.getByRole('dialog');
  for (const cb of await d.getByRole('checkbox').all()) await cb.check();
  await d
    .getByRole('textbox', { name: '审查结论' })
    .fill('隔离测试候选，完整核对纯文本代码、锁定依赖和权限；失败样例仅用于验证旧版保留。');
  await d.getByRole('button', { name: '记录审查', exact: true }).click();
  await d.waitFor({ state: 'hidden' });
}
await check('actual concurrent 409 preserves local draft and requires explicit comparison', 1440, async () => {
  await open();
  await p.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = p.getByRole('textbox', { name: 'Skill 内容' });
  const value = await editor.inputValue(),
    local = `${value}\nlocal conflict retained ${Date.now()}`;
  await editor.fill(local);
  let status = 0,
    intercepted = false;
  await p.route(`**/api/skills/${m.skillId}/edit`, async (route) => {
    if (intercepted) return route.continue();
    intercepted = true;
    const before = await detail();
    const external = await api(`/skills/${m.skillId}/edit`, 'POST', {
      baseRevision: before.skill.revision,
      files: [{ path: 'notes.md', content: 'Concurrent unrelated file edit.' }],
    });
    assert.equal(external.status, 201);
    const r = await route.fetch();
    status = r.status();
    await route.fulfill({ response: r });
  });
  await p.getByRole('button', { name: '保存候选', exact: true }).click();
  await p.locator('[role=alert]').filter({ hasText: '其他窗口' }).first().waitFor();
  assert.equal(status, 409);
  await p.unroute(`**/api/skills/${m.skillId}/edit`);
  assert.equal(await editor.inputValue(), local);
  await p.getByRole('button', { name: '比较最新候选', exact: true }).click();
  await p.getByRole('button', { name: '以最新候选继续此文件', exact: true }).click();
  await shot(p, 'conflict', 1440);
  await p.getByRole('button', { name: '保存候选', exact: true }).click();
  await p.getByText('候选已保存，正式版本保持原样。', { exact: true }).waitFor();
  return { response: status, draftRetained: true, explicitRebase: true };
});
await check('changed content invalidates review; failed operation retains usable current; rollback', 1440, async () => {
  const before = await detail();
  const version = before.skill.current;
  await p.getByRole('button', { name: 'tool.js', exact: true }).click();
  await p.getByRole('button', { name: '编辑', exact: true }).click();
  await p
    .getByRole('textbox', { name: 'Skill 内容' })
    .fill("export default function(){throw new Error('Controlled extension load failure');}");
  await p.getByRole('button', { name: '保存候选', exact: true }).click();
  await poll(async () => {
    const d = await detail();
    return d.skill.latest !== before.skill.latest && d;
  });
  await review();
  await p.getByRole('button', { name: '检查并发布', exact: true }).click();
  await p.getByRole('dialog').getByRole('button', { name: '确认发布', exact: true }).click();
  const failed = await poll(async () => {
    const d = await detail();
    return d.operations.find((o) => o.status === 'failed') && d;
  });
  assert.equal(failed.skill.current, version);
  await p.locator('.asm-detail > [data-operation-status="failed"]').waitFor();
  await shot(p, 'publish-failed', 1440);
  await p.getByRole('tab', { name: '版本', exact: true }).click();
  await p.getByRole('button', { name: '恢复此版本', exact: true }).last().click();
  await p.getByRole('dialog').getByRole('button', { name: '确认恢复', exact: true }).click();
  const restored = await poll(async () => {
    const d = await detail();
    return d.skill.current === m.initialVersion && d;
  });
  assert.ok(restored.versions.some((v) => v.id === failed.skill.latest));
  return {
    failed: failed.operations.find((o) => o.status === 'failed'),
    currentBefore: version,
    currentAfterFailure: failed.skill.current,
    restored: restored.skill.current,
    candidatePreserved: true,
  };
});
await check('disable and enable are authoritative async operations', 1440, async () => {
  await open();
  for (const enabled of [false, true]) {
    await p.getByRole('button', { name: enabled ? '启用' : '禁用', exact: true }).click();
    await p
      .getByRole('dialog')
      .getByRole('button', { name: enabled ? '确认启用' : '确认禁用', exact: true })
      .click();
    await poll(async () => {
      const d = await detail();
      return d.skill.enabled === enabled && d;
    });
    await p.locator('.asm-detail > [data-operation-status="applied"]').waitFor();
  }
  return { enabled: (await detail()).skill.enabled };
});
await check('Tool membership uses exact Host Session arrays and project scope', 1440, async () => {
  await p.goto(url({ page: 'skills', project: m.sourceProject }));
  await p.getByRole('tab', { name: '工具', exact: true }).click();
  await p.getByText('capability_echo', { exact: true }).click();
  const select = p.getByRole('combobox', { name: '工具 capability_echo 的会话' });
  await select.selectOption(m.secondSession);
  const row = p.locator('.host-tool-list > details').filter({ has: p.getByText('capability_echo', { exact: true }) });
  const tools = (await api(`/tools?${new URLSearchParams({ project: m.sourceProject })}`)).data;
  const tool = tools.tools.find((t) => t.name === 'capability_echo');
  const actual = await row.locator('.host-tool-membership').innerText();
  assert.ok(actual.includes(`可以调用\n${tool.callableSessions.includes(m.secondSession) ? '是' : '否'}`));
  await shot(p, 'tool-session', 1440);
  const foreign = (await api(`/tools?${new URLSearchParams({ project: m.otherProject })}`)).data;
  assert.equal(
    foreign.tools.some((t) => t.name === 'capability_echo'),
    false,
  );
  return { tool, foreignHasTool: false };
});
await check('reply lost after real commit never reports saved; refresh retains stale draft', 1440, async () => {
  await open();
  await p.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = p.getByRole('textbox', { name: 'Skill 内容' }),
    value = await editor.inputValue();
  await editor.fill(`${value}\nuncertain saved reply ${Date.now()}`);
  const before = await detail();
  let status,
    dropped = false;
  await p.route(`**/api/skills/${m.skillId}/edit`, async (route) => {
    if (dropped) return route.continue();
    dropped = true;
    const response = await route.fetch();
    status = response.status();
    await route.abort('failed');
  });
  await p.getByRole('button', { name: '保存候选', exact: true }).click();
  await p.locator('[role=alert]').filter({ hasText: '草稿已保留' }).first().waitFor();
  assert.equal(status, 201);
  await p.unroute(`**/api/skills/${m.skillId}/edit`);
  assert.notEqual((await detail()).skill.latest, before.skill.latest);
  assert.equal(await p.getByText('候选已保存，正式版本保持原样。', { exact: true }).count(), 0);
  await shot(p, 'uncertain', 1440);
  return { actualCommit: 201, clientSuccess: false, retained: await editor.inputValue() };
});
await check('actual Origin 403 and missing bearer 401; reconnect after restoration', 1440, async () => {
  for (const code of [403, 401]) {
    let actual;
    await p.route('**/api/skills?*', async (route) => {
      const headers = { ...route.request().headers() };
      if (code === 403) headers.origin = 'https://invalid.local';
      else delete headers.authorization;
      const response = await route.fetch({ headers });
      actual = response.status();
      await route.fulfill({ response });
    });
    await p.goto(url({ page: 'skills', project: m.sourceProject }));
    await poll(() => actual);
    assert.equal(actual, code);
    await shot(p, `http-${code}`, 1440);
    await p.unroute('**/api/skills?*');
    await p.goto(url({ page: 'skills', project: m.sourceProject }));
    await p.locator(`[data-skill="${m.skillId}"]`).waitFor();
  }
  return { origin: 403, bearer: 401, recovered: true };
});
await c.tracing.stop({ path: new URL('boundaries-trace.zip', out).pathname });
await c.close();
await save('boundaries');
await b.close();
