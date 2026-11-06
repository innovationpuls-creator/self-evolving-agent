import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { queryObjects } from 'node:v8';
import { AgentSession, SessionManager, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { fauxProvider, type FauxResponseFactory } from '@earendil-works/pi-ai/providers/faux';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { AgentService } from '../../apps/host/runtime/agent.js';
import { startHost } from '../../apps/host/transport/server.js';

const duration = Number(process.env.D5_STABILITY_SECONDS ?? 1800) * 1000;
assert.ok(Number.isFinite(duration) && duration > 0);
const root = await mkdtemp(join(tmpdir(), 'd5-stability-'));
const dataDir = join(root, 'data');
const key = randomBytes(32);
const token = randomBytes(32).toString('hex');
const bundle = resolve(
  process.env.AGENT_REFLECTION_APP_BUNDLE ?? 'release/d4-development-2026-10-21/Agent-darwin-arm64/Agent.app',
);
const output = resolve(process.env.D5_STABILITY_OUTPUT ?? 'docs/evidence/d5-stability.json');
const started = performance.now();
const samples: Record<string, unknown>[] = [];
const result = {
  started: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  durationMs: 0,
  rounds: 0,
  sessions: 0,
  ordinaryToolCalls: 0,
  completedActivities: 0,
  reflectionRuns: 0,
  restarts: 0,
  reconnects: 0,
  passed: false,
  samples,
  provider:
    'Pi Faux deterministic workload; cacheRetention none excludes the simulator promptCache from resource measurements',
};
let host: Awaited<ReturnType<typeof startHost>> | undefined;
const sessionIds: string[] = [];
const factory: FauxResponseFactory = (context) => {
  const raw = JSON.stringify(context.messages);
  const last = context.messages.at(-1);
  const toolName = last?.role === 'toolResult' ? last.toolName : undefined;
  if (raw.includes('Review completed task evidence autonomously. Source Session')) {
    if (toolName === 'reflection_save') return fauxAssistantMessage('Review saved.');
    if (toolName === 'history_sessions')
      return fauxAssistantMessage(
        fauxToolCall('reflection_save', {
          summary: 'Long-run diagnostic review',
          findings: [],
          uncertainties: ['Deterministic provider workload'],
          evidence: [],
        }),
        { stopReason: 'toolUse' },
      );
    return fauxAssistantMessage(fauxToolCall('history_sessions', {}), { stopReason: 'toolUse' });
  }
  if (raw.includes('用户已授权目标')) {
    if (toolName === 'evolution_complete') return fauxAssistantMessage('Completed without code changes.');
    return fauxAssistantMessage(
      fauxToolCall('evolution_complete', { summary: 'No reusable capability change required', packages: [] }),
      { stopReason: 'toolUse' },
    );
  }
  if (toolName === 'read') return fauxAssistantMessage('Read completed.');
  return fauxAssistantMessage(fauxToolCall('read', { path: 'fixture.txt' }), { stopReason: 'toolUse' });
};
async function start() {
  const service = new AgentService(dataDir, key, { reflectionAppBundle: bundle, reflectionDelayMs: 0 });
  const running = await startHost({ dataDir, key, token, service });
  const fake = fauxProvider({
    models: [{ id: 'd5-stability', contextWindow: 262144, maxTokens: 1024 }],
    tokensPerSecond: 100000,
  });
  const stream = fake.provider.streamSimple.bind(fake.provider);
  fake.provider.streamSimple = (model, context, options) =>
    stream(model, context, { ...options, cacheRetention: 'none' });
  fake.setResponses(Array.from({ length: 20000 }, () => factory));
  service.runtime.registerNativeProvider(fake.provider);
  assert.equal(
    (await service.reflection.availability()).available,
    true,
    'Signed native Reflection must be available; never substitute an unrestricted worker',
  );
  return { running, fake };
}
async function idle(id: string) {
  const running = host;
  assert.ok(running);
  const deadline = Date.now() + 120000;
  for (;;) {
    const value = await running.service.viewSession(id);
    if (!value.busy) {
      assert.equal(value.error, undefined);
      return value;
    }
    assert.ok(Date.now() < deadline, 'Session timed out');
    await delay(20);
  }
}
async function backgroundIdle() {
  const running = host;
  assert.ok(running);
  const deadline = Date.now() + 180000;
  for (;;) {
    const jobs = running.service.reflection.jobs.list();
    assert.ok(
      !jobs.some((j) => j.status === 'failed' || j.status === 'waiting_user'),
      'Reflection failed or unavailable',
    );
    if (!jobs.some((j) => j.status === 'running' || j.status === 'pending')) return;
    assert.ok(Date.now() < deadline, 'Reflection queue timed out');
    await delay(50);
  }
}
function workerCount() {
  return execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' })
    .split('\n')
    .filter(
      (s) =>
        s.includes(`${bundle}/Contents/`) && /\/(reflection-bridge|reflection-service|ReflectionNode)(?:\s|$)/.test(s),
    ).length;
}
try {
  await writeFile(join(root, 'fixture.txt'), 'stable native read evidence\n');
  let current = await start();
  host = current.running;
  while (performance.now() - started < duration) {
    const roundStarted = performance.now();
    const running: Awaited<ReturnType<typeof startHost>> = host;
    const sessions = await Promise.all(
      Array.from({ length: 3 }, () => running.service.create(root, current.fake.provider.id, 'd5-stability')),
    );
    const first = sessions[0];
    assert.ok(first);
    sessionIds.push(...sessions.map((s) => s.id));
    result.sessions += sessions.length;
    await Promise.all(
      sessions.map(async (s) => {
        await running.service.prompt(s.id, 'D5-NORMAL: read the fixture');
        const state = await idle(s.id);
        assert.ok(state.messages.some((m) => m.role === 'toolResult' && m.toolName === 'read' && !m.isError));
        result.ordinaryToolCalls++;
      }),
    );
    const activity = await host.service.createActivity(
      first.id,
      'Review whether a new capability is needed; no code changes are required.',
    );
    await host.service.authorizeActivity(activity.id, {
      baseRevision: 1,
      goal: activity.goal,
      newSkills: ['optional-inspection'],
      existingSkills: [],
    });
    await idle(activity.sessionId);
    const deadline = Date.now() + 30000;
    while (host.service.activities.get(activity.id).status === 'checking') {
      assert.ok(Date.now() < deadline);
      await delay(20);
    }
    assert.equal(host.service.activities.get(activity.id).status, 'completed');
    result.completedActivities++;
    await backgroundIdle();
    result.reflectionRuns +=
      host.service.reflection.jobs.list().filter((j) => j.status === 'succeeded').length - result.reflectionRuns;
    const ws = new WebSocket(`${host.origin.replace('http', 'ws')}/events`, {
      origin: host.origin,
      headers: { Authorization: `Bearer ${token}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.close();
    result.reconnects++;
    const previous = await host.service.viewSession(first.id);
    const released = await host.service.releaseIdleSessions(0);
    assert.ok(released >= 4, `Expected all settled Session runtimes released, got ${released}`);
    const restored = await host.service.viewSession(first.id);
    assert.equal(restored.leafId, previous.leafId);
    assert.ok(
      JSON.stringify(restored.messages) === JSON.stringify(previous.messages),
      'Recovered serialized messages must match',
    );
    assert.ok(JSON.stringify(restored.tree) === JSON.stringify(previous.tree), 'Recovered serialized tree must match');
    await host.service.releaseIdleSessions(0);
    globalThis.gc?.();
    const memory = process.memoryUsage();
    samples.push({
      elapsedMs: Math.round(performance.now() - started),
      round: ++result.rounds,
      released,
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      agentSessions: queryObjects(AgentSession),
      sessionManagers: queryObjects(SessionManager),
      modelRuntimes: queryObjects(ModelRuntime),
      external: memory.external,
      cpu: process.cpuUsage(),
      activeResources: process.getActiveResourcesInfo(),
      workerProcesses: workerCount(),
      databaseBytes: (await stat(join(dataDir, 'product.sqlite'))).size,
      roundMs: Math.round(performance.now() - roundStarted),
    });
    if (result.rounds % 10 === 0) {
      await host.service.prepareMaintenance();
      await host.close();
      host = undefined;
      current = await start();
      host = current.running;
      result.restarts++;
      const firstId = sessionIds[0];
      assert.ok(firstId);
      const previous = await host.service.viewSession(firstId);
      assert.ok(previous.messages.some((m) => m.role === 'toolResult' && m.toolName === 'read'));
      await host.service.releaseIdleSessions(0);
    }
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(
      output,
      `${JSON.stringify({ ...result, durationMs: Math.round(performance.now() - started) }, null, 2)}\n`,
    );
    console.log(
      JSON.stringify({
        round: result.rounds,
        elapsedSeconds: Math.round((performance.now() - started) / 1000),
        released,
        rssMiB: Math.round(memory.rss / 1048576),
        reflections: result.reflectionRuns,
      }),
    );
    await delay(
      Math.min(
        Math.max(0, duration - (performance.now() - started)),
        Math.max(100, 30000 - (performance.now() - roundStarted)),
      ),
    );
  }
  await backgroundIdle();
  await host.service.prepareMaintenance();
  await host.close();
  host = undefined;
  globalThis.gc?.();
  result.durationMs = Math.round(performance.now() - started);
  result.passed = true;
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(
      { ...result, finalMemory: process.memoryUsage(), finalResources: process.getActiveResourcesInfo() },
      null,
      2,
    )}\n`,
  );
} finally {
  await host?.close();
  await rm(root, { recursive: true, force: true });
}
