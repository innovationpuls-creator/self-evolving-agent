import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { api, save } from './common.mjs';
const runtime = new URL('../.runtime/', import.meta.url);
await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-'),
  prefix = `Memory QA ${stamp}`;
const project = fileURLToPath(new URL(`projects/${stamp}/alpha/`, runtime)).replace(/\/$/, ''),
  other = fileURLToPath(new URL(`projects/${stamp}/beta/`, runtime)).replace(/\/$/, '');
await fs.mkdir(project, { recursive: true });
await fs.mkdir(other, { recursive: true });
const sessions = (await api('/sessions')).data,
  model = sessions.find((s) => s.provider === 'openai-codex') || sessions[0];
const createSession = async (cwd) => {
  const r = await api('/sessions', 'POST', { cwd, provider: model.provider, model: model.model });
  assert.equal(r.status, 201);
  return r.data.id;
};
const scenario = {
  stamp,
  prefix,
  project,
  other,
  first: await createSession(project),
  second: await createSession(project),
  foreign: await createSession(other),
  owned: [],
};
for (let i = 0; i < 36; i++) {
  const response = await api(`/memory?${new URLSearchParams({ project })}`, 'POST', {
    knowledge: {
      title: `${prefix} ${String(i + 1).padStart(2, '0')}`,
      content: i === 0 ? '短' : i === 1 ? '长内容段落。\n'.repeat(1200) : `分页测试记录 ${i + 1}，只用于隔离验证。`,
      scope: 'project',
      kind: ['fact', 'experience', 'decision', 'hypothesis'][i % 4],
    },
    reason: '本轮隔离验证创建，用于真实分页及内容边界',
  });
  assert.equal(response.status, 201);
  scenario.owned.push(response.data.id);
}
const g = await api('/memory', 'POST', {
  knowledge: {
    title: `${prefix} Global`,
    content: '隔离测试的全局记忆，不含业务知识。',
    scope: 'global',
    kind: 'experience',
  },
  reason: '本轮全局范围验证创建',
});
assert.equal(g.status, 201);
scenario.global = g.data.id;
scenario.owned.push(g.data.id);
await fs.writeFile(new URL('memory-scenario.json', runtime), JSON.stringify(scenario, null, 2), { mode: 0o600 });
await save('seed');
console.log(JSON.stringify({ created: scenario.owned.length, sessions: 3 }));
