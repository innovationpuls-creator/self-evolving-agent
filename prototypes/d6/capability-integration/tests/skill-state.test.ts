import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SkillOperation, SkillVersion } from '../../../../apps/host/skills/skills';
import { operationApplied, reviewed, SkillDrafts } from '../../src/real/skill-management';

test('publication feedback requires completed Operation and matching authoritative state', () => {
  const operation: SkillOperation = {
    id: 'operation',
    skillId: 'skill',
    status: 'checking',
    message: 'accepted but not applied',
    created: 1,
  };
  const target = { version: 'candidate', enabled: true };
  const expected = { current: 'candidate', enabled: true };
  for (const status of ['checking', 'waiting', 'failed', 'interrupted'] as const)
    assert.equal(operationApplied({ ...operation, status }, expected, target), false);
  const applied = { ...operation, status: 'applied' as const };
  assert.equal(operationApplied(applied, { current: 'previous', enabled: true }, target), false);
  assert.equal(operationApplied(applied, { current: 'candidate', enabled: false }, target), false);
  assert.equal(operationApplied(applied, expected, target), true);
  assert.equal(
    operationApplied(applied, { current: 'candidate', enabled: false }, { version: 'candidate', enabled: false }),
    true,
  );
});

test('executable review cannot carry over after digest or version-content identity changes', () => {
  const version: SkillVersion = {
    id: 'first-version',
    skillId: 'skill',
    snapshot: 'snapshot',
    packageRoot: '.',
    skillFile: 'SKILL.md',
    extensions: ['tool.js'],
    knowledgeFiles: [],
    digest: 'first-digest',
    created: 1,
    review: { digest: 'first-digest', notes: 'reviewed exact initial contents', at: 1 },
  };
  assert.equal(reviewed(version), true);
  assert.equal(reviewed({ ...version, id: 'next-version', digest: 'next-digest' }), false);
  assert.equal(reviewed({ ...version, review: undefined }), false);
  const evolution = { activityId: 'activity', digest: version.digest, checkedAt: 1, probes: [] };
  assert.equal(reviewed({ ...version, review: undefined, evolution }), true);
  assert.equal(reviewed({ ...version, digest: 'changed', review: undefined, evolution }), false);
});

test('navigation draft store retains original version and conflict base independently for each file', () => {
  const drafts = new SkillDrafts();
  drafts.set({
    id: 'skill',
    path: 'first.md',
    baseRevision: 2,
    version: 'old',
    before: 'first',
    content: 'local first',
  });
  drafts.set({ id: 'skill', path: 'second.md', baseRevision: 5, version: 'new', before: 'second', content: null });
  const restored = drafts.get('skill', 'first.md');
  assert.deepEqual(restored, {
    id: 'skill',
    path: 'first.md',
    baseRevision: 2,
    version: 'old',
    before: 'first',
    content: 'local first',
  });
  assert.equal(drafts.get('skill', 'second.md')?.content, null);
  assert.equal(drafts.all('skill').length, 2);
  assert.equal(drafts.all('other').length, 0);
});
