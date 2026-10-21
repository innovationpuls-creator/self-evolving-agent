import { packager } from '@electron/packager';
import { join } from 'node:path';
import { cp, mkdir, statfs, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildReflectionNative } from './build-reflection-native.js';
import { signDesktop } from './sign-desktop.js';
import { desktopPackagePolicy } from './desktop-package-policy.js';
import { trimDependencyMetadata } from './desktop-package-resources.js';
const policy = desktopPackagePolicy();
await mkdir(policy.out, { recursive: true });
const storage = await statfs(policy.out);
if (storage.bavail * storage.bsize < 20 * 1024 ** 3)
  throw new Error('Desktop packaging requires a 16 GiB free reserve plus 4 GiB working budget');
const platform = process.platform,
  arch = process.arch;
if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux')
  throw new Error('Unsupported desktop platform');
if (arch !== 'arm64' && arch !== 'x64') throw new Error('Unsupported desktop architecture');
const paths = await packager({
  dir: '.',
  name: 'Agent',
  out: policy.out,
  overwrite: true,
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
    await trimDependencyMetadata(join(app, 'Contents/Resources/app/node_modules'));
    await buildReflectionNative(app);
    if (policy.xpc) await buildReflectionNative(app, undefined, 'd4');
    if (policy.vm) {
      await import('./build-d4-vm.js');
      const destination = join(app, 'Contents/Resources/D4Execution');
      await mkdir(destination, { recursive: true });
      await cp('release/d4-execution/bin', destination, { recursive: true });
    }
    await signDesktop(app);
    const kib = (target: string) =>
      Number(execFileSync('du', ['-sk', target], { encoding: 'utf8' }).trim().split(/\s+/)[0]);
    const footprint = {
      profile: policy.profile,
      totalKiB: kib(app),
      frameworksKiB: kib(join(app, 'Contents/Frameworks')),
      helpersKiB: kib(join(app, 'Contents/Helpers')),
      resourcesKiB: kib(join(app, 'Contents/Resources')),
      maxKiB: 768 * 1024,
    };
    await writeFile(join(path, 'package-footprint.json'), JSON.stringify(footprint, null, 2) + '\n');
    if (footprint.totalKiB > footprint.maxKiB) throw new Error('Desktop package exceeds the 768 MiB unpacked budget');
    console.log(JSON.stringify(footprint));
  }
  console.log(path);
}
