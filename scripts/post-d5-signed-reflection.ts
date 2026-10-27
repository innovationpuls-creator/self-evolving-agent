import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentService } from '../apps/host/runtime/agent.js';
const root = await mkdtemp(join(tmpdir(), 'post-d5-signed-'));
const out = resolve('release/post-d5-bugfix-2026-10-22');
const bundle = resolve(out, 'package/Agent-darwin-arm64/Agent.app');
const host = new AgentService(join(root, 'data'), randomBytes(32), {
  reflectionAppBundle: bundle,
  reflectionDelayMs: 3600000,
});
const receipt: Record<string, unknown> = { passed: false, bundle, time: new Date().toISOString() };
try {
  await host.init();
  const availability = await host.reflection.availability();
  receipt.availability = availability;
  assert.equal(availability.available, true);
  receipt.workerSha256 = createHash('sha256')
    .update(
      await readFile(
        join(
          bundle,
          'Contents/Helpers/ReflectionBridge.app/Contents/XPCServices/dev.personal.agent.reflection.xpc/Contents/Resources/runtime/dist/host/reflection/worker.js',
        ),
      ),
    )
    .digest('hex');
  await host.credentials('openai-codex', undefined, true);
  let session = await host.create(root, 'openai-codex', 'gpt-6-luna');
  const ctx = await host.memoryUserContext(root);
  const memory = host.memory.create(
    ctx,
    { title: 'Retry budget', content: 'The retry budget is 7 attempts.', kind: 'fact', scope: 'project' },
    'Seed stale knowledge for evidence-based review',
  );
  await writeFile(
    join(root, 'POLICY.md'),
    'Current confirmed project policy: retry budget is 3 attempts. This supersedes the older note claiming 7 attempts.\n',
  );
  async function run(text: string) {
    await host.prompt(session.id, text);
    const deadline = Date.now() + 180000;
    while ((await host.viewSession(session.id)).busy) {
      assert.ok(Date.now() < deadline);
      await new Promise((done) => setTimeout(done, 150));
    }
    assert.equal((await host.viewSession(session.id)).error, undefined);
  }
  async function reflect() {
    const pending = host.reflection.jobs.list({ sessionId: session.id }).find((job) => job.status === 'pending');
    assert.ok(pending);
    host.reflection.jobs.expedite(session.id);
    host.reflection.wake();
    const deadline = Date.now() + 360000;
    while (Date.now() < deadline) {
      const job = host.reflection.jobs.get(pending.id);
      if (job && ['succeeded', 'failed', 'interrupted', 'waiting_user'].includes(job.status)) {
        assert.equal(job.status, 'succeeded', JSON.stringify(job));
        const record = host.reflection.get(job.id);
        assert.ok(record);
        return record;
      }
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error('Restricted Reflection timed out');
  }
  await run(
    'Read POLICY.md and compare the current Retry budget memory. Report the discrepancy with actual evidence. Do not modify Memory or propose capabilities in this ordinary task; leave the descriptive correction for background review.',
  );
  const first = await reflect();
  receipt.evidenceBased = first;
  receipt.source = await host.viewSession(session.id);
  const traces = await host.diagnosticHistory.search({ actor: 'user' }, { sessionId: first.reflectionSessionId });
  receipt.workerTraces = traces.items.map((trace) => host.diagnosticHistory.get({ actor: 'user' }, trace.id));
  const corrected = host.memory.get(ctx, memory.id, true);
  receipt.memory = corrected;
  assert.ok(first.evidence.length);
  assert.match(first.summary, /3/);
  if (corrected.current.revision > 1) assert.match(corrected.current.content, /3/);
  const original = corrected.history[0];
  assert.ok(original);
  assert.match(original.content, /7/);
  // Use a clean Project so unresolved earlier knowledge cannot legitimately cause a new finding.
  const emptyProject = join(root, 'empty-project');
  await mkdir(emptyProject);
  session = await host.create(emptyProject, 'openai-codex', 'gpt-6-luna');
  await run('谢谢，本轮没有新事实、问题或任务，只需回复收到。');
  const second = await reflect();
  receipt.noNewFinding = second;
  assert.equal(second.findings.length, 0);
  assert.equal(second.changes.length, 0);
  assert.equal(host.memory.get(ctx, memory.id, true).current.revision, corrected.current.revision);
  receipt.passed = true;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'reflection-signed-real.json'), JSON.stringify(receipt, null, 2));
  await host.close();
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ passed: receipt.passed, error: receipt.error }));
}
