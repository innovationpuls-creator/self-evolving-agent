import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const receipts = [];
// Current workspace suite and accepted SessionRoom state suite. Preserve all assertions.
for (const [name, evidenceRoot] of [
  ['workspace-browser.mjs', 'evidence/a-workspace-20261024'],
  ['a-product-states.mjs', 'evidence/a-product-20261023'],
]) {
  const source = await fs.readFile(new URL(`../../scripts/${name}`, import.meta.url), 'utf8');
  const output = fileURLToPath(new URL(`../evidence/regression-${name.replace('.mjs', '')}`, import.meta.url));
  await fs.mkdir(`${output}/after`, { recursive: true });
  const script = source.replaceAll('http://127.0.0.1:4186/', 'http://127.0.0.1:4176/').replaceAll(evidenceRoot, output);
  if (script === source) throw new Error('Existing suite paths changed; inspect before running');
  const temporary = new URL(`./.regression-${name}`, import.meta.url);
  await fs.writeFile(temporary, script);
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(temporary)], { encoding: 'utf8' });
    receipts.push({
      source: `prototypes/d6/scripts/${name}`,
      adaptation: 'server port and evidence destination only; original assertions unchanged',
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status !== 0) process.exitCode = 1;
  } finally {
    await fs.rm(temporary);
  }
}
await fs.writeFile(new URL('../evidence/regression-command.json', import.meta.url), JSON.stringify(receipts, null, 2));
