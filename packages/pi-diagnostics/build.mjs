import { cp, mkdir } from 'node:fs/promises';
const target = new URL('./lib/', import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ['index.ts', 'reader.ts']) {
  await cp(new URL(`./src/${file}`, import.meta.url), new URL(file, target));
}
await cp(new URL('../../apps/shared/sensitive-data.ts', import.meta.url), new URL('protection.ts', target));
