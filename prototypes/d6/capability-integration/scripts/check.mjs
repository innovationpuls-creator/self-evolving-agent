import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const commands = [
  ['D6 typecheck', ['npm', '--prefix', 'prototypes/d6', 'run', 'typecheck']],
  ['D6 Biome', ['npm', '--prefix', 'prototypes/d6', 'run', 'lint']],
  ['D6 format', ['npm', '--prefix', 'prototypes/d6', 'run', 'format:check']],
  ['capability adapter types', ['npm', '--prefix', 'prototypes/d6/capability-integration', 'run', 'typecheck']],
  [
    'formal Host mechanism and frontend state contracts',
    ['npm', '--prefix', 'prototypes/d6/capability-integration', 'test'],
  ],
  ['capability Biome', ['npm', '--prefix', 'prototypes/d6/capability-integration', 'run', 'lint']],
  ['capability format', ['npm', '--prefix', 'prototypes/d6/capability-integration', 'run', 'format:check']],
  ['preserved Memory contracts', ['npm', '--prefix', 'prototypes/d6/memory-management', 'test']],
  [
    'preserved Reflection contracts',
    [
      'node',
      '--import',
      'tsx',
      '--test',
      'prototypes/d6/capability-integration/tests/reflection-crash.test.ts',
      'prototypes/d6/capability-integration/tests/reflection-detail.test.ts',
      'prototypes/d6/capability-integration/tests/reflection-persistence.test.ts',
      'prototypes/d6/capability-integration/tests/reflection-scope.test.ts',
    ],
  ],
  ['preserved transport contracts', ['npm', '--prefix', 'prototypes/d6/integration', 'test']],
  ['mock A/B build', ['npm', '--prefix', 'prototypes/d6', 'run', 'build']],
  ['Host A build', ['npm', '--prefix', 'prototypes/d6', 'run', 'build:host']],
  ['scope hashes', ['node', 'prototypes/d6/capability-integration/scripts/isolation.mjs']],
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
