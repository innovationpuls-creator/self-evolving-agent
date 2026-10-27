import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const own = fileURLToPath(new URL('..', import.meta.url));
const checks = [
  ['D6-A existing typecheck', '../', ['typecheck']],
  ['D6-A existing build', '../', ['build']],
  ['Host adapter typecheck', './', ['typecheck']],
  ['Host adapter contract tests', './', ['test']],
  ['Host adapter Biome', './', ['lint']],
  ['Host adapter format', './', ['format:check']],
  ['Host adapter independent build', './', ['build']],
  ['retained first-stage fixture contracts', '../quality/', ['test']],
];
const receipts = [];
for (const [name, relative, commands] of checks) {
  const cwd = fileURLToPath(new URL(relative, new URL('..', import.meta.url)));
  const args = commands[0] === 'test' ? ['test'] : ['run', ...commands];
  const result = spawnSync('npm', args, { cwd, encoding: 'utf8' });
  receipts.push({
    name,
    command: ['npm', ...args].join(' '),
    cwd: cwd.replace(own, '<D6_HOST>/'),
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  console.log(`${name}: ${result.status}`);
  if (result.status !== 0) process.exitCode = 1;
}
await fs.writeFile(new URL('../evidence/checks.json', import.meta.url), JSON.stringify(receipts, null, 2));
