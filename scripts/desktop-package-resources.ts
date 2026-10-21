import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Keep runtime sources/assets; remove only source maps and declaration files. */
export async function trimDependencyMetadata(root: string) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await trimDependencyMetadata(path);
    else if (entry.isFile() && (/\.map$/.test(entry.name) || /\.d\.(?:ts|mts|cts)$/.test(entry.name))) await rm(path);
  }
}
