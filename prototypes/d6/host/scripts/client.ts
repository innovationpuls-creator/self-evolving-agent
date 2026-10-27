import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ReflectionCatalog } from '../../../../apps/web/src/features/reflection/reflection-state';
export const root = fileURLToPath(new URL('..', import.meta.url));
export const connection = JSON.parse(
  await readFile(new URL('../.runtime/connection.json', import.meta.url), 'utf8'),
) as { origin: string; token: string };
export const records: Array<Record<string, unknown>> = [];
export async function request<T = unknown>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`${connection.origin}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!path.startsWith('/models'))
    records.push({
      time: new Date().toISOString(),
      path: path.replaceAll(root, '<D6_HOST>'),
      method,
      status: response.status,
      response:
        path === '/credentials'
          ? { ok: response.ok }
          : JSON.parse(JSON.stringify(result).replaceAll(root, '<D6_HOST>')),
    });
  if (!response.ok)
    throw Object.assign(new Error(`${path}: ${response.status} ${result.error || ''}`), { status: response.status });
  return result as T;
}
export async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeout = 360000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error('Real Host operation timed out');
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}
export async function settled(id: string) {
  return waitFor(
    () => request<import('../../../../apps/web/src/features/chat/session-state').Session>(`/sessions/${id}`),
    (value) => !value.busy,
    180000,
  );
}
export async function reflected(id: string) {
  const catalog = await waitFor(
    () => request<ReflectionCatalog>(`/reflections?view=summary&sessionId=${id}`),
    (value) => value.jobs.length > 0,
  );
  await request('/reflections/expedite', 'POST', { sessionId: id });
  const final = await waitFor(
    () => request<ReflectionCatalog>(`/reflections?view=summary&sessionId=${id}`),
    (value) => value.jobs.every((job) => !['pending', 'running'].includes(job.status)),
  );
  const job = final.jobs.find((item) => item.id === catalog.jobs[0]?.id);
  if (!job) throw new Error('Reflection job disappeared');
  return { catalog: final, detail: await request<import('../src/data').Detail>(`/reflections/${job.id}`) };
}
export async function saveTranscript(name: string) {
  await writeFile(new URL(`../evidence/${name}.json`, import.meta.url), JSON.stringify(records, null, 2));
}
