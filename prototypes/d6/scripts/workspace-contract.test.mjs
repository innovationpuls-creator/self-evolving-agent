import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { MemoryService } from '../../../apps/host/memory/memory.ts';
import { SensitiveData } from '../../../apps/host/storage/storage.ts';
import { projectMemory, reviseMemory } from '../src/workspace/memory-model.ts';
import {
  project,
  projectHash,
  researchProject,
  researchHash,
  createWorkspaceFixtures,
  uid,
} from '../src/workspace/host-fixtures.ts';
import { toolMembership, toolObservations } from '../src/workspace/tool-observations.ts';
const db = new DatabaseSync(':memory:');
const service = new MemoryService(db, new SensitiveData(), () => {});
service.init();
const a = { actor: 'user', project },
  b = { actor: 'user', project: researchProject },
  global = { actor: 'user' };
const key = (p) => (p ? createHash('sha256').update(p).digest('hex') : undefined);
assert.equal(key(project), projectHash);
assert.equal(key(researchProject), researchHash);
const saved = service.create(
  a,
  { title: '项目发布规则', content: '明确哪些检查实际运行', kind: 'decision', scope: 'project' },
  '用户记录',
);
const originalId = saved.id;
function command(input) {
  const old = service.get(a, originalId, true).current;
  const expected = reviseMemory(old, { baseRevision: old.revision, ...input }, projectHash, 1);
  const actual = service.revise(a, originalId, { baseRevision: old.revision, ...input, content: input.knowledge });
  for (const field of [
    'title',
    'content',
    'kind',
    'scope',
    'project',
    'status',
    'operation',
    'reason',
    'revision',
    'previousRevision',
    'actor',
    'usable',
    'unavailable',
    'isCurrent',
    'basis',
    'sources',
  ])
    assert.deepEqual(expected[field], actual[field], field);
  return actual;
}
command({
  reason: '新证据',
  knowledge: { title: '发布规则修订', content: '未运行的检查单独列出', kind: 'experience', scope: 'project' },
});
command({ reason: '原认识不再适用', retire: true });
assert.equal(service.search(a).total, 0);
command({
  reason: '只编辑撤销记录',
  knowledge: { title: '仍待重新确认', content: '新的候选认识', kind: 'hypothesis', scope: 'project' },
});
assert.equal(service.get(a, originalId, true).current.status, 'withdrawn');
command({
  reason: '重新核对后确认',
  confirm: true,
  knowledge: { title: '重新确认的记录', content: '已与材料核对', kind: 'fact', scope: 'project' },
});
command({
  reason: '提炼跨项目经验',
  knowledge: { title: '全局报告习惯', content: '区分测试与构建', kind: 'experience', scope: 'global' },
});
for (const ctx of [a, b, global])
  assert.deepEqual(
    projectMemory(service.get(a, originalId, true), key(ctx.project)),
    service.get(ctx, originalId, true),
  );
assert.equal(service.get(b, originalId, true).history.length, 1);
command({ reason: '不再保留为当前认识', remove: true });
assert.throws(() =>
  reviseMemory(
    service.get(a, originalId, true).current,
    {
      baseRevision: 7,
      reason: '重新确认',
      confirm: true,
      knowledge: { title: 't', content: 'c', scope: 'global', kind: 'fact' },
    },
    projectHash,
  ),
);
const data = createWorkspaceFixtures();
const unavailable = data.memories.find((d) => d.current.id === uid(16)).current;
assert.throws(() => reviseMemory(unavailable, { baseRevision: 1, reason: '撤销', retire: true }, projectHash));
assert.equal(
  reviseMemory(unavailable, { baseRevision: 1, reason: '移除', remove: true }, projectHash).status,
  'deleted',
);
assert.throws(() =>
  reviseMemory(
    data.memories.find((d) => d.current.id === uid(12)).current,
    { baseRevision: 99, reason: '冲突' },
    projectHash,
  ),
);
const globalRecord = data.memories.find((d) => d.current.id === uid(19));
assert.equal(projectMemory(globalRecord, projectHash).current.sources.length, 0);
assert.equal(projectMemory(globalRecord, researchHash).current.sources.length, 1);
const tool = toolObservations.find((t) => t.name === 'text_diff');
assert.deepEqual(toolMembership(tool, uid(2)), { loaded: true, active: false, callable: false });
assert.deepEqual(toolMembership(tool, uid(7)), { loaded: false, active: false, callable: false });
assert.equal(toolMembership(tool, undefined).callable, undefined);
assert.equal(toolMembership(tool, uid(1), false).callable, undefined);
service.close();
db.close();
console.log(
  JSON.stringify({
    realMemoryServiceComparison: 'passed',
    projection: 'A/B/global passed',
    lifecycle: 'revise/retire/confirm/scope/delete/conflict/unavailable passed',
    toolMembership: 'independent states passed',
  }),
);
