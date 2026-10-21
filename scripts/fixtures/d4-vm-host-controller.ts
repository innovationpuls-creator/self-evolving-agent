import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { VMIsolatedSkillAdapter } from '../../apps/host/evolution/sandbox/isolated-skill-adapter.js';
import { startHost } from '../../apps/host/transport/server.js';
import { isolatedCode } from '../../tests/fixtures/d4-isolated-skill.js';
const root = process.argv[2]!;
const adapter = await VMIsolatedSkillAdapter.create({
  helper: resolve('release/d4-execution/bin/d4-vm-owner'),
  observer: resolve('release/d4-execution/bin/d4-vm-observer'),
  work: resolve('release/d4-execution-work'),
});
const host = await startHost({
  dataDir: join(root, 'data'),
  key: Buffer.from(process.env.D4_CRASH_TEST_KEY!, 'base64'),
  token: randomBytes(32).toString('hex'),
});
const fake = fauxProvider({
  models: [{ id: 'crash-fixture', contextWindow: 100000, maxTokens: 256 }],
  tokensPerSecond: 100000,
});
host.service.runtime.registerNativeProvider(fake.provider);
host.service.skills.setIsolatedAdapter(adapter);
const metadata = join(root, 'session.json');
let sessionId: string;
try {
  sessionId = JSON.parse(await readFile(metadata, 'utf8')).sessionId;
} catch {
  const source = join(root, 'fixture'),
    project = join(root, 'project');
  await mkdir(source);
  await mkdir(project);
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({
      name: 'd4-crash-fixture',
      version: '1.0.0',
      pi: { skills: ['SKILL.md'], extensions: ['extension.mjs'] },
    }),
  );
  await writeFile(
    join(source, 'SKILL.md'),
    '---\nname: crash-fixture\ndescription: Own fixed crash fixture.\n---\nUse isolated echo.',
  );
  await writeFile(join(source, 'extension.mjs'), isolatedCode('crash', join(root, 'private')));
  const [record] = await host.service.skills.import({
    source,
    project,
    bindings: [{ skill: 'SKILL.md', extensions: ['extension.mjs'] }],
    execution: { kind: 'd4-vm-v1', permissionProfile: 'd4-data-only-v1', runtimeDigest: adapter.runtimeDigest },
  });
  const session = await host.service.create(project, fake.provider.id, 'crash-fixture');
  sessionId = session.id;
  const op = host.service.skills.publish(record!.id, record!.latest, record!.revision);
  while (['checking', 'waiting'].includes(host.service.skills.operation(op.id).status)) await delay(20);
  if (host.service.skills.operation(op.id).status !== 'applied') throw Error('crash_fixture_publish_failed');
  await writeFile(metadata, JSON.stringify({ sessionId }));
}
fake.setResponses([
  fauxAssistantMessage(fauxToolCall('tool_search', { query: 'isolated echo', limit: 1 }), { stopReason: 'toolUse' }),
  fauxAssistantMessage(fauxToolCall('d4_echo', { text: 'detached' }), { stopReason: 'toolUse' }),
  fauxAssistantMessage('done'),
]);
await host.service.prompt(sessionId, 'Run the fixed detached fixture.');
while ((await host.service.viewSession(sessionId)).busy) await delay(20);
const view = await host.service.viewSession(sessionId);
if (!view.messages.some((m) => m.role === 'toolResult' && JSON.stringify(m).includes('crash:detached')))
  throw Error('crash_fixture_tool_failed');
console.log(JSON.stringify({ kind: 'hostReady', hostPid: process.pid, observation: adapter.observations.at(-1) }));
process.stdin.once('end', () => {
  void host.close().then(() => process.exit(0));
});
process.stdin.resume();
