import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { SkillResourceLoader } from '../apps/host/skill-loader.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { startHost } from '../apps/host/server.js';
import { SkillError, type SkillRecord } from '../apps/host/skills.js';
import { skillPackage, bindings, echoCode } from './fixtures/skills-package.js';
declare global {
  var __skillEvidence:
    | { loads: number; hooks: number; calls: string[]; gate?: Promise<void>; started?: () => void }
    | undefined;
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'd2-skills-')),
    key = randomBytes(32),
    token = randomBytes(32).toString('hex');
  const host = await startHost({ dataDir: join(dir, 'data'), key, token });
  const fake = fauxProvider({
    models: [{ id: 'skill-model', contextWindow: 100000, maxTokens: 512 }],
    tokensPerSecond: 100000,
  });
  host.service.runtime.registerNativeProvider(fake.provider);
  const s = await host.service.create(dir, fake.provider.id, 'skill-model');
  const skills = host.service.skills;
  const wait = async (check: () => boolean | Promise<boolean>) => {
    const end = Date.now() + 15000;
    while (!(await check())) {
      assert.ok(Date.now() < end, 'timed out');
      await new Promise((ok) => setTimeout(ok, 10));
    }
  };
  const publish = async (r: SkillRecord, version = r.latest, enabled?: boolean) => {
    const op = skills.publish(r.id, version, skills.record(r.id).revision, enabled);
    await wait(() => !['checking', 'waiting'].includes(skills.operation(op.id).status));
    const result = skills.operation(op.id);
    return result;
  };
  const review = async (r: SkillRecord, version = r.latest) => {
    const v = skills.version(version);
    await skills.review(
      r.id,
      v.id,
      v.digest,
      'Reviewed fixture code, no dependencies beyond pinned SDK and TypeBox, only in-memory test evidence.',
    );
  };
  const prompt = async (calls: Array<[string, Parameters<typeof fauxToolCall>[1]]>, id = s.id) => {
    fake.setResponses([
      ...calls.map(([name, args]) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })),
      fauxAssistantMessage('done'),
    ]);
    await host.service.prompt(id, 'Use the requested capability.');
    await wait(async () => !(await host.service.viewSession(id)).busy);
    return host.service.viewSession(id);
  };
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${host.origin}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    dir,
    key,
    token,
    host,
    skills,
    fake,
    s,
    wait,
    publish,
    review,
    prompt,
    request,
    close: async () => {
      await host.close();
      await rm(dir, { recursive: true, force: true });
      globalThis.__skillEvidence = undefined;
    },
  };
}
test('ordinary native discovery, management, edit conflict, disable, rollback and restart', async () => {
  const f = await fixture();
  let closed = false;
  let second: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    const root = join(f.dir, '.pi', 'skills', 'plain');
    await mkdir(root, { recursive: true });
    const original = '---\nname: plain\ndescription: Plain capability for testing discovery.\n---\nRead a local file.';
    await writeFile(join(root, 'SKILL.md'), original);
    assert.ok((await f.skills.discover(f.dir)).discovered.some((s) => s.name === 'plain'));
    const [r] = await f.skills.import({ source: root, project: f.dir });
    assert.ok(r);
    assert.equal((await f.publish(r)).status, 'applied');
    let state = await f.prompt([
      ['read', { path: join(f.skills.packagePath(f.skills.version(r.latest)), 'SKILL.md') }],
    ]);
    assert.ok(JSON.stringify(state.messages).includes('Read a local file.'));
    const edited = await f.skills.edit(r.id, f.skills.record(r.id).revision, [
      { path: 'SKILL.md', content: original.replace('Read a local file.', 'Second instruction.') },
    ]);
    await assert.rejects(f.skills.edit(r.id, r.revision, [{ path: 'SKILL.md', content: 'stale' }]), SkillError);
    assert.equal((await f.publish(edited.skill)).status, 'applied');
    assert.equal((await f.publish(f.skills.record(r.id), r.latest)).status, 'applied');
    assert.equal((await f.publish(f.skills.record(r.id), r.latest, false)).status, 'applied');
    const disabled = await f.prompt([]);
    assert.ok(disabled.id === state.id);
    const command = await f.host.service.prompt(f.s.id, '/skill:plain');
    await f.wait(async () => !(await f.host.service.viewSession(f.s.id)).busy);
    assert.equal(command, undefined);
    await f.host.close();
    closed = true;
    second = await startHost({ dataDir: join(f.dir, 'data'), key: f.key, token: f.token });
    assert.equal(second.service.skills.record(r.id).enabled, false);
    assert.equal(second.service.skills.record(r.id).current, r.latest);
  } finally {
    await second?.close();
    if (!closed) await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
test('unreviewed factories never load; reviewed deferred tool, hooks and sibling isolation block indirect bypass', async () => {
  const f = await fixture();
  globalThis.__skillEvidence = { loads: 0, hooks: 0, calls: [] };
  try {
    const [a, b] = await f.skills.import({ source: await skillPackage(join(f.dir, 'pkg')), bindings });
    assert.ok(a && b);
    assert.equal(globalThis.__skillEvidence.loads, 0);
    assert.equal((await f.publish(a)).status, 'failed');
    assert.equal(globalThis.__skillEvidence.loads, 0);
    await f.review(a);
    await f.review(b);
    assert.equal((await f.publish(a)).status, 'applied');
    assert.equal((await f.publish(b)).status, 'applied');
    const session = Reflect.get(f.host.service, 'active').get(f.s.id).session;
    session.setActiveToolsByName([...session.getActiveToolNames(), 'codemode']);
    const active = await f.prompt([
      ['tool_search', { query: 'D2 echo', limit: 1 }],
      ['skill_echo', { value: 'direct' }],
      ['skill_gateway', { value: 'nested' }],
      ['codemode', { code: "return await tools.skill_echo({value:'code'});" }],
    ]);
    assert.ok(globalThis.__skillEvidence.calls.includes('one:direct'));
    assert.ok(globalThis.__skillEvidence.calls.includes('one:nested'));
    assert.ok(globalThis.__skillEvidence.calls.includes('one:code'));
    assert.equal((await f.publish(f.skills.record(a.id), a.latest, false)).status, 'applied');
    const before = [...globalThis.__skillEvidence.calls],
      hooks = globalThis.__skillEvidence.hooks;
    const disabled = await f.prompt([
      ['tool_search', { query: 'D2 echo', limit: 1 }],
      ['skill_echo', { value: 'denied' }],
      ['skill_gateway', { value: 'nested-denied' }],
      ['codemode', { code: "return await tools.skill_echo({value:'code-denied'});" }],
      ['skill_other', {}],
    ]);
    assert.deepEqual(globalThis.__skillEvidence.calls, before);
    assert.equal(globalThis.__skillEvidence.hooks, hooks);
    assert.ok(JSON.stringify(disabled.messages).includes('other-ok'));
    assert.equal(disabled.id, active.id);
  } finally {
    await f.close();
  }
});
test('content tampering, escaping links, shared bindings, unknown project extensions and review mismatch fail closed', async () => {
  const f = await fixture();
  globalThis.__skillEvidence = { loads: 0, hooks: 0, calls: [] };
  try {
    await mkdir(join(f.dir, '.pi', 'extensions'), { recursive: true });
    await writeFile(
      join(f.dir, '.pi', 'extensions', 'unknown.js'),
      'globalThis.__unknownSkillLoaded=true;export default ()=>{};',
    );
    await f.host.service.create(f.dir, f.fake.provider.id, 'skill-model');
    assert.equal(Reflect.get(globalThis, '__unknownSkillLoaded'), undefined);
    const source = await skillPackage(join(f.dir, 'pkg'));
    await assert.rejects(
      f.skills.import({
        source,
        bindings: [...bindings, { skill: bindings[1]!.skill, extensions: bindings[0]!.extensions }],
      }),
      /共享/,
    );
    const [a] = await f.skills.import({ source, bindings });
    assert.ok(a);
    const v = f.skills.version(a.latest);
    await assert.rejects(f.skills.review(a.id, v.id, 'wrong', 'Sufficient review notes'), /不匹配/);
    await f.review(a);
    await writeFile(join(f.skills.packagePath(v), 'extensions/echo.js'), echoCode('tampered'));
    assert.equal((await f.publish(a)).status, 'failed');
    assert.equal(globalThis.__skillEvidence.loads, 0);
    const linked = join(f.dir, 'linked');
    await mkdir(linked);
    await symlink(source, join(linked, 'outside'));
    await assert.rejects(f.skills.import({ source: linked }), /外部/);
    assert.equal((await f.request(`/skills/${a.id}/files?version=${a.latest}&path=../../outside`)).status, 400);
    const denied = await fetch(`${f.host.origin}/api/skills`);
    assert.equal(denied.status, 401);
  } finally {
    await f.close();
  }
});
test('updates preserve the original Session, drain old execution and FIFO, failed candidate retains last good', async () => {
  const f = await fixture();
  globalThis.__skillEvidence = { loads: 0, hooks: 0, calls: [] };
  try {
    const [a, b] = await f.skills.import({ source: await skillPackage(join(f.dir, 'pkg')), bindings });
    assert.ok(a && b);
    await f.review(a);
    await f.review(b);
    assert.equal((await f.publish(a)).status, 'applied');
    assert.equal((await f.publish(b)).status, 'applied');
    let release!: () => void, started!: () => void;
    globalThis.__skillEvidence.gate = new Promise<void>((ok) => (release = ok));
    const began = new Promise<void>((ok) => (started = ok));
    globalThis.__skillEvidence.started = started;
    f.fake.setResponses([
      fauxAssistantMessage(fauxToolCall('tool_search', { query: 'D2 echo', limit: 1 }), { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxToolCall('skill_echo', { value: 'inflight' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('old done'),
      fauxAssistantMessage('queued one'),
      fauxAssistantMessage('queued two'),
    ]);
    await f.host.service.prompt(f.s.id, 'old running');
    await Promise.race([
      began,
      new Promise((_, fail) => setTimeout(() => fail(new Error('tool did not start')), 5000)),
    ]);
    const edited = await f.skills.edit(a.id, f.skills.record(a.id).revision, [
      { path: 'extensions/echo.js', content: echoCode('two') },
    ]);
    await f.review(edited.skill);
    const op = f.skills.publish(a.id, edited.skill.latest, edited.skill.revision);
    await f.wait(() => !!Reflect.get(f.host.service, 'gate'));
    await f.host.service.prompt(f.s.id, 'FIFO one');
    await f.host.service.prompt(f.s.id, 'FIFO two');
    const action = f.host.service.action(f.s.id, 'thinking', 'off');
    assert.equal(f.skills.record(a.id).current, a.latest);
    release();
    await f.wait(() => f.skills.operation(op.id).status === 'applied');
    await f.wait(async () => {
      const state = await f.host.service.viewSession(f.s.id);
      return !state.busy && JSON.stringify(state.messages).includes('queued two');
    });
    await action;
    const state = await f.host.service.viewSession(f.s.id);
    assert.equal(state.id, f.s.id);
    assert.ok(globalThis.__skillEvidence.calls.includes('one:inflight'));
    const users = state.messages
      .filter((m) => m.role === 'user')
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : m.content
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join(''),
      );
    assert.deepEqual(users, ['old running', 'FIFO one', 'FIFO two']);
    await f.prompt([['skill_echo', { value: 'new' }]]);
    assert.ok(globalThis.__skillEvidence.calls.includes('two:new'));
    assert.equal(f.skills.record(b.id).current, b.latest);
    const bad = await f.skills.edit(a.id, f.skills.record(a.id).revision, [
      {
        path: 'extensions/echo.js',
        content: "throw new Error('candidate initialization failed');export default ()=>{};",
      },
    ]);
    await f.review(bad.skill);
    assert.equal((await f.publish(bad.skill)).status, 'failed');
    assert.equal(f.skills.record(a.id).current, edited.skill.latest);
    await f.prompt([['skill_echo', { value: 'after-failure' }]]);
    assert.ok(globalThis.__skillEvidence.calls.includes('two:after-failure'));
    assert.equal((await f.publish(f.skills.record(a.id), a.latest)).status, 'applied');
    await f.prompt([['skill_echo', { value: 'rolled-back' }]]);
    assert.ok(globalThis.__skillEvidence.calls.includes('one:rolled-back'));
  } finally {
    await f.close();
  }
});
test('knowledge revisions refresh documents without reloading executable runtime and remain independent of rollback', async () => {
  const f = await fixture();
  globalThis.__skillEvidence = { loads: 0, hooks: 0, calls: [] };
  try {
    const [a] = await f.skills.import({ source: await skillPackage(join(f.dir, 'pkg')), bindings });
    assert.ok(a);
    await f.review(a);
    assert.equal((await f.publish(a)).status, 'applied');
    const loads = globalThis.__skillEvidence.loads;
    await f.skills.setKnowledge(
      a.id,
      f.skills.record(a.id).revision,
      'skills/echo/notes.md',
      'Corrected current practice.',
    );
    await f.host.service.refreshSkillKnowledge();
    assert.equal(globalThis.__skillEvidence.loads, loads);
    const paths = await f.skills.resourcePaths(f.dir);
    const skillPath = paths.skillPaths.find((p) => p.includes('/echo/SKILL.md'));
    assert.ok(skillPath);
    assert.equal(await readFile(join(skillPath, '../notes.md'), 'utf8'), 'Corrected current practice.');
    await assert.rejects(
      f.skills.setKnowledge(a.id, f.skills.record(a.id).revision, 'extensions/echo.js', 'no'),
      /独立知识/,
    );
    assert.equal(f.skills.record(a.id).current, a.latest);
    assert.equal((await f.skills.detail(a.id)).knowledge.length, 1);
    const changed = await f.skills.edit(a.id, f.skills.record(a.id).revision, [
      {
        path: 'skills/echo/SKILL.md',
        content: (await f.skills.read(a.id, a.latest, 'skills/echo/SKILL.md')).content + '\nUpdated rule.',
      },
    ]);
    await f.review(changed.skill);
    assert.equal((await f.publish(changed.skill)).status, 'applied');
    assert.equal((await f.publish(f.skills.record(a.id), a.latest)).status, 'applied');
    assert.equal((await f.skills.read(a.id, a.latest, 'skills/echo/notes.md')).content, 'Corrected current practice.');
    await f.skills.setKnowledge(a.id, f.skills.record(a.id).revision, 'skills/echo/notes.md', 'Initial practice note.');
    await f.host.service.refreshSkillKnowledge();
    assert.equal((await f.skills.detail(a.id)).knowledge.length, 2);
    assert.equal((await f.skills.read(a.id, a.latest, 'skills/echo/notes.md')).content, 'Initial practice note.');
  } finally {
    await f.close();
  }
});
test('draft deletions, stale revision recovery, frontmatter and knowledge editor show authoritative content', async () => {
  const f = await fixture();
  try {
    const [a] = await f.skills.import({ source: await skillPackage(join(f.dir, 'pkg')), bindings });
    assert.ok(a);
    await f.review(a);
    assert.equal((await f.publish(a)).status, 'applied');
    await f.skills.setKnowledge(a.id, f.skills.record(a.id).revision, 'skills/echo/notes.md', 'Current knowledge.');
    assert.equal((await f.skills.read(a.id, a.latest, 'skills/echo/notes.md')).content, 'Current knowledge.');
    let draft = await f.skills.prepareDraft(a.id);
    await f.skills.edit(a.id, draft.revision, [{ path: 'remove.md', content: 'remove me' }]);
    await assert.rejects(f.skills.importDraft(a.id, f.skills.record(a.id).revision), /修订/);
    await f.skills.discardDraft(a.id);
    draft = await f.skills.prepareDraft(a.id);
    await rm(join(draft.directory, 'remove.md'));
    await writeFile(
      join(draft.directory, 'skills/echo/SKILL.md'),
      '---\nname: renamed\ndescription: Updated description.\n---\nUpdated instructions.',
    );
    const updated = await f.skills.importDraft(a.id, draft.revision);
    assert.equal(updated.skill.name, 'renamed');
    assert.ok(!updated.files.includes('remove.md'));
    await assert.rejects(
      f.skills.import({ source: join(f.dir, 'pkg'), bindings: [bindings[0]!, bindings[0]!, bindings[1]!] }),
      /重复/,
    );
  } finally {
    await f.close();
  }
});
test('declared dependency closure requires included locked bytes and keeps internal relative links', async () => {
  const f = await fixture();
  try {
    const source = await skillPackage(join(f.dir, 'pkg'));
    const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    pkg.dependencies = { 'dep-fixture': '^1.0.0' };
    await writeFile(join(source, 'package.json'), JSON.stringify(pkg));
    let [a] = await f.skills.import({ source, bindings });
    assert.ok(a);
    await assert.rejects(f.review(a), /依赖/);
    await mkdir(join(source, 'node_modules/dep-fixture'), { recursive: true });
    await mkdir(join(source, 'node_modules/.bin'));
    await writeFile(
      join(source, 'node_modules/dep-fixture/package.json'),
      JSON.stringify({ name: 'dep-fixture', version: '1.0.0' }),
    );
    await writeFile(join(source, 'node_modules/dep-fixture/index.js'), 'export default 1;');
    await symlink('../dep-fixture/index.js', join(source, 'node_modules/.bin/dep-fixture'));
    await writeFile(
      join(source, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/dep-fixture': { version: '1.0.0', integrity: 'fixture-reviewed-bytes' } },
      }),
    );
    [a] = await f.skills.import({ source, bindings });
    assert.ok(a);
    await f.review(a);
    const edit = await f.skills.edit(a.id, a.revision, [{ path: 'skills/echo/notes.md', content: 'revised' }]);
    await f.review(edit.skill);
    await writeFile(
      join(f.skills.packagePath(f.skills.version(edit.skill.latest)), 'node_modules/dep-fixture/index.js'),
      'tampered',
    );
    assert.equal((await f.publish(edit.skill)).status, 'failed');
  } finally {
    await f.close();
  }
});
test('SQL commit and partial reload failures restore all original Sessions; failed restoration blocks until explicit recovery', async () => {
  const f = await fixture();
  try {
    const [a] = await f.skills.import({ source: await skillPackage(join(f.dir, 'pkg')), bindings });
    assert.ok(a);
    await f.review(a);
    assert.equal((await f.publish(a)).status, 'applied');
    const s2 = await f.host.service.create(f.dir, f.fake.provider.id, 'skill-model');
    const live = Reflect.get(f.host.service, 'active') as Map<
      string,
      { session: import('@earendil-works/pi-coding-agent').AgentSession; skillFailed?: boolean }
    >;
    const one = live.get(f.s.id)!,
      two = live.get(s2.id)!,
      original = one.session,
      manager = original.sessionManager;
    const edited = await f.skills.edit(a.id, f.skills.record(a.id).revision, [
      { path: 'extensions/echo.js', content: echoCode('two') },
    ]);
    await f.review(edited.skill);
    const reload = two.session.reload.bind(two.session);
    let calls = 0;
    two.session.reload = async () => {
      calls++;
      if (calls === 1) throw new Error('partial switch');
      await reload();
    };
    assert.equal((await f.publish(edited.skill)).status, 'failed');
    assert.equal(f.skills.record(a.id).current, a.latest);
    assert.equal(one.session, original);
    assert.equal(one.session.sessionManager, manager);
    two.session.reload = reload;
    const db = Reflect.get(f.host.service, 'db') as import('node:sqlite').DatabaseSync;
    db.exec(
      "CREATE TRIGGER reject_skill_commit BEFORE INSERT ON skills BEGIN SELECT RAISE(ABORT,'injected commit failure'); END;",
    );
    assert.equal((await f.publish(f.skills.record(a.id), edited.skill.latest)).status, 'failed');
    assert.equal(f.skills.record(a.id).current, a.latest);
    db.exec('DROP TRIGGER reject_skill_commit');
    two.session.reload = async () => {
      throw new Error('restoration failed');
    };
    assert.equal((await f.publish(f.skills.record(a.id), edited.skill.latest)).status, 'failed');
    assert.equal(two.skillFailed, true);
    await assert.rejects(f.host.service.prompt(s2.id, 'must not run'), /恢复/);
    two.session.reload = reload;
    await f.host.service.recoverSkills(s2.id);
    assert.equal(two.skillFailed, false);
    assert.equal(f.skills.record(a.id).current, a.latest);
  } finally {
    await f.close();
  }
});
test('publication waits for the entire admitted dispatch including its first encrypted save', async () => {
  const f = await fixture();
  try {
    const root = join(f.dir, 'plain');
    await mkdir(root);
    await writeFile(join(root, 'SKILL.md'), '---\nname: plain\ndescription: Plain.\n---\nHello.');
    const [a] = await f.skills.import({ source: root });
    assert.ok(a);
    assert.equal((await f.publish(a)).status, 'applied');
    const live = Reflect.get(f.host.service, 'active').get(f.s.id) as {
      session: import('@earendil-works/pi-coding-agent').AgentSession;
    };
    const write = f.host.service.store.write.bind(f.host.service.store);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((ok) => (release = ok)),
      began = new Promise<void>((ok) => (entered = ok));
    let held = false;
    f.host.service.store.write = async (...args) => {
      if (!held && args[0] === `sessions/${f.s.id}.enc`) {
        held = true;
        entered();
        await gate;
      }
      return write(...args);
    };
    f.fake.setResponses([fauxAssistantMessage('admitted finished')]);
    const dispatch = f.host.service.prompt(f.s.id, 'admitted');
    await began;
    const reload = live.session.reload.bind(live.session);
    let switched = false;
    live.session.reload = async () => {
      assert.ok(JSON.stringify(live.session.messages).includes('admitted finished'));
      switched = true;
      await reload();
    };
    const op = f.skills.publish(a.id, a.latest, f.skills.record(a.id).revision, false);
    await f.wait(() => !!Reflect.get(f.host.service, 'gate'));
    assert.equal(switched, false);
    release();
    await dispatch;
    await f.wait(() => f.skills.operation(op.id).status === 'applied');
    assert.equal(switched, true);
  } finally {
    await f.close();
  }
});
test('native .agents discovery includes ancestors without instantiating project Extensions', async () => {
  const f = await fixture();
  try {
    const dir = join(f.dir, '.agents/skills/ancestor');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: ancestor-native\ndescription: Ancestor native text.\n---\nRead when needed.',
    );
    await mkdir(join(f.dir, 'child'));
    assert.ok((await f.skills.discover(join(f.dir, 'child'))).discovered.some((s) => s.name === 'ancestor-native'));
    await mkdir(join(f.dir, 'child/.pi'), { recursive: true });
    await mkdir(join(f.dir, 'configured'));
    await writeFile(
      join(f.dir, 'configured/SKILL.md'),
      '---\nname: configured-text\ndescription: Configured native text.\n---\nInstructions.',
    );
    await writeFile(
      join(f.dir, 'child/.pi/settings.json'),
      JSON.stringify({
        skills: [join(f.dir, 'configured')],
        extensions: [join(f.dir, 'must-not-load.js')],
        packages: ['npm:must-not-install-d2'],
      }),
    );
    assert.ok((await f.skills.discover(join(f.dir, 'child'))).discovered.some((s) => s.name === 'configured-text'));
    const s = await f.host.service.create(join(f.dir, 'child'), f.fake.provider.id, 'skill-model');
    const item = Reflect.get(f.host.service, 'active').get(s.id);
    assert.ok(item.loader.getSkills().skills.some((s: { name: string }) => s.name === 'ancestor-native'));
  } finally {
    await f.close();
  }
});
test('a damaged formal snapshot can still be disabled to restore operation', async () => {
  const f = await fixture();
  try {
    const [a] = await f.skills.import({ source: await skillPackage(join(f.dir, 'pkg')), bindings });
    assert.ok(a);
    await f.review(a);
    assert.equal((await f.publish(a)).status, 'applied');
    await rm(join(f.skills.packagePath(f.skills.version(a.latest)), 'skills/echo/SKILL.md'));
    assert.equal((await f.publish(f.skills.record(a.id), a.latest, false)).status, 'applied');
    assert.equal(f.skills.record(a.id).enabled, false);
    await f.prompt([]);
  } finally {
    await f.close();
  }
});
test('Host shutdown waits for admitted recovery before disposing Runtime', async () => {
  const f = await fixture();
  let closed = false;
  try {
    const item = Reflect.get(f.host.service, 'active').get(f.s.id) as {
      session: import('@earendil-works/pi-coding-agent').AgentSession;
    };
    const reload = item.session.reload.bind(item.session),
      dispose = item.session.dispose.bind(item.session);
    let disposed = false,
      release!: () => void,
      entered!: () => void;
    const gate = new Promise<void>((ok) => (release = ok)),
      began = new Promise<void>((ok) => (entered = ok));
    item.session.reload = async () => {
      entered();
      await gate;
      assert.equal(disposed, false);
      await reload();
    };
    item.session.dispose = () => {
      disposed = true;
      dispose();
    };
    const recovery = f.host.service.recoverSkills(f.s.id);
    await began;
    const shutdown = f.host.close();
    await new Promise((ok) => setTimeout(ok, 30));
    assert.equal(disposed, false);
    release();
    await recovery;
    await shutdown;
    closed = true;
    assert.equal(disposed, true);
  } finally {
    if (!closed) await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
test('native npm acquisition prepares a locked tree without executing installation scripts', async () => {
  const f = await fixture();
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const root = join(f.dir, 'tar/package');
    await mkdir(root, { recursive: true });
    const marker = join(f.dir, 'install-script-ran');
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'd2-native-npm-fixture',
        version: '1.0.0',
        scripts: { postinstall: `node -e "require('fs').writeFileSync('${marker}','bad')"` },
        pi: { skills: ['SKILL.md'] },
      }),
    );
    await writeFile(
      join(root, 'SKILL.md'),
      '---\nname: npm-fixture\ndescription: Native prepared package.\n---\nText only.',
    );
    const tar = join(f.dir, 'fixture.tgz');
    await exec('tar', ['-czf', tar, '-C', join(f.dir, 'tar'), 'package']);
    const [r] = await f.skills.import({ source: `npm:d2-native-npm-fixture@file:${tar}` });
    assert.ok(r);
    assert.equal(r.name, 'npm-fixture');
    await assert.rejects(readFile(marker));
    const detail = await f.skills.detail(r.id);
    const lock = detail.snapshotFiles.find((p) => p.endsWith('/package-lock.json'));
    assert.ok(lock);
    const read = await f.skills.read(r.id, r.latest, lock, true);
    assert.ok(read.content.includes('d2-native-npm-fixture'));
  } finally {
    await f.close();
  }
});
test('native compaction, selected history branch, model configuration and subscriptions survive a Skill switch', async () => {
  const f = await fixture();
  try {
    const [a] = await f.skills.import({ source: await skillPackage(join(f.dir, 'pkg')), bindings });
    assert.ok(a);
    await f.review(a);
    assert.equal((await f.publish(a)).status, 'applied');
    f.fake.setResponses([fauxAssistantMessage('long first answer')]);
    await f.host.service.prompt(f.s.id, 'first ' + 'historical context '.repeat(4500));
    await f.wait(async () => !(await f.host.service.viewSession(f.s.id)).busy);
    const firstLeaf = (
      Reflect.get(f.host.service, 'active').get(f.s.id)
        .session as import('@earendil-works/pi-coding-agent').AgentSession
    ).sessionManager.getLeafId()!;
    f.fake.setResponses([fauxAssistantMessage('second answer')]);
    await f.host.service.prompt(f.s.id, 'second ' + 'recent context '.repeat(6500));
    await f.wait(async () => !(await f.host.service.viewSession(f.s.id)).busy);
    await f.host.service.action(f.s.id, 'branch', firstLeaf);
    f.fake.setResponses([fauxAssistantMessage('branched answer')]);
    await f.host.service.prompt(f.s.id, 'branched ' + 'recent context '.repeat(6500));
    await f.wait(async () => !(await f.host.service.viewSession(f.s.id)).busy);
    f.fake.setResponses([fauxAssistantMessage('Summary of the branch and earlier context.')]);
    await f.host.service.action(f.s.id, 'compact');
    const item = Reflect.get(f.host.service, 'active').get(f.s.id) as {
      session: import('@earendil-works/pi-coding-agent').AgentSession;
    };
    assert.ok(item.session.sessionManager.getEntries().some((e) => e.type === 'compaction'));
    const native = item.session,
      manager = native.sessionManager,
      leaf = manager.getLeafId(),
      entries = JSON.stringify(manager.getTree()),
      messages = JSON.stringify(native.messages),
      model = native.model,
      thinking = native.thinkingLevel;
    let updates = 0;
    const listener = () => updates++;
    f.host.service.on('event', listener);
    assert.equal((await f.publish(f.skills.record(a.id), a.latest, false)).status, 'applied');
    assert.equal(item.session, native);
    assert.equal(item.session.sessionManager, manager);
    assert.equal(manager.getLeafId(), leaf);
    assert.equal(JSON.stringify(manager.getTree()), entries);
    assert.equal(JSON.stringify(native.messages), messages);
    assert.deepEqual(native.model, model);
    assert.equal(native.thinkingLevel, thinking);
    await f.prompt([]);
    assert.ok(updates > 0);
    f.host.service.off('event', listener);
    const toolNames = item.session.getAllTools().map((t) => t.name);
    assert.ok(!toolNames.includes('skill_echo'));
    assert.ok(item.session.resourceLoader.getSkills().skills.every((s) => s.name !== 'echo'));
  } finally {
    await f.close();
  }
});
test('disabled special Skill stays absent across restart and upgrade while its package sibling remains enabled', async () => {
  const f = await fixture();
  let second: Awaited<ReturnType<typeof startHost>> | undefined,
    closed = false;
  try {
    const source = await skillPackage(join(f.dir, 'pkg'));
    const [a, b] = await f.skills.import({ source, bindings });
    assert.ok(a && b);
    await f.review(a);
    await f.review(b);
    assert.equal((await f.publish(a)).status, 'applied');
    assert.equal((await f.publish(b)).status, 'applied');
    assert.equal((await f.publish(f.skills.record(a.id), a.latest, false)).status, 'applied');
    await f.host.close();
    closed = true;
    second = await startHost({ dataDir: join(f.dir, 'data'), key: f.key, token: f.token });
    second.service.runtime.registerNativeProvider(f.fake.provider);
    await second.service.viewSession(f.s.id);
    const item = Reflect.get(second.service, 'active').get(f.s.id) as {
      session: import('@earendil-works/pi-coding-agent').AgentSession;
    };
    assert.ok(!item.session.getAllTools().some((t) => t.name === 'skill_echo'));
    assert.ok(item.session.getAllTools().some((t) => t.name === 'skill_other'));
    const skills = second.service.skills;
    await writeFile(join(source, 'extensions/echo.js'), echoCode('upgrade'));
    const added = await skills.import({ source, bindings });
    const upgraded = added.find((r) => r.id === a.id)!;
    const v = skills.version(upgraded.latest);
    await skills.review(
      a.id,
      v.id,
      v.digest,
      'Reviewed upgraded fixture; pinned host aliases, no external dependencies or permissions.',
    );
    const op = skills.publish(a.id, v.id, upgraded.revision);
    await f.wait(() => !['checking', 'waiting'].includes(skills.operation(op.id).status));
    assert.equal(skills.operation(op.id).status, 'applied');
    assert.equal(skills.record(a.id).enabled, false);
    assert.ok(!item.session.getAllTools().some((t) => t.name === 'skill_echo'));
    assert.ok(item.session.getAllTools().some((t) => t.name === 'skill_other'));
    assert.equal(skills.record(b.id).current, b.latest);
  } finally {
    await second?.close();
    if (!closed) await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test('resource provenance follows successful native loads and knowledge refresh; failed candidates retain the loaded snapshot', async () => {
  const f = await fixture();
  try {
    const [record] = await f.skills.import({ source: await skillPackage(join(f.dir, 'provenance-package')), bindings });
    assert.ok(record);
    await f.review(record);
    assert.equal((await f.publish(record)).status, 'applied');
    const loader = new SkillResourceLoader(
      f.skills,
      f.dir,
      join(f.dir, 'pi-test'),
      SettingsManager.inMemory({}, { projectTrusted: false }),
    );
    await loader.reload();
    const original = loader.getResourceSources();
    const source = original.find((s) => s.skillId === record.id);
    assert.ok(source);
    assert.equal(source.version, record.latest);
    assert.equal(source.knowledgeRevision, undefined);
    assert.ok(loader.getSkills().skills.some((s) => s.filePath === source.skillPath));
    await f.skills.setKnowledge(
      record.id,
      f.skills.record(record.id).revision,
      'skills/echo/notes.md',
      'Updated provenance note.',
    );
    await loader.refreshSkills();
    const refreshed = loader.getResourceSources();
    const overlay = refreshed.find((s) => s.skillId === record.id);
    assert.ok(overlay?.knowledgeRevision);
    assert.notEqual(overlay.skillPath, source.skillPath);
    assert.ok(loader.getSkills().skills.some((s) => s.filePath === overlay.skillPath));
    assert.equal(source.knowledgeRevision, undefined, 'earlier provenance remains a snapshot');
    const next = f.skills.loadout();
    const version = next.versions.find((v) => v.id === record.latest);
    assert.ok(version);
    version.digest = 'tampered-candidate';
    loader.setLoadout(next);
    await assert.rejects(loader.reload(), /内容或依赖已改变/);
    assert.deepEqual(loader.getResourceSources(), refreshed);
    assert.ok(loader.getSkills().skills.some((s) => s.filePath === overlay.skillPath));
    loader.setLoadout();
    await loader.reload();
    assert.deepEqual(loader.getResourceSources(), refreshed);
  } finally {
    await f.close();
  }
});
