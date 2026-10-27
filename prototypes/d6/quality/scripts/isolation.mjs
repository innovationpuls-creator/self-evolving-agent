import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const before = JSON.parse(await fs.readFile(new URL('../evidence/preservation-before.json', import.meta.url), 'utf8'));
const changed = [];
for (const [path, hash] of Object.entries(before)) {
  try {
    if (
      crypto
        .createHash('sha256')
        .update(await fs.readFile(`${root}${path}`))
        .digest('hex') !== hash
    )
      changed.push(path);
  } catch {
    changed.push(path);
  }
}
const result = { files: Object.keys(before).length, changed, status: changed.length ? 'failed' : 'passed' };
await fs.writeFile(new URL('../evidence/isolation.json', import.meta.url), JSON.stringify(result, null, 2));
assert.deepEqual(changed, []);
console.log(JSON.stringify(result));
