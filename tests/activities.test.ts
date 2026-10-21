import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { startHost } from '../apps/host/transport/server.js';
import type { ActivityResult } from '../apps/host/evolution/activities.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'd4-activities-')),
    dataDir = join(root, 'data'),
    key = randomBytes(32),
    token = randomBytes(32).toString('hex');
  const host = await startHost({ dataDir, key, token });
  const fake = fauxProvider({
    models: [{ id: 'd4-test', contextWindow: 100000, maxTokens: 1024 }],
    tokensPerSecond: 100000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);
  const session = await host.service.create(root, fake.provider.id, 'd4-test');
  const wait = async (check: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 20000;
    while (!(await check())) {
      assert.ok(Date.now() < deadline, 'activity timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const turn = async (id: string, name: string, args: Parameters<typeof fauxToolCall>[1]) => {
    fake.setResponses([
      fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' }),
      fauxAssistantMessage('done'),
    ]);
    await host.service.prompt(id, 'Continue the capability task.');
    await wait(async () => !(await host.service.viewSession(id)).busy);
    return host.service.viewSession(id);
  };
  const start = async (newSkills: string[], existingSkills: string[] = []) => {
    const a = await host.service.createActivity(session.id, 'Develop the authorized text capability');
    fake.setResponses([fauxAssistantMessage('I will investigate the authorized goal.')]);
    const granted = await host.service.authorizeActivity(a.id, {
      baseRevision: 1,
      goal: a.goal,
      newSkills,
      existingSkills,
    });
    await wait(async () => !(await host.service.viewSession(a.sessionId)).busy);
    return granted;
  };
  return {
    root,
    dataDir,
    key,
    token,
    host,
    fake,
    session,
    wait,
    turn,
    start,
    close: async () => {
      await host.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
async function candidate(directory: string, name: string, prefix: string, bad = false) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Compare text with the ${name} native Tool.\n---\nUse tool_search to discover ${name.replaceAll('-', '_')}.\n`,
  );
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', private: true, pi: { skills: ['SKILL.md'], extensions: ['tool.js'] } }),
  );
  await writeFile(
    join(directory, 'tool.js'),
    `import {Type} from 'typebox'; export default function(pi){${bad ? "throw new Error('invalid extension');" : ''} pi.registerTool({name:'${name.replaceAll('-', '_')}',label:'Text',description:'Return text',exposure:'deferred',parameters:Type.Object({text:Type.String()}),async execute(_id,p){return {content:[{type:'text',text:${JSON.stringify(prefix)}+p.text}],details:{}};}});}`,
  );
}
function result(target: string, tool: string, expectedText: string): ActivityResult {
  return {
    summary: 'Implemented and tested the authorized capability',
    packages: [
      {
        target,
        skillFile: 'SKILL.md',
        extensions: ['tool.js'],
        knowledgeFiles: [],
        probes: [{ tool, args: { text: 'sample' }, expectedText }],
      },
    ],
  };
}
test('user goal -> read-only discussion -> authorization -> native candidate checks -> automatic version -> normal Tool use -> improve -> rollback -> restart', async () => {
  const f = await fixture();
  try {
    const a = await f.host.service.createActivity(f.session.id, 'Create a reusable comparison capability');
    const unauthorized = await f.turn(a.sessionId, 'write', {
      path: join(f.root, 'unauthorized.txt'),
      content: 'must not write',
    });
    assert.ok(unauthorized.messages.some((m) => m.role === 'toolResult' && m.isError));
    await assert.rejects(readFile(join(f.root, 'unauthorized.txt')));
    f.fake.setResponses([fauxAssistantMessage('Investigating')]);
    const granted = await f.host.service.authorizeActivity(a.id, {
      baseRevision: 1,
      goal: a.goal,
      newSkills: ['text-compare'],
      existingSkills: [],
    });
    await f.wait(async () => !(await f.host.service.viewSession(a.sessionId)).busy);
    const target = granted.grant!.targets[0]!;
    // Native write boundary enforces granted directories, including symlink resolution.
    const outside = await f.turn(a.sessionId, 'write', { path: join(f.root, 'outside.txt'), content: 'denied' });
    assert.ok(outside.messages.some((m) => m.role === 'toolResult' && m.isError));
    await assert.rejects(readFile(join(f.root, 'outside.txt')));
    await candidate(target.directory, target.name, 'v1:');
    await f.turn(a.sessionId, 'evolution_complete', result(target.key, 'text_compare', 'v1:sample'));
    await f.wait(() => f.host.service.activities.get(a.id).status !== 'checking');
    const completed = f.host.service.activities.get(a.id);
    assert.equal(completed.status, 'completed', completed.error ?? 'activity did not complete');
    const skill = f.host.service.skills.record(completed.releases[0]!.skillId),
      v1 = skill.current!;
    assert.ok(f.host.service.skills.version(v1).evolution);
    assert.equal(f.host.service.skills.version(v1).review, undefined, 'must not forge D2 human review');
    const used = await f.turn(f.session.id, 'text_compare', { text: 'ordinary' });
    // Deferred tools must first be discovered via Pi tool_search.
    assert.ok(used.messages.some((m) => m.role === 'toolResult' && m.isError));
    await f.turn(f.session.id, 'tool_search', { query: 'text_compare', limit: 5 });
    const called = await f.turn(f.session.id, 'text_compare', { text: 'ordinary' });
    assert.match(JSON.stringify(called.messages.at(-2)), /v1:ordinary/);
    const b = await f.start([], [skill.id]),
      bt = b.grant!.targets[0]!;
    await candidate(bt.directory, bt.name, 'v2:');
    await f.turn(b.sessionId, 'evolution_complete', result(bt.key, 'text_compare', 'v2:sample'));
    await f.wait(() => f.host.service.activities.get(b.id).status !== 'checking');
    assert.equal(
      f.host.service.activities.get(b.id).status,
      'completed',
      f.host.service.activities.get(b.id).error ?? 'activity did not complete',
    );
    const v2 = f.host.service.skills.record(skill.id).current!;
    assert.notEqual(v1, v2);
    const rollback = f.host.service.skills.publish(skill.id, v1, f.host.service.skills.record(skill.id).revision);
    await f.host.service.skills.settled();
    assert.equal(f.host.service.skills.operation(rollback.id).status, 'applied');
    assert.equal(f.host.service.skills.record(skill.id).current, v1);
    const saved = await readFile(join(f.dataDir, 'sessions', a.sessionId + '.enc'), 'utf8');
    assert.ok(!saved.includes('Create a reusable'));
    await f.host.close();
    const restarted = await startHost({ dataDir: f.dataDir, key: f.key, token: f.token });
    try {
      await restarted.service.skills.verify(restarted.service.skills.version(v1));
      assert.equal(restarted.service.activities.get(a.id).status, 'completed');
    } finally {
      await restarted.close();
    }
  } finally {
    await f.close().catch(() => {});
  }
});
test('failed development, invalid candidate, cancellation, out-of-scope submission, no-code results preserve a formal capability', async () => {
  const f = await fixture();
  try {
    const a = await f.start(['stable-tool']),
      target = a.grant!.targets[0]!;
    await candidate(target.directory, target.name, 'stable:');
    await f.turn(a.sessionId, 'evolution_complete', result(target.key, 'stable_tool', 'stable:sample'));
    await f.wait(() => f.host.service.activities.get(a.id).status !== 'checking');
    assert.equal(
      f.host.service.activities.get(a.id).status,
      'completed',
      f.host.service.activities.get(a.id).error ?? 'activity did not complete',
    );
    const id = f.host.service.activities.get(a.id).releases[0]!.skillId,
      current = f.host.service.skills.record(id).current;
    const failed = await f.start([], [id]),
      ft = failed.grant!.targets[0]!;
    await candidate(ft.directory, ft.name, 'bad:', true);
    await f.turn(failed.sessionId, 'evolution_complete', result(ft.key, 'stable_tool', 'bad:sample'));
    await f.wait(() => f.host.service.activities.get(failed.id).status !== 'checking');
    assert.equal(f.host.service.activities.get(failed.id).status, 'failed');
    assert.equal(f.host.service.skills.record(id).current, current);
    // A failed latest candidate remains inspectable; use a separate new target for further checks.
    const cancelled = await f.start(['cancelled-tool']);
    await f.host.service.cancelActivity(cancelled.id);
    const postCancel = await f.turn(cancelled.sessionId, 'write', {
      path: join(cancelled.grant!.targets[0]!.directory, 'x'),
      content: 'denied',
    });
    assert.ok(postCancel.messages.some((m) => m.role === 'toolResult' && m.isError));
    assert.equal(f.host.service.activities.get(cancelled.id).status, 'cancelled');
    const empty = await f.start(['investigated-tool']);
    const scope = await f.turn(empty.sessionId, 'evolution_complete', result('other-target', 'other_tool', 'no'));
    assert.ok(scope.messages.some((m) => m.role === 'toolResult' && m.isError));
    assert.equal(f.host.service.activities.get(empty.id).status, 'running');
    await f.turn(empty.sessionId, 'evolution_complete', {
      summary: 'Evidence disproved the need; no implementation is appropriate.',
      packages: [],
    });
    await f.wait(() => f.host.service.activities.get(empty.id).status === 'completed');
    assert.equal(f.host.service.skills.record(id).current, current);
    // A failed first publication leaves a draft that the user can explicitly authorize for repair.
    const draftActivity = await f.start(['repairable-tool']),
      draftTarget = draftActivity.grant!.targets[0]!;
    await candidate(draftTarget.directory, draftTarget.name, 'broken:', true);
    await f.turn(
      draftActivity.sessionId,
      'evolution_complete',
      result(draftTarget.key, 'repairable_tool', 'broken:sample'),
    );
    await f.wait(() => f.host.service.activities.get(draftActivity.id).status !== 'checking');
    assert.equal(f.host.service.activities.get(draftActivity.id).status, 'failed');
    const draft = f.host.service.skills.records().find((s) => s.name === 'repairable-tool')!;
    assert.equal(draft.current, undefined);
    const repair = await f.start([], [draft.id]),
      repairTarget = repair.grant!.targets[0]!;
    await candidate(repairTarget.directory, repairTarget.name, 'repaired:');
    await f.turn(
      repair.sessionId,
      'evolution_complete',
      result(repairTarget.key, 'repairable_tool', 'repaired:sample'),
    );
    await f.wait(() => f.host.service.activities.get(repair.id).status !== 'checking');
    assert.equal(f.host.service.activities.get(repair.id).status, 'completed');
    assert.ok(f.host.service.skills.record(draft.id).current);
    assert.equal(f.host.service.skills.version(f.host.service.skills.record(draft.id).current!).review, undefined);
    assert.equal(f.host.service.skills.record(id).current, current);
    await f.turn(f.session.id, 'tool_search', { query: 'stable_tool', limit: 5 });
    const healthy = await f.turn(f.session.id, 'stable_tool', { text: 'healthy' });
    assert.match(JSON.stringify(healthy.messages), /stable:healthy/);
    const r = await fetch(`${f.host.origin}/api/activities/${empty.id}/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 401);
  } finally {
    await f.close();
  }
});

test('active native Shell cancellation, failed Provider, frozen grant and restart do not publish unfinished work', async () => {
  const f = await fixture();
  try {
    const a = await f.start(['cancel-running']),
      directory = a.grant!.targets[0]!.directory;
    const grantId = a.grant!.id;
    await assert.rejects(
      f.host.service.authorizeActivity(a.id, {
        baseRevision: a.revision,
        goal: 'expand scope',
        existingSkills: [],
        newSkills: ['unrelated'],
      }),
    );
    assert.equal(f.host.service.activities.get(a.id).grant?.id, grantId);
    f.fake.setResponses([
      fauxAssistantMessage(fauxToolCall('bash', { command: `touch '${directory}/started'; sleep 30` }), {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('done'),
    ]);
    await f.host.service.prompt(a.sessionId, 'Run the authorized experiment.');
    await f.wait(async () => {
      try {
        await readFile(join(directory, 'started'));
        return true;
      } catch {
        return false;
      }
    });
    await f.host.service.cancelActivity(a.id);
    assert.equal(f.host.service.activities.get(a.id).status, 'cancelled');
    assert.equal(f.host.service.activities.get(a.id).releases.length, 0);
    assert.equal(f.host.service.skills.records().length, 0);
    const b = await f.start(['provider-failure']);
    f.fake.setResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'injected provider failure' })]);
    await f.host.service.prompt(b.sessionId, 'Continue investigation.');
    await f.wait(async () => !(await f.host.service.viewSession(b.sessionId)).busy);
    assert.equal(f.host.service.activities.get(b.id).status, 'failed');
    const c = await f.start(['interrupted-work']);
    await f.host.close();
    const restarted = await startHost({ dataDir: f.dataDir, key: f.key, token: f.token });
    try {
      assert.equal(restarted.service.activities.get(c.id).status, 'interrupted');
      assert.equal(restarted.service.skills.records().length, 0);
      assert.equal((await restarted.service.viewSession(c.sessionId)).busy, false);
    } finally {
      await restarted.close();
    }
  } finally {
    await f.close().catch(() => {});
  }
});

