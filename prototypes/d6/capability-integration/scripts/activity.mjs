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
const b = await launch();
for (const width of [1440, 850, 390]) {
  const c = await context(b, width, width === 1440),
    p = await c.newPage();
  record(p, width);
  await c.tracing.start({ screenshots: true, snapshots: true });
  await check('activity explicit grant → native development → actual published version', width, async () => {
    const a = (
      await api('/activities', 'POST', {
        sessionId: m.sourceSession,
        goal: `验证独立授权与实际发布 ${width}，仅开发纯文本回声。`,
      })
    ).data;
    await p.goto(url({ page: 'session', sessionId: a.sessionId }));
    await p.getByRole('button', { name: '审阅开发授权', exact: true }).waitFor();
    const name = `accepted-echo-${width}-${Date.now().toString(36)}`,
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
    await shot(p, 'grant-confirm', width);
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
    await shot(p, 'activity-result', width);
    await p.waitForTimeout(width === 1440 ? 1700 : 100);
    await p.getByRole('button', { name: '查看精确版本', exact: true }).click();
    await p.getByRole('heading', { name }).waitFor();
    await shot(p, 'activity-skill', width);
    await p.goBack();
    await p.getByRole('textbox', { name: '发送给 Agent' }).waitFor();
    return {
      activity: a.id,
      status: final.status,
      release,
      operation: op.status,
      current: skill.skill.current,
      mode: 'controlled native Pi; no autonomous real model claim',
    };
  });
  await c.tracing.stop({ path: new URL(`activity-trace-${width}.zip`, out).pathname });
  const v = p.video();
  await c.close();
  if (v) await v.saveAs(new URL('videos/activity-chain-1440.webm', out).pathname);
}
await save('activity');
await b.close();
