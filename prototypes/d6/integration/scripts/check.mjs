import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const commands = [
  ['D6-A typecheck', 'npm', ['--prefix', 'prototypes/d6', 'run', 'typecheck']],
  ['D6-A Biome', 'npm', ['--prefix', 'prototypes/d6', 'run', 'lint']],
  ['D6-A format', 'npm', ['--prefix', 'prototypes/d6', 'run', 'format:check']],
  ['D6-A demo build', 'npm', ['--prefix', 'prototypes/d6', 'run', 'build']],
  ['D6-A Host build', 'npm', ['--prefix', 'prototypes/d6', 'run', 'build:host']],
  ['adapter typecheck', './node_modules/.bin/tsc', ['--noEmit', '-p', 'prototypes/d6/integration/tsconfig.json']],
  [
    'adapter semantic contracts',
    'node',
    ['--import', 'tsx', '--test', 'prototypes/d6/integration/tests/presentation.test.ts'],
  ],
  ['reference adapter typecheck', 'npm', ['--prefix', 'prototypes/d6/host', 'run', 'typecheck']],
  ['reference adapter contracts', 'npm', ['--prefix', 'prototypes/d6/host', 'test']],
  ['preserved quality fixture contracts', 'npm', ['--prefix', 'prototypes/d6/quality', 'test']],
  ['scope hashes and six preexisting changes', 'node', ['prototypes/d6/integration/scripts/isolation.mjs']],
];
const results = [];
for (const [name, cmd, args] of commands) {
  const r = spawnSync(cmd, args, { cwd: repo, encoding: 'utf8' });
  results.push({
    name,
    command: [cmd, ...args],
    status: r.status === 0 ? 'passed' : 'failed',
    exitCode: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
  });
  console.log(name, r.status === 0 ? 'passed' : 'failed');
  if (r.status !== 0) process.exitCode = 1;
}
await fs.writeFile(new URL('../evidence/engineering.json', import.meta.url), JSON.stringify(results, null, 2));
