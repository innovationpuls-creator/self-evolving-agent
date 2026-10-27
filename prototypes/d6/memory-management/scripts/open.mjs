import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const config = JSON.parse(await readFile(new URL('../../host/.runtime/connection.json', import.meta.url), 'utf8'));
const scenario = JSON.parse(await readFile(new URL('../.runtime/scenario.json', import.meta.url), 'utf8'));
const query = new URLSearchParams({ r: JSON.stringify({ page: 'memory', project: scenario.project }) });
const r = spawnSync('open', [`${config.origin}/?${query}#${new URLSearchParams({ token: config.token })}`], {
  stdio: 'ignore',
});
process.exitCode = r.status || 0;
