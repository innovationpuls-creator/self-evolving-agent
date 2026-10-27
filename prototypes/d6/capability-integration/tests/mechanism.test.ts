import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { startHost } from '../../../../apps/host/transport/server';
import type { SkillOperation, SkillRecord } from '../../../../apps/host/skills/skills';
import type { EvolutionSuggestion } from '../../../../apps/host/evolution/evolution';
import type { EvolutionActivity } from '../../../../apps/host/evolution/activities';
import { bindings, echoCode, skillPackage } from '../../../../tests/fixtures/skills-package';

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

test('isolated formal Host: Skill, Tool, Suggestion and Activity boundaries', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'd6-capability-mechanism-'));
  const dataDir = join(root, 'data');
  const key = randomBytes(32),
    token = randomBytes(32).toString('hex');
  let host = await startHost({ dataDir, key, token });
  const fake = fauxProvider({
    models: [{ id: 'capability-test', contextWindow: 100000, maxTokens: 1024 }],
    tokensPerSecond: 100000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);
  const alpha = join(root, 'alpha'),
    beta = join(root, 'beta');
  await mkdir(alpha);
  await mkdir(beta);
  const first = await host.service.create(alpha, fake.provider.id, 'capability-test');
  const second = await host.service.create(alpha, fake.provider.id, 'capability-test');
  const other = await host.service.create(beta, fake.provider.id, 'capability-test');
  const checks: Array<Record<string, unknown>> = [];
  const wait = async (predicate: () => boolean | Promise<boolean>) => {
    const end = Date.now() + 25000;
    while (!(await predicate())) {
      assert.ok(Date.now() < end, 'formal Host operation timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const request = async (path: string, method = 'GET', body?: unknown, authorization = true, origin?: string) => {
    const response = await fetch(`${host.origin}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result: unknown = await response.json();
    checks.push({
      path: path.replaceAll(alpha, '<isolated-alpha>').replaceAll(beta, '<isolated-beta>'),
      method,
      status: response.status,
    });
    return { response, result };
  };
  const postOperation = async (
    record: SkillRecord,
    action: string,
    version = record.latest,
    extra?: Record<string, unknown>,
  ) => {
    const accepted = await request(`/skills/${record.id}/${action}`, 'POST', {
      version,
      baseRevision: record.revision,
      ...extra,
    });
    assert.equal(accepted.response.status, 202);
    const operation = accepted.result as SkillOperation;
    assert.ok(['checking', 'waiting'].includes(operation.status), '202 must expose a pending Operation');
    await wait(() => !['checking', 'waiting'].includes(host.service.skills.operation(operation.id).status));
    const authoritative = await request(`/skills/operations/${operation.id}`);
    return authoritative.result as SkillOperation;
  };
  const turn = async (sessionId: string, name: string, args: Parameters<typeof fauxToolCall>[1]) => {
    fake.setResponses([
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' }),
      fauxAssistantMessage('controlled turn finished'),
    ]);
    await host.service.prompt(sessionId, 'Perform the controlled contract check.');
    await wait(async () => !(await host.service.viewSession(sessionId)).busy);
    return host.service.viewSession(sessionId);
  };
  let skill: SkillRecord | undefined;
  let initialVersion = '',
    secondVersion = '';
  let suggestion: EvolutionSuggestion | undefined;
  let cancelled: EvolutionActivity | undefined;
  let pendingRestart: EvolutionActivity | undefined;
  let partialActivity: EvolutionActivity | undefined;
  let partialSkill: SkillRecord | undefined;
  try {
    await t.test('unreviewed candidates never load and review binds exact version/digest', async () => {
      const imported = await host.service.skills.import({
        source: await skillPackage(join(root, 'package')),
        project: alpha,
        bindings,
      });
      skill = imported.find((record) => record.name === 'echo');
      const record = required(skill),
        version = host.service.skills.version(record.latest);
      initialVersion = version.id;
      assert.equal(record.current, undefined);
      const mismatch = await request(`/skills/${record.id}/review`, 'POST', {
        version: version.id,
        digest: 'incorrect-digest',
        notes: 'Controlled fixture code and dependency review.',
        reviewedCode: true,
        reviewedDependencies: true,
        reviewedPermissions: true,
      });
      assert.equal(mismatch.response.status, 409);
      const failed = await postOperation(record, 'publish');
      assert.equal(failed.status, 'failed');
      assert.equal(host.service.skills.record(record.id).current, undefined);
      const approved = await request(`/skills/${record.id}/review`, 'POST', {
        version: version.id,
        digest: version.digest,
        notes: 'Reviewed isolated fixture SDK aliases, code ownership and in-memory-only tool behavior.',
        reviewedCode: true,
        reviewedDependencies: true,
        reviewedPermissions: true,
      });
      assert.equal(approved.response.status, 200);
      assert.equal(host.service.skills.version(version.id).review?.digest, version.digest);
    });
    await t.test('202 publish becomes applied only after formal checks and current-version commit', async () => {
      const record = host.service.skills.record(required(skill).id);
      const operation = await postOperation(record, 'publish');
      assert.equal(operation.status, 'applied');
      assert.equal(host.service.skills.record(record.id).current, initialVersion);
      assert.equal(host.service.skills.record(record.id).revision, record.revision + 1);
    });
    await t.test('editing creates immutable candidate, invalidates old review and stale edit is 409', async () => {
      const record = host.service.skills.record(required(skill).id);
      const edited = await request(`/skills/${record.id}/edit`, 'POST', {
        baseRevision: record.revision,
        files: [{ path: 'extensions/echo.js', content: echoCode('second') }],
      });
      assert.equal(edited.response.status, 201);
      secondVersion = host.service.skills.record(record.id).latest;
      assert.notEqual(secondVersion, initialVersion);
      assert.equal(host.service.skills.version(secondVersion).review, undefined);
      assert.ok(host.service.skills.version(initialVersion).review);
      const stale = await request(`/skills/${record.id}/edit`, 'POST', {
        baseRevision: record.revision,
        files: [{ path: 'extensions/echo.js', content: echoCode('stale') }],
      });
      assert.equal(stale.response.status, 409);
      assert.equal(host.service.skills.record(record.id).latest, secondVersion);
      const failed = await postOperation(host.service.skills.record(record.id), 'publish');
      assert.equal(failed.status, 'failed');
      assert.equal(host.service.skills.record(record.id).current, initialVersion);
    });
    await t.test(
      'reviewed new version, legal rollback and enable/disable remain authoritative operations',
      async () => {
        const record = host.service.skills.record(required(skill).id),
          version = host.service.skills.version(secondVersion);
        await host.service.skills.review(
          record.id,
          version.id,
          version.digest,
          'Reviewed second fixture version, pinned aliases, independent ownership and no external writes.',
        );
        assert.equal((await postOperation(record, 'publish')).status, 'applied');
        assert.equal(host.service.skills.record(record.id).current, secondVersion);
        assert.equal(
          (await postOperation(host.service.skills.record(record.id), 'rollback', initialVersion)).status,
          'applied',
        );
        assert.equal(host.service.skills.record(record.id).current, initialVersion);
        for (const enabled of [false, true]) {
          const before = host.service.skills.record(record.id);
          const accepted = await request(`/skills/${record.id}/enabled`, 'POST', {
            enabled,
            baseRevision: before.revision,
          });
          assert.equal(accepted.response.status, 202);
          const operation = accepted.result as SkillOperation;
          await host.service.skills.settled();
          assert.equal(host.service.skills.operation(operation.id).status, 'applied');
          assert.equal(host.service.skills.record(record.id).enabled, enabled);
        }
      },
    );
    await t.test('descriptive Knowledge is independently revisioned without changing executable version', async () => {
      const record = host.service.skills.record(required(skill).id);
      const saved = await request(`/skills/${record.id}/knowledge`, 'POST', {
        baseRevision: record.revision,
        path: 'skills/echo/notes.md',
        content: 'A descriptive controlled note; it changes no executable capability.',
      });
      assert.equal(saved.response.status, 200);
      const after = host.service.skills.record(record.id);
      assert.equal(after.current, record.current);
      assert.equal(after.latest, record.latest);
      assert.equal(after.revision, record.revision + 1);
      const denied = await request(`/skills/${record.id}/knowledge`, 'POST', {
        baseRevision: after.revision,
        path: 'extensions/echo.js',
        content: echoCode('not-knowledge'),
      });
      assert.equal(denied.response.status, 409);
    });
    await t.test('Tool catalogue proves per-Session membership and isolates another project', async () => {
      await turn(first.id, 'tool_search', { query: 'D2 echo', limit: 5 });
      const catalogue = await host.service.tools(alpha);
      const tool = required(catalogue.tools.find((entry) => entry.name === 'skill_echo'));
      assert.ok(tool.sessions.includes(first.id));
      assert.ok(tool.sessions.includes(second.id));
      assert.ok(!tool.sessions.includes(other.id));
      assert.ok(tool.callableSessions.includes(first.id));
      assert.ok(!tool.activeSessions.includes(second.id), 'loaded does not imply model declaration in another Session');
      assert.ok(!(await host.service.tools(beta)).tools.some((entry) => entry.name === 'skill_echo'));
    });
    await t.test('Suggestion genuine pagination and actor provenance remain distinct from user goals', async () => {
      const input = {
        title: 'Controlled evidence-backed suggestion',
        goal: 'Discuss a capability boundary',
        reason: 'Repeated actual fixture evidence',
        value: 'Make boundary behavior inspectable',
        uncertainty: 'Controlled mechanism, not model discovery',
        action: 'Discuss before authorizing development',
        evidence: [],
        priority: 'normal' as const,
      };
      for (let index = 0; index < 35; index++)
        host.service.evolution.create(
          { actor: 'agent', project: alpha },
          { ...input, title: `${input.title} ${index}` },
        );
      const page1 = host.service.evolution.list({ actor: 'user' }, { project: alpha, limit: 30, offset: 0 });
      const page2 = host.service.evolution.list({ actor: 'user' }, { project: alpha, limit: 30, offset: 30 });
      assert.equal(page1.total, 35);
      assert.equal(page1.items.length, 30);
      assert.equal(page2.items.length, 5);
      assert.ok(page1.items.every((entry) => !page2.items.some((next) => next.id === entry.id)));
      suggestion = required(page1.items[0]);
      const created = await request('/suggestions', 'POST', input);
      assert.equal(created.response.status, 201);
      assert.equal((created.result as EvolutionSuggestion).actor, 'user');
      assert.equal((created.result as EvolutionSuggestion).project, null);
      const forged = await request('/suggestions', 'POST', { ...input, actor: 'agent', project: alpha });
      assert.equal(forged.response.status, 400);
      const ignored = await request('/suggestions/manage', 'POST', {
        items: [{ id: (created.result as EvolutionSuggestion).id, baseRevision: 1 }],
        status: 'ignored',
      });
      assert.equal(ignored.response.status, 200);
      const conflict = await request('/suggestions/manage', 'POST', {
        items: [{ id: (created.result as EvolutionSuggestion).id, baseRevision: 1 }],
        status: 'archived',
      });
      assert.equal(conflict.response.status, 409);
    });
    await t.test('adoption creates a real independent discussion without development permission', async () => {
      const value = required(suggestion);
      const adopted = await request(`/suggestions/${value.id}/adopt`, 'POST', { baseRevision: value.revision });
      assert.equal(adopted.response.status, 200);
      const result = adopted.result as EvolutionSuggestion;
      assert.equal(result.status, 'adopted');
      const sessionId = required(result.discussionSessionId);
      assert.notEqual(sessionId, first.id);
      const activity = required(host.service.activities.forSession(sessionId));
      assert.equal(activity.status, 'discussion');
      assert.equal(activity.grant, undefined);
      assert.equal((await host.service.viewSession(sessionId)).purpose, 'discussion');
      const path = join(root, 'unauthorized-write.txt');
      const denied = await turn(sessionId, 'write', { path, content: 'must not be written' });
      assert.ok(denied.messages.some((entry) => entry.role === 'toolResult' && entry.isError));
      await assert.rejects(readFile(path));
    });
    await t.test(
      'exact Activity grant rejects stale revision, foreign Skill and out-of-target native write',
      async () => {
        const activity = await host.service.createActivity(
          first.id,
          'Inspect only the explicitly authorized candidate',
        );
        const foreignRoot = join(root, 'foreign-plain');
        await mkdir(foreignRoot);
        await writeFile(
          join(foreignRoot, 'SKILL.md'),
          '---\nname: foreign-plain\ndescription: Foreign project controlled instruction.\n---\nOnly a fixture.',
        );
        const foreign = required((await host.service.skills.import({ source: foreignRoot, project: beta }))[0]);
        const forbidden = await request(`/activities/${activity.id}/authorize`, 'POST', {
          baseRevision: activity.revision,
          goal: activity.goal,
          existingSkills: [foreign.id],
          newSkills: [],
        });
        assert.equal(forbidden.response.status, 403);
        const stale = await request(`/activities/${activity.id}/authorize`, 'POST', {
          baseRevision: activity.revision + 1,
          goal: activity.goal,
          existingSkills: [],
          newSkills: ['controlled-scope'],
        });
        assert.equal(stale.response.status, 409);
        fake.setResponses([fauxAssistantMessage('Controlled investigation begins.')]);
        const grant = await request(`/activities/${activity.id}/authorize`, 'POST', {
          baseRevision: activity.revision,
          goal: activity.goal,
          existingSkills: [],
          newSkills: ['controlled-scope'],
        });
        assert.equal(grant.response.status, 202);
        await wait(async () => !(await host.service.viewSession(activity.sessionId)).busy);
        const running = host.service.activities.get(activity.id);
        assert.equal(running.status, 'running');
        assert.equal(running.grant?.targets.length, 1);
        const path = join(root, 'out-of-scope.txt');
        const denied = await turn(activity.sessionId, 'write', { path, content: 'must not be written' });
        assert.ok(denied.messages.some((entry) => entry.role === 'toolResult' && entry.isError));
        await assert.rejects(readFile(path));
        const unauthorizedResult = await turn(activity.sessionId, 'evolution_complete', {
          summary: 'Must reject another target',
          packages: [{ target: 'outside', skillFile: 'SKILL.md', extensions: [], knowledgeFiles: [], probes: [] }],
        });
        assert.ok(unauthorizedResult.messages.some((entry) => entry.role === 'toolResult' && entry.isError));
        assert.equal(host.service.activities.get(activity.id).status, 'running');
        await turn(activity.sessionId, 'evolution_complete', {
          summary: 'Investigation found no justified implementation.',
          packages: [],
        });
        await wait(() => host.service.activities.get(activity.id).status === 'completed');
        const completed = host.service.activities.get(activity.id);
        assert.deepEqual(completed.releases, []);
        assert.ok(!host.service.skills.records().some((record) => record.name === 'controlled-scope'));
      },
    );
    await t.test(
      'partial Activity failure retains already applied release and its exact authorization proof',
      async () => {
        const activity = await host.service.createActivity(first.id, 'Verify actual partial publication receipts');
        fake.setResponses([fauxAssistantMessage('Controlled development begins.')]);
        await host.service.authorizeActivity(activity.id, {
          baseRevision: activity.revision,
          goal: activity.goal,
          existingSkills: [],
          newSkills: ['partial-good', 'partial-bad'],
        });
        await wait(async () => !(await host.service.viewSession(activity.sessionId)).busy);
        const targets = required(host.service.activities.get(activity.id).grant).targets;
        for (const target of targets) {
          await writeFile(
            join(target.directory, 'SKILL.md'),
            `---\nname: ${target.name}\ndescription: Controlled partial publication fixture.\n---\nUse the corresponding deferred tool.`,
          );
          await writeFile(
            join(target.directory, 'package.json'),
            JSON.stringify({
              name: target.name,
              version: '1.0.0',
              private: true,
              pi: { skills: ['SKILL.md'], extensions: ['tool.js'] },
            }),
          );
          await writeFile(
            join(target.directory, 'tool.js'),
            `import {Type} from 'typebox'; export default function(pi){ ${target.name === 'partial-bad' ? "throw new Error('controlled load failure');" : ''} pi.registerTool({name:'${target.name.replaceAll('-', '_')}',label:'Partial fixture',description:'Controlled partial fixture',exposure:'deferred',parameters:Type.Object({}),async execute(){return {content:[{type:'text',text:'controlled-ok'}],details:{}};}});}`,
          );
        }
        await turn(activity.sessionId, 'evolution_complete', {
          summary: 'One valid candidate and one deliberately invalid candidate verify partial publication semantics.',
          packages: targets.map((target) => ({
            target: target.key,
            skillFile: 'SKILL.md',
            extensions: ['tool.js'],
            knowledgeFiles: [],
            probes: [{ tool: target.name.replaceAll('-', '_'), args: {}, expectedText: 'controlled-ok' }],
          })),
        });
        await wait(() => host.service.activities.get(activity.id).status !== 'checking');
        partialActivity = host.service.activities.get(activity.id);
        assert.equal(partialActivity.status, 'failed');
        assert.equal(partialActivity.releases.length, 2);
        const good = required(host.service.skills.records().find((record) => record.name === 'partial-good'));
        const bad = required(host.service.skills.records().find((record) => record.name === 'partial-bad'));
        partialSkill = good;
        assert.ok(good.current);
        assert.equal(bad.current, undefined);
        const release = required(partialActivity.releases.find((entry) => entry.skillId === good.id));
        const operation = host.service.skills.operation(release.operationId);
        assert.equal(operation.status, 'applied');
        assert.equal(operation.evolution?.activityId, activity.id);
        assert.equal(good.current, release.version);
        host.service.activities.assertAdmission(activity.id, good.id, good.current);
        const failedRelease = required(partialActivity.releases.find((entry) => entry.skillId === bad.id));
        assert.equal(host.service.skills.operation(failedRelease.operationId).status, 'failed');
        assert.throws(() => host.service.activities.assertAdmission(activity.id, bad.id, failedRelease.version), {
          status: 403,
        });
      },
    );
    await t.test(
      'cancelled activity cannot write; Host restart marks active activity interrupted without replay',
      async () => {
        cancelled = await host.service.createActivity(first.id, 'Cancel an isolated discussion');
        await host.service.cancelActivity(cancelled.id);
        assert.equal(host.service.activities.get(cancelled.id).status, 'cancelled');
        const path = join(root, 'post-cancel.txt');
        const denied = await turn(cancelled.sessionId, 'write', { path, content: 'must not be written' });
        assert.ok(denied.messages.some((entry) => entry.role === 'toolResult' && entry.isError));
        await assert.rejects(readFile(path));
        pendingRestart = await host.service.createActivity(first.id, 'Leave running only to verify restart semantics');
        fake.setResponses([fauxAssistantMessage('Controlled work remains incomplete.')]);
        await host.service.authorizeActivity(pendingRestart.id, {
          baseRevision: pendingRestart.revision,
          goal: pendingRestart.goal,
          existingSkills: [],
          newSkills: ['restart-only'],
        });
        await wait(async () => !(await host.service.viewSession(required(pendingRestart).sessionId)).busy);
        const priorCurrent = host.service.skills.record(required(skill).id).current;
        await host.close();
        host = await startHost({ dataDir, key, token });
        assert.equal(host.service.activities.get(pendingRestart.id).status, 'interrupted');
        assert.equal(host.service.activities.get(cancelled.id).status, 'cancelled');
        assert.equal(host.service.skills.record(required(skill).id).current, priorCurrent);
        assert.equal(host.service.activities.get(required(partialActivity).id).status, 'failed');
        assert.equal(host.service.skills.record(required(partialSkill).id).current, required(partialSkill).current);
        assert.ok(!host.service.skills.records().some((record) => record.name === 'restart-only'));
        assert.equal((await host.service.viewSession(pendingRestart.sessionId)).busy, false);
      },
    );
    await t.test('real HTTP transport enforces Bearer and Origin independently', async () => {
      assert.equal((await request('/skills', 'GET', undefined, false)).response.status, 401);
      assert.equal((await request('/skills', 'GET', undefined, true, 'http://untrusted.invalid')).response.status, 403);
    });
  } finally {
    await mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
    await writeFile(
      new URL('../evidence/mechanism-requests.json', import.meta.url),
      JSON.stringify(
        {
          mode: 'controlled formal Host, real Pi native tools, isolated encrypted database; no autonomous model assertion',
          requests: checks,
        },
        null,
        2,
      ),
    );
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});
