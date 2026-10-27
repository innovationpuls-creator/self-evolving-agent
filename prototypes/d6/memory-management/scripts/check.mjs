import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const commands = [
  ['D6 typecheck', ['npm', '--prefix', 'prototypes/d6', 'run', 'typecheck']],
  ['D6 Biome', ['npm', '--prefix', 'prototypes/d6', 'run', 'lint']],
  ['D6 format', ['npm', '--prefix', 'prototypes/d6', 'run', 'format:check']],
  ['Memory adapter types', ['npm', '--prefix', 'prototypes/d6/memory-management', 'run', 'typecheck']],
  ['Memory mutation contracts', ['npm', '--prefix', 'prototypes/d6/memory-management', 'test']],
  ['Memory validation Biome', ['npm', '--prefix', 'prototypes/d6/memory-management', 'run', 'lint']],
  ['Memory validation format', ['npm', '--prefix', 'prototypes/d6/memory-management', 'run', 'format:check']],
  ['preserved adapter contracts', ['npm', '--prefix', 'prototypes/d6/integration', 'test']],
  ['demo build', ['npm', '--prefix', 'prototypes/d6', 'run', 'build']],
  ['Host build', ['npm', '--prefix', 'prototypes/d6', 'run', 'build:host']],
  ['scope hashes', ['node', 'prototypes/d6/memory-management/scripts/isolation.mjs']],
];
const results = [];
for (const [name, [cmd, ...args]] of commands) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  results.push({
    name,
    command: [cmd, ...args],
    exitCode: r.status,
    status: r.status === 0 ? 'passed' : 'failed',
    stdout: r.stdout,
    stderr: r.stderr,
  });
  console.log(name, r.status);
  if (r.status !== 0) process.exitCode = 1;
}
await fs.writeFile(new URL('../evidence/engineering.json', import.meta.url), JSON.stringify(results, null, 2));
