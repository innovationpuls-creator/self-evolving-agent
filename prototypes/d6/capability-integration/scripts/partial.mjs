import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { api, launch, context, url, out, record, shot, check, save } from './common.mjs';
const base = new URL('../.runtime/', import.meta.url),
  m = JSON.parse(await fs.readFile(new URL('manifest.json', base), 'utf8'));
const b = await launch();
async function poll(fn) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const r = await fn();
    if (r) return r;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('partial completion deadline');
}
let completed;
for (const w of [1440, 850, 390]) {
  const c = await context(b, w, w === 1440),
    p = await c.newPage();
  record(p, w);
  p.setDefaultTimeout(10000);
  await check('partial Activity failure preserves prior authorized applied release', w, async () => {
    if (!completed) {
      const a = (
        await api('/activities', 'POST', {
          sessionId: m.sourceSession,
          goal: '隔离验证：两个授权目标，第二个检查失败，保留第一个已发布成果。',
        })
      ).data;
      const prefix = Date.now().toString(36),
        names = [`partial-good-${prefix}`, `partial-fail-${prefix}`],
        steps = [];
      for (let i = 0; i < 2; i++) {
        const name = names[i],
          dir = join(new URL('data/evolution/', base).pathname, a.id, name),
          files = {
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
            'SKILL.md': `---\nname: ${name}\ndescription: Controlled partial publication verification only.\n---\n# Controlled validation\nReturn caller text.`,
            'tool.js': i
              ? "export default function(){throw new Error('Controlled second candidate fails during load');}"
              : `import {Type} from 'typebox';export default function(pi){pi.registerTool({name:'${name.replaceAll('-', '_')}',label:'Caller text',description:'Return caller text',parameters:Type.Object({text:Type.String()}),async execute(_id,args){return {content:[{type:'text',text:args.text}]};}});}`,
          };
        for (const [path, content] of Object.entries(files))
          steps.push({ tool: 'write', args: { path: join(dir, path), content } });
      }
      steps.push({
        tool: 'evolution_complete',
        args: {
          summary: '两个隔离候选已提交，检查结果分别保留。',
          packages: names.map((name) => ({
            target: name,
            skillFile: 'SKILL.md',
            extensions: ['tool.js'],
            knowledgeFiles: [],
            probes: [
              { tool: name.replaceAll('-', '_'), args: { text: 'partial-proof' }, expectedText: 'partial-proof' },
            ],
          })),
        },
      });
      const id = randomUUID();
      await fs.writeFile(new URL('control.json', base), JSON.stringify({ id, steps }), { mode: 0o600 });
      await poll(async () => JSON.parse(await fs.readFile(new URL('control-result.json', base))).id === id);
      await p.goto(url({ page: 'activity', id: a.id }));
      await p.getByRole('button', { name: '审阅开发授权', exact: true }).click();
      await p.getByRole('dialog').getByRole('textbox', { name: '允许新建的技能名称' }).fill(names.join(' '));
      await p.getByRole('dialog').getByRole('button', { name: '授权并开始开发', exact: true }).click();
      completed = await poll(async () => {
        const r = (await api(`/activities/${a.id}`)).data;
        return r.status === 'failed' && r;
      });
      await fs.writeFile(new URL('partial.json', base), JSON.stringify(completed), { mode: 0o600 });
    } else await p.goto(url({ page: 'activity', id: completed.id }));
    assert.equal(completed.status, 'failed');
    assert.equal(completed.releases.length, 2);
    const failedRelease = completed.releases[1];
    const failedOp = (await api(`/skills/operations/${failedRelease.operationId}`)).data;
    assert.equal(failedOp.status, 'failed');
    assert.equal((await api(`/skills/${failedRelease.skillId}`)).data.skill.current, undefined);
    const release = completed.releases[0],
      op = (await api(`/skills/operations/${release.operationId}`)).data,
      skill = (await api(`/skills/${release.skillId}`)).data;
    assert.equal(op.status, 'applied');
    assert.equal(skill.skill.current, release.version);
    await p.locator('[data-activity-status="failed"]').waitFor();
    await p.getByText('已发布，当前正式版本', { exact: true }).waitFor();
    await shot(p, 'partial-failure', w);
    await p.getByText('实际检查', { exact: true }).click();
    await p.getByRole('button', { name: '查看精确版本', exact: true }).first().click();
    await p.getByRole('heading', { name: skill.skill.name, exact: true }).waitFor();
    assert.equal(await p.getByRole('combobox', { name: '文件版本' }).inputValue(), release.version);
    return { activity: completed.id, status: completed.status, retainedRelease: release, current: skill.skill.current };
  });
  await check('cancel discussion activity without implicit permission', w, async () => {
    const a = (await api('/activities', 'POST', { sessionId: m.sourceSession, goal: `隔离取消验证 ${w}` })).data;
    await p.goto(url({ page: 'activity', id: a.id }));
    await p.getByRole('button', { name: '取消活动', exact: true }).click();
    await p.getByRole('dialog').getByRole('button', { name: '确认取消', exact: true }).click();
    await p.locator('[data-activity-status="cancelled"]').waitFor();
    const current = (await api(`/activities/${a.id}`)).data;
    assert.equal(current.status, 'cancelled');
    assert.equal(current.grant, undefined);
    await shot(p, 'cancelled', w);
    return { status: current.status, grant: null };
  });
  const v = p.video();
  await c.close();
  if (v) await v.saveAs(new URL('videos/partial-failure-1440.webm', out).pathname);
}
await save('partial');
await b.close();