test('an existing multi-Skill package evolves only its selected Skill; disabled state, sibling Tools and human trust remain intact', async () => {
  const f = await fixture();
  try {
    const { skillPackage, bindings, echoCode } = await import('./fixtures/skills-package.js');
    const source = join(f.root, 'multi');
    await skillPackage(source);
    const imported = await f.host.service.skills.import({ source, project: f.root, bindings });
    for (const r of imported) {
      const v = f.host.service.skills.version(r.latest);
      await f.host.service.skills.review(
        r.id,
        v.id,
        v.digest,
        'Reviewed local test fixture, SDK aliases and independent extension ownership.',
      );
      const op = f.host.service.skills.publish(r.id, v.id, r.revision);
      await f.host.service.skills.settled();
      assert.equal(f.host.service.skills.operation(op.id).status, 'applied');
    }
    const selected = imported.find((r) => r.name === 'echo')!,
      sibling = imported.find((r) => r.name === 'other')!;
    const siblingBefore = f.host.service.skills.record(sibling.id);
    const disable = f.host.service.skills.publish(
      selected.id,
      f.host.service.skills.record(selected.id).current!,
      f.host.service.skills.record(selected.id).revision,
      false,
    );
    await f.host.service.skills.settled();
    assert.equal(f.host.service.skills.operation(disable.id).status, 'applied');
    const a = await f.start([], [selected.id]),
      t = a.grant!.targets[0]!;
    await writeFile(join(t.directory, 'extensions/echo.js'), echoCode('evolved'));
    await f.turn(a.sessionId, 'evolution_complete', {
      summary: 'Improve the selected echo only',
      packages: [
        {
          target: t.key,
          skillFile: bindings[0]!.skill,
          extensions: bindings[0]!.extensions,
          probes: [{ tool: 'skill_echo', args: { value: 'sample' }, expectedText: 'evolved:sample' }],
        },
      ],
    });
    await f.wait(() => f.host.service.activities.get(a.id).status !== 'checking');
    assert.equal(
      f.host.service.activities.get(a.id).status,
      'completed',
      f.host.service.activities.get(a.id).error ?? 'not completed',
    );
    assert.equal(f.host.service.skills.record(selected.id).enabled, false);
    assert.deepEqual(f.host.service.skills.record(sibling.id), siblingBefore);
    const used = await f.turn(f.session.id, 'skill_other', {});
    assert.match(JSON.stringify(used.messages), /other-ok/);
    const current = f.host.service.skills.record(selected.id).current!;
    const version = f.host.service.skills.version(current);
    assert.equal(version.review, undefined);
    assert.ok(version.evolution);
    await writeFile(join(f.host.service.skills.packagePath(version), 'extensions/echo.js'), echoCode('tampered'));
    await assert.rejects(f.host.service.skills.verify(version), /改变/);
  } finally {
    await f.close();
  }
});
