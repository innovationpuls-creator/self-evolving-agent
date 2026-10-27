import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const config = JSON.parse(await readFile(new URL('../.runtime/connection.json', import.meta.url), 'utf8'));
const m = JSON.parse(await readFile(new URL('../.runtime/manifest.json', import.meta.url), 'utf8'));
const query = new URLSearchParams({ r: JSON.stringify({ page: 'skills', project: m.sourceProject }) });
const r = spawnSync('open', [`${config.origin}/?${query}#${new URLSearchParams({ token: config.token })}`], {
  stdio: 'ignore',
});
console.log(`D6-A: ${config.origin}/ (local authentication supplied privately)`);
process.exitCode = r.status || 0;
