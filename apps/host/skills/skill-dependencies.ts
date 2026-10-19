import { readFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// These are Pi's native loader aliases. They resolve to the application's pinned
// runtime, never to a candidate-supplied copy. Other declared dependencies must
// resolve inside the immutable snapshot and match an included npm lock entry.
const aliases = [
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-tui',
  '@earendil-works/pi-ai',
  'typebox',
];

let runtimeIdentity: Promise<string> | undefined;
export async function hostIdentity() {
  runtimeIdentity ??= (async () => {
    const hash = createHash('sha256');
    for (const name of aliases) {
      let dir = dirname(fileURLToPath(import.meta.resolve(name)));
      while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
      hash.update(await readFile(join(dir, 'package.json')));
    }
    return hash.digest('hex');
  })();
  return runtimeIdentity;
}
interface Manifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  version?: string;
}
interface Lock {
  packages?: Record<string, { version?: string; integrity?: string; link?: boolean }>;
}
function inside(root: string, path: string) {
  const r = relative(root, path);
  return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r));
}
export async function dependencyIdentity(snapshot: string, packageRoot: string) {
  const locks: Array<{ dir: string; lock: Lock }> = [];
  // Native npm installs keep the root lock above node_modules; git/local
  // packages keep it alongside package.json. Both layouts stay in the snapshot.
  let parent = packageRoot;
  while (inside(snapshot, parent)) {
    if (existsSync(join(parent, 'package-lock.json')))
      locks.push({ dir: parent, lock: JSON.parse(await readFile(join(parent, 'package-lock.json'), 'utf8')) as Lock });
    if (parent === snapshot) break;
    parent = dirname(parent);
  }
  const seen = new Set<string>();
  async function visit(dir: string) {
    dir = await realpath(dir);
    if (!inside(snapshot, dir)) throw new Error('dependency outside snapshot');
    if (seen.has(dir)) return;
    seen.add(dir);
    if (!existsSync(join(dir, 'package.json'))) return;
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Manifest;
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })) {
      if (aliases.includes(name)) continue;
      if (!/^(@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('invalid dependency name');
      let cursor = dir,
        found: string | undefined;
      while (inside(snapshot, cursor)) {
        const p = join(cursor, 'node_modules', name);
        if (existsSync(join(p, 'package.json'))) {
          found = await realpath(p);
          break;
        }
        if (cursor === snapshot) break;
        cursor = dirname(cursor);
      }
      if (!found) {
        if (manifest.optionalDependencies?.[name]) continue;
        throw new Error('dependency missing');
      }
      if (!inside(snapshot, found)) throw new Error('dependency outside snapshot');
      const actual = JSON.parse(await readFile(join(found, 'package.json'), 'utf8')) as Manifest;
      const locked = locks.some(({ dir: base, lock }) => {
        const entry = lock.packages?.[relative(base, found).replaceAll('\\', '/')];
        return entry && !entry.link && entry.version === actual.version;
      });
      if (!locked) throw new Error('dependency not locked');
      await visit(found);
    }
  }
  await visit(packageRoot);
  return hostIdentity();
}
