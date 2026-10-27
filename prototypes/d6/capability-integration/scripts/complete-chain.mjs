import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { api, launch, context, url, out, record, shot, check, save } from './common.mjs';
const base = new URL('../.runtime/', import.meta.url),
  m = JSON.parse(await fs.readFile(new URL('manifest.json', base), 'utf8'));
async function poll(fn) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Activity authority deadline');
}
async function control(steps) {
  const id = randomUUID();
  await fs.writeFile(new URL('control.json', base), JSON.stringify({ id, steps }), { mode: 0o600 });
  await poll(async () => {
    try {
      return JSON.parse(await fs.readFile(new URL('control-result.json', base), 'utf8')).id === id;
    } catch {
      return false;
    }
  });
}
const idea = {
  title: `隔离任务：纯文本能力维护 ${Date.now().toString(36)}`,
  goal: '在隔离项目验证纯文本工具的独立开发授权与精确发布',
  reason: '需要检查建议、讨论、授权与实际版本之间的对象关系。',
  value: '保留完整可追溯的版本与原始依据。',
  uncertainty: '本次是受控机制任务，不是自主模型发现，能力是否有实际日常价值仍需判断。',
  action: '先独立讨论，再仅授权明确的新 Skill。',
  evidence: [],
  priority: 'normal',
};
await control([{ tool: 'suggestion_submit', args: idea }, { text: '受控建议已保存；没有授予任何开发权限。' }]);
assert.equal(
  (await api(`/sessions/${m.sourceSession}/prompt`, 'POST', { text: '记录本次隔离能力验证建议，保留正式来源。' }))
    .status,
  202,
);
await poll(async () => !(await api(`/sessions/${m.sourceSession}`)).data.busy);
const createdSuggestion = await poll(async () =>
  (await api(`/suggestions?${new URLSearchParams({ sessionId: m.sourceSession, limit: '20' })}`)).data.items.find(
    (s) => s.title === idea.title,
  ),
);
assert.equal(createdSuggestion.actor, 'agent');
assert.equal(createdSuggestion.project, m.sourceProject);
const b = await launch({ slowMo: 280 });
for (const width of [1440]) {
  const c = await context(b, width, width === 1440),
    p = await c.newPage();
  record(p, width);
  await c.tracing.start({ screenshots: true, snapshots: true });
  await check(
    'suggestion → adopt → independent discussion → grant → native development → applied → exact Skill → return suggestion',
    width,
    async () => {
      const suggestion = (await api(`/suggestions/${createdSuggestion.id}`)).data;
      assert.equal(suggestion.status, 'pending');
      await p.goto(url({ page: 'session', sessionId: m.sourceSession }));
      await p
        .getByRole('textbox', { name: '发送给 Agent', exact: true })
        .fill('原始任务草稿：返回后核对新能力的实际用途。');
      if (!(await p.locator('.sidebar').isVisible()))
        await p.getByRole('button', { name: '打开导航', exact: true }).click();
      await p
        .getByRole('navigation', { name: '主要模块', exact: true })
        .getByRole('button', { name: '改进建议', exact: true })
        .click();
      await p.locator(`[data-suggestion="${suggestion.id}"]`).click();
      await p.getByRole('heading', { name: suggestion.title, exact: true }).waitFor();
      await shot(p, 'chain-proposal', width);
      await p.waitForTimeout(1800);
      await p.getByRole('button', { name: '采纳并讨论', exact: true }).click();
      await p.getByRole('textbox', { name: '发送给 Agent', exact: true }).waitFor();
      const adopted = (await api(`/suggestions/${suggestion.id}`)).data;
      assert.equal(adopted.status, 'adopted');
      const a = await poll(async () =>
        (await api('/activities')).data.find((a) => a.sessionId === adopted.discussionSessionId),
      );
      assert.equal(a.status, 'discussion');
      assert.equal(a.grant, undefined);
      assert.equal(a.project, m.sourceProject);
      await p.getByRole('textbox', { name: '发送给 Agent', exact: true }).fill('返回后继续核对具体版本与来源。');
      await shot(p, 'chain-discussion', width);
      await p.waitForTimeout(1400);
      await p.getByRole('button', { name: '审阅开发授权', exact: true }).waitFor();
      const name = `complete-chain-${width}-${Date.now().toString(36)}`,
        tool = name.replaceAll('-', '_'),
        directory = join(new URL('data/evolution/', base).pathname, a.id, name);
      const files = {
        'package.json': JSON.stringify({
          name,
          version: '1.0.0',
          private: true,
          pi: { skills: ['SKILL.md'], extensions: ['tool.js'] },
        }),
        'package-lock.json': JSON.stringify({
          name,
          version: '1.0.0',
          lockfileVersion: 3,
          requires: true,
          packages: { '': { name, version: '1.0.0' } },
        }),
        'SKILL.md': `---\nname: ${name}\ndescription: Echo exact caller text in an isolated controlled development test.\n---\n# Echo caller text\nUse ${tool} to return supplied text unchanged.`,
        'tool.js': `import {Type} from 'typebox';export default function(pi){pi.registerTool({name:'${tool}',label:'Echo caller text',description:'Return caller text unchanged',parameters:Type.Object({text:Type.String()}),async execute(_id,args){return {content:[{type:'text',text:args.text}],details:{text:args.text}};}});}`,
      };
      await control([
        ...Object.entries(files).map(([path, content]) => ({
          tool: 'write',
          args: { path: join(directory, path), content },
        })),
        {
          tool: 'evolution_complete',
          args: {
            summary: '已完成隔离纯文本回声能力，提交实际原生调用检查。',
            packages: [
              {
                target: name,
                skillFile: 'SKILL.md',
                extensions: ['tool.js'],
                knowledgeFiles: [],
                probes: [{ tool, args: { text: 'proof-text' }, expectedText: 'proof-text' }],
              },
            ],
          },
        },
      ]);
      await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
      const d = p.getByRole('dialog');
      await d.getByRole('textbox', { name: '允许新建的技能名称' }).fill(name);
      await d
        .getByRole('textbox', { name: '授权目标与限制', exact: true })
        .fill('在隔离项目创建纯文本回声工具，仅允许下方明确列出的新 Skill。');
      await shot(p, 'chain-grant', width);
      await p.waitForTimeout(2200);
      assert.equal(await d.getByRole('checkbox', { checked: true }).count(), 0);
      await d.getByRole('button', { name: '授权并开始开发', exact: true }).click();
      const final = await poll(async () => {
        const current = (await api(`/activities/${a.id}`)).data;
        return ['completed', 'failed', 'interrupted'].includes(current.status) && current;
      });
      assert.equal(final.status, 'completed', JSON.stringify(final));
      assert.equal(final.releases.length, 1);
      const release = final.releases[0],
        op = (await api(`/skills/operations/${release.operationId}`)).data,
        skill = (await api(`/skills/${release.skillId}`)).data;
      assert.equal(op.status, 'applied');
      assert.equal(op.evolution.activityId, a.id);
      assert.equal(skill.skill.current, release.version);
      assert.equal(skill.versions.find((v) => v.id === release.version).evolution.activityId, a.id);
      await p.locator('[data-release-status="applied"]').waitFor();
      await shot(p, 'chain-result', width);
      await p.waitForTimeout(width === 1440 ? 1700 : 100);
      await p.getByRole('button', { name: '查看精确版本', exact: true }).click();
      await p.getByRole('heading', { name }).waitFor();
      await shot(p, 'chain-skill', width);
      await p.waitForTimeout(1600);
      await p.goBack();
      await p.getByRole('textbox', { name: '发送给 Agent' }).waitFor();
      assert.equal(
        await p.getByRole('textbox', { name: '发送给 Agent' }).inputValue(),
        '返回后继续核对具体版本与来源。',
      );
      await p.getByRole('button', { name: '返回原建议', exact: true }).click();
      await p.getByRole('heading', { name: suggestion.title, exact: true }).waitFor();
      await shot(p, 'chain-return', width);
      await p.locator('.host-evolution:visible .host-technical > summary').click();
      await p.getByRole('button', { name: '查看原始依据', exact: true }).first().click();
      await p.getByRole('heading', { name: '依据与来源', exact: true }).waitFor();
      await p.getByRole('button', { name: '在来源会话中定位', exact: true }).click();
      assert.equal(JSON.parse(new URL(p.url()).searchParams.get('r')).sessionId, m.sourceSession);
      assert.equal(
        await p.getByRole('textbox', { name: '发送给 Agent', exact: true }).inputValue(),
        '原始任务草稿：返回后核对新能力的实际用途。',
      );
      await shot(p, 'chain-origin-task', width);
      await p.waitForTimeout(1400);
      return {
        suggestion: suggestion.id,
        discussionSession: a.sessionId,
        activity: a.id,
        status: final.status,
        release,
        operation: op.status,
        current: skill.skill.current,
        originSession: m.sourceSession,
        originDraftRetained: true,
        mode: 'controlled native Pi; no autonomous real model claim',
      };
    },
  );
  await c.tracing.stop({ path: new URL(`complete-chain-trace-${width}.zip`, out).pathname });
  const v = p.video();
  await c.close();
  if (v) await v.saveAs(new URL('videos/complete-chain-1440.webm', out).pathname);
}
await save('complete-chain');
await b.close();
