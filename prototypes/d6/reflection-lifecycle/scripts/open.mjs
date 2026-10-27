import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const controlled = process.argv.includes('--controlled');
const config = JSON.parse(
  await readFile(
    new URL(
      controlled ? '../.runtime/controlled-connection.json' : '../../host/.runtime/connection.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const s = JSON.parse(
  await readFile(
    new URL(controlled ? '../.runtime/controlled.json' : '../.runtime/real.json', import.meta.url),
    'utf8',
  ),
);
const route = controlled
  ? { page: 'reflection', jobId: s.effect, recordId: s.effect, originSession: s.source }
  : { page: 'session', sessionId: s.source };
const query = new URLSearchParams({ r: JSON.stringify(route) });
const r = spawnSync('open', [`${config.origin}/?${query}#${new URLSearchParams({ token: config.token })}`], {
  stdio: 'ignore',
});
process.exitCode = r.status || 0;
