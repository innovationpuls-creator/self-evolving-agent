import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const config = JSON.parse(await readFile(new URL('../../host/.runtime/connection.json', import.meta.url), 'utf8'));
const scenario = JSON.parse(await readFile(new URL('../../host/.runtime/scenario.json', import.meta.url), 'utf8'));
const query = new URLSearchParams({ r: JSON.stringify({ page: 'session', sessionId: scenario.source }) });
const r = spawnSync('open', [`http://127.0.0.1:4189/?${query}#${new URLSearchParams({ token: config.token })}`], {
  stdio: 'ignore',
});
process.exitCode = r.status || 0;
