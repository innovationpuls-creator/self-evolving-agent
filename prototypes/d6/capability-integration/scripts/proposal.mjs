import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, launch, context, url, record, shot, check, save } from './common.mjs';
const m = JSON.parse(await fs.readFile(new URL('../.runtime/manifest.json', import.meta.url), 'utf8')),
  b = await launch(),
  c = await context(b, 390),
  p = await c.newPage();
record(p, 390);
await check(
  'user-created proposal is distinct from actual agent Tool submission; ignore and archive',
  390,
  async () => {
    await p.goto(url({ page: 'evolution', status: '' }));
    await p.getByRole('button', { name: '提出建议', exact: true }).click();
    const title = `用户提出的隔离验证 ${Date.now()}`;
    for (const [label, text] of [
      ['建议名称', title],
      ['希望改变什么', '核对用户建议与实际来源'],
      ['为什么需要改变', '这是用户明确创建的测试构想，不是 Agent 自主发现。'],
      ['预期作用', '保持来源准确'],
      ['尚不确定的部分', '没有提出必须开发的代码'],
      ['建议怎样开始', '先讨论证据，再独立授权。'],
    ])
      await p.getByRole('textbox', { name: label, exact: true }).fill(text);
    await shot(p, 'proposal-create', 390);
    await p.getByRole('button', { name: '保存建议', exact: true }).click();
    await p.getByRole('heading', { name: title, exact: true }).waitFor();
    const route = JSON.parse(new URL(p.url()).searchParams.get('r'));
    const s = (await api(`/suggestions/${route.target.id}`)).data;
    assert.equal(s.actor, 'user');
    assert.equal(s.project, null);
    assert.equal(s.source, undefined);
    await p.getByRole('button', { name: '忽略', exact: true }).click();
    await p.getByText(/已忽略 · 你提出的建议/).waitFor();
    await p.getByRole('button', { name: '归档', exact: true }).click();
    await p.getByText(/已归档 · 你提出的建议/).waitFor();
    const final = (await api(`/suggestions/${s.id}`)).data;
    assert.equal(final.status, 'archived');
    await p.goto(url({ page: 'result', target: { kind: 'suggestion', id: m.agentSuggestionId } }));
    await p.getByText(/Agent 提出的建议/).waitFor();
    await p.getByText(/依据与来源/).click();
    await p.getByRole('button', { name: '查看原始依据', exact: true }).first().click();
    await p.getByRole('heading', { name: '依据与来源', exact: true }).waitFor();
    await shot(p, 'agent-proposal-source', 390);
    return {
      user: { id: s.id, actor: s.actor, project: s.project, status: final.status },
      agent: (await api(`/suggestions/${m.agentSuggestionId}`)).data.source,
      mode: 'agent source uses controlled native Tool Call, not autonomous discovery',
    };
  },
);
await save('proposal');
await c.close();
await b.close();
