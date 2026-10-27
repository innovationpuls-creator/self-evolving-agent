import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api, save, check } from './common.mjs';
const runtime = new URL('../.runtime/', import.meta.url);
const scenarioPath = new URL('real.json', runtime);
const stamp = new Date().toISOString().replaceAll(':', '-');
let s;
try {
  s = JSON.parse(await fs.readFile(scenarioPath, 'utf8'));
} catch {}
if (!s) {
  const project = new URL(`projects/${stamp}/alpha/`, runtime).pathname;
  const foreign = new URL(`projects/${stamp}/beta/`, runtime).pathname;
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(foreign, { recursive: true });
  await fs.writeFile(
    `${project}POLICY.md`,
    '# 隔离验证项目：当前配置\n\n此文件是项目确认的当前事实，适用于该隔离验证项目。\n\n- 请求重试上限：3 次。\n- 单次请求超时：12 秒。\n\n旧版 7 次重试、30 秒超时的说明已于本次配置核对前失效。\n',
  );
  const memory = await api(`/memory?${new URLSearchParams({ project })}`, 'POST', {
    knowledge: {
      title: `隔离项目请求配置 ${stamp}`,
      content: '隔离验证项目请求重试上限是 7 次，单次超时 30 秒。',
      kind: 'fact',
      scope: 'project',
    },
    reason: '受控创建的旧配置，用于观察真实模型能否据实际文件自主核对；不是用户既有记忆。',
  });
  assert.equal(memory.status, 201);
  const models = (await api('/models')).data.models;
  const model = models.find((m) => m.provider === 'openai-codex' && m.id === 'gpt-6-luna');
  assert.ok(model, 'existing configured real model required');
  const source = await api('/sessions', 'POST', { cwd: project, provider: model.provider, model: model.id });
  assert.equal(source.status, 201);
  s = { stamp, project, foreign, source: source.data.id, memory: memory.data.id, model };
  await fs.writeFile(scenarioPath, JSON.stringify(s, null, 2), { mode: 0o600 });
}
const wait = async (fn, ms = 240000) => {
  const end = Date.now() + ms;
  while (true) {
    const r = await fn();
    if (r) return r;
    assert.ok(Date.now() < end, 'real model deadline');
    await new Promise((r) => setTimeout(r, 1200));
  }
};
await check('真实来源任务与原生后台反思：依据文件自主核对，允许无变化', 1440, async () => {
  const catalog = (await api(`/reflections?view=summary&sessionId=${s.source}`)).data;
  if (!catalog.total && !(await api(`/sessions/${s.source}`)).data.messages?.some((m) => m.role === 'user')) {
    const sent = await api(`/sessions/${s.source}/prompt`, 'POST', {
      text: '请读取 POLICY.md，核对该隔离项目当前的请求重试次数与超时设置，说明文件依据和已知认识是否一致。本任务只回答配置核对，不开发技能，不更改项目文件。',
    });
    assert.equal(sent.status, 202);
  }
  const session = await wait(async () => {
    const r = (await api(`/sessions/${s.source}`)).data;
    return !r.busy && r.messages?.some((m) => m.role === 'assistant') ? r : false;
  });
  assert.ok(!session.error, session.error);
  const finished = await wait(async () => {
    const r = (await api(`/reflections?view=summary&sessionId=${s.source}`)).data;
    return r.jobs?.some((j) => ['succeeded', 'failed', 'interrupted', 'waiting_user'].includes(j.status)) ? r : false;
  });
  const job = finished.jobs[0];
  const detail = await api(`/reflections/${job.id}`);
  s.job = job.id;
  s.record = detail.data.record?.id;
  await fs.writeFile(scenarioPath, JSON.stringify(s, null, 2), { mode: 0o600 });
  const memory = await api(
    `/memory/${s.memory}?${new URLSearchParams({ project: s.project, includeHistory: 'true' })}`,
  );
  const sessionOperations = session.messages.filter((m) => m.details?.memory).map((m) => m.details.memory);
  const changes = detail.data.record?.changes || [];
  await fs.writeFile(
    new URL('../evidence/real-model.json', import.meta.url),
    JSON.stringify(
      {
        mode: 'real configured model / signed native Worker / natural agent_settled trigger',
        sessionOperations,
        job,
        record: detail.data.record,
        memory: memory.data,
        environment: finished.availability,
      },
      null,
      2,
    ),
  );
  assert.equal(job.status, 'succeeded', JSON.stringify(job));
  for (const c of changes.filter((c) => c.kind === 'memory')) {
    const actual = await api(`/memory/${c.id}?${new URLSearchParams({ project: s.project, includeHistory: 'true' })}`);
    assert.equal(actual.status, 200);
    const revision = actual.data.history.find((r) => r.revision === c.revision);
    assert.ok(revision);
    assert.ok(revision.sources.some((src) => src.sessionId === detail.data.record.reflectionSessionId));
  }
  return {
    mode: 'real model',
    jobStatus: job.status,
    sourceSessionOperations: sessionOperations,
    workerChanges: changes,
    summary: detail.data.record.summary,
    allowedEmpty: true,
  };
});
await save('real');
