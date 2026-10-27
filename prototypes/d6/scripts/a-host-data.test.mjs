import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import { createWorkspaceFixtures, uid } from '../src/workspace/host-fixtures.ts';
import { reflectionHeadline, activityState, suggestionState, memoryState } from '../src/workspace/host-data.tsx';
import { memoryContent, memoryReason } from '../../../apps/host/memory/memory.ts';
import { evolutionInput, evolutionEvidence } from '../../../apps/host/evolution/evolution.ts';
import { activityResult } from '../../../apps/host/evolution/activities.ts';
const data = createWorkspaceFixtures();
for (const detail of data.memories)
  for (const r of detail.history) {
    memoryContent.parse({ title: r.title, content: r.content, kind: r.kind, scope: r.scope });
    memoryReason.parse(r.reason);
    assert.match(r.id, /^[0-9a-f-]{36}$/);
    assert.equal(r.isCurrent, r.revision === detail.current.revision);
  }
for (const s of data.suggestions) {
  const { title, goal, reason, value, uncertainty, action, evidence, priority, attentionReason } = s;
  evolutionInput.parse({
    title,
    goal,
    reason,
    value,
    uncertainty,
    action,
    evidence,
    priority,
    ...(attentionReason ? { attentionReason } : {}),
  });
}
for (const r of data.reflections) for (const e of r.record?.evidence ?? []) evolutionEvidence.parse(e);
for (const a of data.activities) if (a.result) activityResult.parse(a.result);
const complete = data.reflections.find((r) => r.job.id === uid(24));
assert.equal(reflectionHeadline(complete), complete.record.summary);
const changed = structuredClone(complete);
changed.record.summary = '索引已重建，两个目录尚未扫描。';
assert.equal(reflectionHeadline(changed), changed.record.summary);
changed.record.summary = '';
assert.equal(reflectionHeadline(changed), '检查已完成，未保存结论');
changed.record.summary = '长'.repeat(200);
assert.equal(reflectionHeadline(changed), '已保存的检查结论');
changed.record.summary = '结果第一行\n仍需核对';
assert.equal(reflectionHeadline(changed), '已保存的检查结论');
changed.job.status = 'failed';
assert.equal(reflectionHeadline(changed), '检查失败');
assert.equal(suggestionState.ignored, '已忽略');
assert.equal(suggestionState.adopted, '已进入讨论');
assert.equal(activityState(data.activities.find((a) => a.id === uid(43))), '开发或检查失败');
assert.equal(data.activities.find((a) => a.id === uid(43)).releases.length, 1);
assert.equal(activityState(data.activities.find((a) => a.id === uid(42))), '开发结束，未记录版本发布');
const revised = data.memories.find((m) => m.current.id === uid(15));
assert.notEqual(revised.current.title, revised.history[1].title);
assert.equal(memoryState(data.memories.find((m) => m.current.id === uid(16)).current), '来源待恢复');
console.log(
  JSON.stringify({
    hostSchemas: 'passed',
    records: {
      memories: data.memories.length,
      reflections: data.reflections.length,
      suggestions: data.suggestions.length,
      activities: data.activities.length,
    },
    presentationCases: 'passed',
  }),
);
