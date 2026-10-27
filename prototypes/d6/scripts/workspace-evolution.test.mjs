import { requireIsolation } from '../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { EvolutionService, evolutionInput } from '../../../apps/host/evolution/evolution.ts';
import { SensitiveData } from '../../../apps/host/storage/storage.ts';
import { activityResult } from '../../../apps/host/evolution/activities.ts';
import { memoryContent } from '../../../apps/host/memory/memory.ts';
import { beginDiscussion, grantDevelopment, manageSuggestion, activityBusy } from '../src/workspace/evolution-model.ts';
import {
  createWorkspaceFixtures,
  createStressFixtures,
  project,
  researchProject,
  uid,
} from '../src/workspace/host-fixtures.ts';
const data = createWorkspaceFixtures();
const pending = data.suggestions.find((s) => s.status === 'pending');
const { title, goal, reason, value, uncertainty, action, evidence, priority, attentionReason } = pending;
const input = { title, goal, reason, value, uncertainty, action, evidence, priority, attentionReason };
const db = new DatabaseSync(':memory:');
const host = new EvolutionService(db, new SensitiveData(), () => {});
host.init();
const actual = host.create({ actor: 'user', project }, input);
const initial = { ...data, suggestions: [actual] };
const local = beginDiscussion(initial, { suggestionId: actual.id, baseRevision: actual.revision });
let prepared = 0;
const adopted = await host.adopt(actual.id, actual.revision, async () => {
  prepared++;
});
assert.equal(local.data.suggestions[0].status, adopted.status);
assert.equal(local.data.suggestions[0].revision, adopted.revision);
assert.equal(local.activity.status, 'discussion');
assert.equal(local.activity.grant, undefined);
assert.equal(local.activity.releases.length, 0);
assert.equal(local.data.sessions.find((s) => s.id === local.activity.sessionId).purpose, 'discussion');
assert.equal(beginDiscussion(local.data, { suggestionId: actual.id, baseRevision: 1 }).activity.id, local.activity.id);
await host.adopt(actual.id, 1, async () => {
  prepared++;
});
assert.equal(prepared, 1);
assert.throws(() => beginDiscussion(initial, { suggestionId: actual.id, baseRevision: 999 }));
const ignored = manageSuggestion(local.data, actual.id, 2, 'ignored');
host.manage([{ id: actual.id, baseRevision: 2 }], 'ignored');
assert.equal(ignored.suggestions[0].status, host.get({ actor: 'user' }, actual.id).status);
assert.equal(ignored.suggestions[0].revision, host.get({ actor: 'user' }, actual.id).revision);
assert.throws(() => manageSuggestion(ignored, actual.id, 2, 'archived'));
const independent = beginDiscussion(data, { sessionId: uid(7), goal: '核对研究材料的引用范围' });
assert.equal(independent.activity.project, researchProject);
assert.throws(() => beginDiscussion(data, { sessionId: uid(9999), goal: '未载入会话' }));
const skill = {
  id: uid(701),
  name: 'text-diff',
  project,
  source: '/skills/text-diff',
  enabled: true,
  revision: 8,
  latest: uid(710),
  current: uid(710),
};
const request = { baseRevision: 1, goal: '核对报告指引后再决定修改内容', existingSkills: [skill.id], newSkills: [] };
const authorized = grantDevelopment(local.activity, request, [skill]);
assert.equal(authorized.status, 'preparing');
assert.equal(authorized.grant.targets[0].baseRevision, 8);
assert.equal(activityBusy(authorized), true);
assert.throws(() => grantDevelopment(authorized, request, [skill]));
assert.throws(() => grantDevelopment(local.activity, { ...request, existingSkills: [] }, [skill]));
assert.throws(() => grantDevelopment(local.activity, request, [{ ...skill, project: researchProject }]));
assert.throws(() => grantDevelopment(local.activity, { ...request, newSkills: ['Invalid Slug'] }, [skill]));
assert.throws(() => grantDevelopment(local.activity, { ...request, newSkills: ['text-diff'] }, [skill]));
assert.equal(
  grantDevelopment(local.activity, { ...request, existingSkills: [], newSkills: ['release-report'] }, [skill]).grant
    .targets[0].skillId,
  undefined,
);
const stress = createStressFixtures(data, 240);
assert.equal(stress.memories.length, data.memories.length + 240);
assert.equal(new Set(stress.memories.map((m) => m.current.id)).size, stress.memories.length);
for (const s of stress.suggestions) {
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
for (const { current: m } of stress.memories)
  memoryContent.parse({ title: m.title, content: m.content, scope: m.scope, kind: m.kind });
for (const a of stress.activities) if (a.result) activityResult.parse(a.result);
assert.ok(stress.reflections.some((r) => r.job.status === 'failed' && r.record?.summary));
db.close();
console.log(
  JSON.stringify({
    discussion: 'compared with current EvolutionService',
    revisionAndGrant: 'passed',
    longData: {
      memories: stress.memories.length,
      reflections: stress.reflections.length,
      suggestions: stress.suggestions.length,
    },
  }),
);
