import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import test from 'node:test';
import { readReflectionDetail } from '../../src/real/reflection-data';
import type { Api, Detail } from '../../src/real/types';

test('stable Job link discovers subsequently created Record; no list detail prefetch', async () => {
  let available = false;
  const paths: string[] = [];
  const job = { id: 'job', reflectionSessionId: undefined };
  const api = (async (path: string) => {
    paths.push(path);
    return path.includes('/jobs/') ? { job } : { job, record: { summary: 'saved', changes: [] } };
  }) as Api;
  assert.deepEqual(await readReflectionDetail(api, 'job'), { job });
  Object.assign(job, { reflectionSessionId: 'worker' });
  available = true;
  const result = await readReflectionDetail(api, 'job');
  assert.equal(available && result.record?.summary, 'saved');
  assert.deepEqual(paths, ['/reflections/jobs/job', '/reflections/jobs/job', '/reflections/job']);
});
test('only missing Record is tolerated; auth/network/503 are never empty success', async () => {
  for (const status of [404, 401, 403, 503, undefined]) {
    const error = Object.assign(new Error('real read failure'), { status });
    const job = { reflectionSessionId: 'worker' } as Detail['job'];
    const api = (async (path: string) => {
      if (path.includes('/jobs/')) return { job };
      throw error;
    }) as Api;
    if (status === 404) assert.deepEqual(await readReflectionDetail(api, 'job'), { job });
    else await assert.rejects(readReflectionDetail(api, 'job'), error);
  }
});
