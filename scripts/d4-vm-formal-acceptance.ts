import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { VMIsolatedSkillAdapter } from '../apps/host/evolution/sandbox/isolated-skill-adapter.js';
import { startHost } from '../apps/host/transport/server.js';
import { isolatedCode } from '../tests/fixtures/d4-isolated-skill.js';
const root = await mkdtemp(resolve('release/d4-formal-'));
const key = randomBytes(32),
  token = randomBytes(32).toString('hex');
const adapter = await VMIsolatedSkillAdapter.create({
  helper: resolve('release/d4-execution/bin/d4-vm-owner'),
  observer: resolve('release/d4-execution/bin/d4-vm-observer'),
  work: resolve('release/d4-execution-work'),
});
let host = await startHost({ dataDir: join(root, 'data'), key, token });
const fake = fauxProvider({
  models: [{ id: 'd4-formal', contextWindow: 100000, maxTokens: 512 }],
  tokensPerSecond: 100000,
});
const configure = () => {
  host.service.runtime.registerNativeProvider(fake.provider);
  host.service.skills.setIsolatedAdapter(adapter);
};
configure();
const project = join(root, 'project'),
  source = join(root, 'package'),
  canary = join(root, 'private');
await mkdir(project);
await mkdir(source);
await writeFile(canary, 'private-unchanged');
await writeFile(
  join(source, 'package.json'),
  JSON.stringify({
    name: 'd4-owned-fixture',
    version: '1.0.0',
    private: true,
    pi: { skills: ['SKILL.md'], extensions: ['extension.mjs'] },
  }),
);
await writeFile(
  join(source, 'SKILL.md'),
  '---\nname: d4-fixture\ndescription: D4 isolated fixture echo.\n---\nDiscover d4_echo with tool_search and use it.',
);
await writeFile(join(source, 'extension.mjs'), isolatedCode('v1', canary));
const session = await host.service.create(project, fake.provider.id, 'd4-formal');
const skills = host.service.skills;
const receipt: Record<string, unknown> = {
  admission: false,
  executionCompleted: false,
  root,
  runtimeDigest: adapter.runtimeDigest,
  checks: [],
};
const checks = receipt.checks as unknown[];
const wait = async (check: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 90000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'formal timeout');
    await delay(20);
  }
};
const publish = async (id: string, version: string, enabled?: boolean) => {
  const op = host.service.skills.publish(id, version, host.service.skills.record(id).revision, enabled);
  await wait(() => !['checking', 'waiting'].includes(host.service.skills.operation(op.id).status));
  const result = host.service.skills.operation(op.id);
  checks.push({ publish: result });
  return result;
};
const prompt = async (calls: Array<[string, Parameters<typeof fauxToolCall>[1]]>) => {
  fake.setResponses([
    ...calls.map(([name, args]) => fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' })),
    fauxAssistantMessage('done'),
  ]);
  await host.service.prompt(session.id, 'Use the authorized isolated capability.');
  await wait(async () => !(await host.service.viewSession(session.id)).busy);
  const state = await host.service.viewSession(session.id);
  return { ...state, messages: state.messages.filter((m) => m.role === 'toolResult') };
};
try {
  const [record] = await skills.import({
    source,
    project,
    bindings: [{ skill: 'SKILL.md', extensions: ['extension.mjs'] }],
    execution: { kind: 'd4-vm-v1', permissionProfile: 'd4-data-only-v1', runtimeDigest: adapter.runtimeDigest },
  });
  assert.ok(record);
  assert.equal((await publish(record.id, record.latest)).status, 'applied');
  assert.equal(skills.version(record.latest).review, undefined);
  const native = Reflect.get(host.service, 'active').get(session.id).session;
  native.setActiveToolsByName([...native.getActiveToolNames(), 'codemode']);
  let state = await prompt([
    ['tool_search', { query: 'D4 isolated echo', limit: 1 }],
    ['d4_echo', { text: 'direct' }],
    ['d4_nested', {}],
    ['codemode', { code: "return await tools.d4_echo({text:'code'});" }],
  ]);
  checks.push({ firstSession: state });
  assert.match(JSON.stringify(state.messages), /v1:direct\|hook/);
  assert.match(JSON.stringify(state.messages), /v1:code\|hook/);
  const direct = state.messages.find((m) => m.role === 'toolResult' && m.toolName === 'd4_echo');
  const nested = state.messages.find((m) => m.role === 'toolResult' && m.toolName === 'd4_nested');
  assert.ok(direct);
  assert.ok(nested);
  assert.deepEqual(direct.content, [{ type: 'text', text: 'v1:direct|hook' }]);
  assert.deepEqual(direct.details, { version: 'v1', starts: 1, calls: 1, results: 0 });
  assert.deepEqual(nested.details, { version: 'v1', starts: 1, calls: 3, results: 1 });
  assert.equal((globalThis as Record<string, unknown>).__d4UnknownInHost, undefined);
  assert.equal(await readFile(canary, 'utf8'), 'private-unchanged');
  state = await prompt([['d4_echo', { text: 'hook-block' }]]);
  assert.match(JSON.stringify(state.messages.at(-1)), /D4_HOOK_BLOCKED/);
  assert.doesNotMatch(JSON.stringify(state.messages.at(-1)), /D4_BLOCKED_EXECUTE_RAN/);
  checks.push({ hookBlockedExecution: true });
  for (const [text, api] of [
    ['deny-model', 'modelRegistry'],
    ['deny-prompt', 'getSystemPrompt'],
  ] as const) {
    state = await prompt([['d4_echo', { text }]]);
    assert.match(JSON.stringify(state.messages.at(-1)), new RegExp('isolated_api_unsupported:' + api));
  }
  state = await prompt([['d4_echo', { text: 'deny-bash' }]]);
  checks.push({ deniedBash: state });
  assert.match(JSON.stringify(state.messages), /isolated_api_unsupported:executeTool:bash/);
  state = await prompt([['d4_echo', { text: 'after-failure' }]]);
  const recovered = state.messages.at(-1);
  checks.push({ recovered });
  assert.match(JSON.stringify(recovered), /"starts":1/);
  state = await prompt([
    ['d4_echo', { text: 'deny-context' }],
    ['d4_echo', { text: 'same-turn-retry' }],
  ]);
  checks.push({ sameTurnRetry: state.messages.slice(-2) });
  assert.match(JSON.stringify(state.messages.at(-1)), /"starts":1/);
  state = await prompt([['d4_echo', { text: 'deny-read', target: canary }]]);
  assert.match(JSON.stringify(state.messages.at(-1)), /ENOENT/);
  await prompt([['d4_echo', { text: 'detached' }]]);
  const detached = adapter.observations.at(-1)!;
  assert.ok(
    detached.events.some((e) => String((e as { stderr?: string }).stderr).includes('D4_DETACHED_HEARTBEAT_CONFIRMED')),
  );
  await host.service.stop(session.id);
  assert.ok(detached.events.some((e) => (e as { kind?: string }).kind === 'externalVMGone'));
  checks.push({ detachedAfterToolReturnDestroyed: detached.activity });
  const v2 = await skills.edit(record.id, skills.record(record.id).revision, [
    { path: 'extension.mjs', content: isolatedCode('v2', canary) },
  ]);
  fake.setResponses([
    fauxAssistantMessage(fauxToolCall('d4_echo', { text: 'slow' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('done'),
  ]);
  await host.service.prompt(session.id, 'Call slow echo.');
  await wait(
    () =>
      adapter.observations
        .at(-1)
        ?.events.some((e) => String((e as { stderr?: string }).stderr).includes('D4_FIXTURE_TOOL_ENTERED:v1:slow')) ??
      false,
  );
  assert.equal((await publish(record.id, v2.skill.latest)).status, 'applied');
  assert.match(JSON.stringify((await host.service.viewSession(session.id)).messages), /v1:slow/);
  checks.push({ inflightV1DrainedBeforeV2: true });
  state = await prompt([
    ['tool_search', { query: 'D4 isolated echo', limit: 1 }],
    ['d4_echo', { text: 'second' }],
  ]);
  checks.push({ v2: state });
  assert.match(JSON.stringify(state.messages), /v2:second\|hook/);
  assert.equal((await publish(record.id, record.latest)).status, 'applied');
  const db = Reflect.get(host.service, 'db') as import('node:sqlite').DatabaseSync;
  db.exec(
    "CREATE TRIGGER reject_d4_commit BEFORE INSERT ON skills BEGIN SELECT RAISE(ABORT,'D4 commit fixture'); END;",
  );
  assert.equal((await publish(record.id, v2.skill.latest)).status, 'failed');
  db.exec('DROP TRIGGER reject_d4_commit');
  assert.equal(skills.record(record.id).current, record.latest);
  state = await prompt([['d4_echo', { text: 'commit-restored' }]]);
  assert.match(JSON.stringify(state.messages.at(-1)), /v1:commit-restored\|hook/);
  checks.push({ commitFailureRestoredV1: true });
  const bad = await skills.edit(record.id, skills.record(record.id).revision, [
    { path: 'extension.mjs', content: 'export default pi=>pi.registerProvider("forbidden",{});' },
  ]);
  assert.equal((await publish(record.id, bad.skill.latest)).status, 'failed');
  assert.equal(skills.record(record.id).current, record.latest);
  state = await prompt([['d4_echo', { text: 'initialization-restored' }]]);
  assert.match(JSON.stringify(state.messages.at(-1)), /v1:initialization-restored\|hook/);
  fake.setResponses([
    fauxAssistantMessage(fauxToolCall('d4_echo', { text: 'hang' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('done'),
  ]);
  await host.service.prompt(session.id, 'Start the hanging Tool.');
  await wait(
    () =>
      adapter.observations
        .at(-1)
        ?.events.some((e) => String((e as { stderr?: string }).stderr).includes('D4_FIXTURE_TOOL_ENTERED:v1:hang')) ??
      false,
  );
  const toolOwner = adapter.observations.at(-1)!;
  const toolCancelStart = performance.now();
  await host.service.stop(session.id);
  assert.ok(performance.now() - toolCancelStart < 10000);
  assert.ok(toolOwner.events.some((e) => (e as { kind?: string }).kind === 'externalVMGone'));
  checks.push({ hangingToolCancelledMs: performance.now() - toolCancelStart });
  const hanging = await skills.edit(record.id, skills.record(record.id).revision, [
    {
      path: 'extension.mjs',
      content: isolatedCode('hook-hang', canary).replace('starts++;', 'starts++;await new Promise(()=>{});'),
    },
  ]);
  assert.equal((await publish(record.id, hanging.skill.latest)).status, 'applied');
  fake.setResponses([fauxAssistantMessage('unreachable')]);
  await host.service.prompt(session.id, 'Start the isolated hook.');
  await delay(150);
  const hookOwner = adapter.observations.at(-1)!;
  const cancelStart = performance.now();
  await host.service.stop(session.id);
  assert.ok(performance.now() - cancelStart < 10000);
  assert.ok(hookOwner.events.some((e) => (e as { kind?: string }).kind === 'externalVMGone'));
  checks.push({ hangingHookCancelledMs: performance.now() - cancelStart });
  assert.equal((await publish(record.id, record.latest)).status, 'applied');
  await host.close();
  host = await startHost({ dataDir: join(root, 'data'), key, token });
  configure();
  state = await prompt([
    ['tool_search', { query: 'D4 isolated echo', limit: 1 }],
    ['d4_echo', { text: 'restart' }],
  ]);
  checks.push({ restart: state });
  assert.match(JSON.stringify(state.messages), /v1:restart\|hook/);
  assert.equal((await publish(record.id, record.latest, false)).status, 'applied');
  checks.push({ disabled: await host.service.viewSession(session.id) });
  state = await prompt([['d4_echo', { text: 'disabled' }]]);
  assert.doesNotMatch(JSON.stringify(state.messages.at(-1)), /v1:disabled/);
  await host.close();
  host = await startHost({ dataDir: join(root, 'data'), key, token });
  configure();
  state = await prompt([['d4_echo', { text: 'disabled-restart' }]]);
  assert.doesNotMatch(JSON.stringify(state.messages.at(-1)), /v1:disabled-restart/);
  checks.push({ disabledAfterRestart: true });
  // Fixed, owned adversarial fixture: demonstrate the normal Session bypass,
  // without ever importing unknown code into the Host application's process.
  const restartedSkills = host.service.skills;
  const originalPath = join(restartedSkills.packagePath(restartedSkills.version(record.latest)), 'extension.mjs');
  state = await prompt([['read', { path: originalPath }]]);
  assert.match(JSON.stringify(state.messages.at(-1)), /__d4UnknownInHost/);
  const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const attack = `import(${JSON.stringify(originalPath)}).catch(e=>console.log(e.message))`;
  state = await prompt([['bash', { command: 'node --input-type=module -e ' + shellQuote(attack) }]]);
  assert.equal(await readFile(canary, 'utf8'), 'unauthorized');
  checks.push({
    sourceBoundary: {
      passed: false,
      normalSessionReadSucceeded: true,
      normalSessionRawImportSucceeded: true,
      outsideGuestWriteSucceeded: true,
      originalPath,
      result: state.messages.at(-1),
    },
  });
  await writeFile(canary, 'private-unchanged');
  receipt.sourceBoundaryPassed = false;
  receipt.blockers = ['normal_session_can_read_and_execute_plaintext_isolated_snapshot'];
  receipt.executionCompleted = true;
  process.exitCode = 1;
} catch (error) {
  receipt.error = String(error);
  process.exitCode = 1;
} finally {
  try {
    await host.close();
  } catch (error) {
    receipt.cleanupError = String(error);
    receipt.executionCompleted = false;
    process.exitCode = 1;
  }
  receipt.observations = adapter.observations;
  await writeFile(
    resolve('release/d4-vm-evidence', `formal-${randomUUID()}.json`),
    JSON.stringify(receipt, null, 2) + '\n',
  );
  await writeFile(resolve('release/d4-vm-evidence/formal.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ error: receipt.error, checks: checks.length, VMs: adapter.observations.length }));
}
