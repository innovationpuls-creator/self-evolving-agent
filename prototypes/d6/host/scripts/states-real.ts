import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { request, connection, root, settled, waitFor, saveTranscript } from './client';
import type { Session } from '../../../../apps/web/src/features/chat/session-state';
import type { ReflectionCatalog } from '../../../../apps/web/src/features/reflection/reflection-state';
const scenario = JSON.parse(await readFile(`${root}/.runtime/scenario.json`, 'utf8')) as {
  project: string;
  otherProject: string;
  failed?: string;
  interrupted?: string;
};
const models = await request<{ models: Array<{ provider: string; id: string }> }>('/models');
const model = models.models.find((m) => m.provider === 'openai-codex' && m.id === 'gpt-6-luna');
if (!model) throw new Error('Configured real model missing');
const kind = process.argv[2];
if (kind !== 'failed' && kind !== 'interrupted') throw new Error('Select failed or interrupted test');
const source = await request<Session>('/sessions', 'POST', {
  cwd: scenario.otherProject,
  provider: model.provider,
  model: model.id,
});
scenario[kind] = source.id;
await writeFile(`${root}/.runtime/scenario.json`, JSON.stringify(scenario));
await request(`/sessions/${source.id}/prompt`, 'POST', { text: '这是一个独立的连接恢复检查。请只回复：收到。' });
const state = await settled(source.id);
if (state.error) throw new Error('Source task did not settle normally');
await request('/reflections/expedite', 'POST', { sessionId: source.id });
const before = await waitFor(
  () => request<ReflectionCatalog>(`/reflections?view=summary&sessionId=${source.id}`),
  (value) => value.jobs[0]?.status === 'running',
);
const runtimePid = Number(
  execFileSync('lsof', ['-ti', `TCP:${new URL(connection.origin).port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim(),
);
if (!Number.isSafeInteger(runtimePid) || runtimePid <= 1) throw new Error('Cannot identify isolated runtime');
const proof: Record<string, unknown> = {
  kind,
  source: source.id,
  before,
  runtimePid,
  action:
    kind === 'failed'
      ? 'SIGKILL only isolated Host child reflection-bridge'
      : 'SIGTERM isolated Host during active Reflection, then normal restart',
};
if (kind === 'failed') {
  const bridge = await waitFor(
    async () => {
      const lines = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).split('\n');
      return lines
        .map((line) => /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line))
        .find((entry) => entry && Number(entry[2]) === runtimePid && entry[3]?.endsWith('/reflection-bridge'));
    },
    (value) => !!value,
    15000,
  );
  if (!bridge?.[1]) throw new Error('Isolated bridge not found; no process killed');
  proof.bridge = {
    pid: Number(bridge[1]),
    ppid: Number(bridge[2]),
    executable: bridge[3]?.replaceAll(root, '<D6_HOST>'),
  };
  process.kill(Number(bridge[1]), 'SIGKILL');
  proof.after = await waitFor(
    () => request<ReflectionCatalog>(`/reflections?view=summary&sessionId=${source.id}`),
    (value) => value.jobs[0]?.status === 'failed',
  );
  proof.detail = await request(`/reflections/${before.jobs[0]?.id}`);
} else {
  await writeFile(
    `${root}/evidence/interruption-before-restart.json`,
    JSON.stringify(proof, null, 2).replaceAll(root, '<D6_HOST>'),
  );
  process.kill(runtimePid, 'SIGTERM');
}
await saveTranscript(`${kind}-requests`);
await writeFile(`${root}/evidence/${kind}-real.json`, JSON.stringify(proof, null, 2).replaceAll(root, '<D6_HOST>'));
console.log(
  JSON.stringify({
    kind,
    session: source.id,
    action: proof.action,
    final: kind === 'failed' ? 'failed verified' : 'restart required',
  }),
);
