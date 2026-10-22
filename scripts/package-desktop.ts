import { packager } from '@electron/packager';
import { basename, join, resolve } from 'node:path';
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { buildReflectionNative } from './build-reflection-native.js';
import { signDesktop } from './sign-desktop.js';
const platform = process.platform,
  arch = process.arch;
if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux')
  throw new Error('Unsupported desktop platform');
if (arch !== 'arm64' && arch !== 'x64') throw new Error('Unsupported desktop architecture');
const output = resolve(process.env.AGENT_PACKAGE_OUT ?? 'release');
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, '.desktop-build-'));
try {
  const paths = await packager({
    dir: '.',
    name: 'Agent',
    out: staging,
    overwrite: false,
    platform,
    arch,
    electronVersion: '44.9.0',
    appBundleId: 'dev.personal.agent',
    asar: false,
    prune: true,
    ignore: /^\/(?!(?:dist|node_modules)(?:\/|$)|package\.json$|README\.md$)[^/]+/,
  });
  for (const path of paths) {
    if (platform === 'darwin') {
      const app = join(path, 'Agent.app');
      await buildReflectionNative(app);
      await signDesktop(app);
    }
    const destination = join(output, basename(path));
    const previous = `${destination}.previous-${Date.now()}`;
    let preserved = false;
    try {
      const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      if (existing) {
        if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Package output is not a directory');
        await rename(destination, previous);
        preserved = true;
      }
      try {
        await rename(path, destination);
      } catch (error) {
        if (preserved) await rename(previous, destination);
        throw error;
      }
      console.log(JSON.stringify({ destination, ...(preserved ? { previous } : {}), published: true }));
    } catch (error) {
      throw new Error('Desktop package publication failed; the previous package was retained', { cause: error });
    }
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
