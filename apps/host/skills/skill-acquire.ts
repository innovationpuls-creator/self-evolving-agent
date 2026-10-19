// Acquisition only: no Extension loader, user model runtime, or product credentials.
import { mkdir, realpath, writeFile, access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent';
async function run() {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error('Missing acquisition source');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const config = join(destination, 'npm-user.conf'),
    globalConfig = join(destination, 'npm-global.conf');
  await writeFile(config, '');
  await writeFile(globalConfig, '');
  let npm: string | undefined, git: string | undefined;
  for (const directory of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    const candidate = join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    try {
      await access(candidate);
      npm = await realpath(candidate);
      break;
    } catch {}
  }
  for (const directory of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    try {
      git = await realpath(join(directory, process.platform === 'win32' ? 'git.exe' : 'git'));
      break;
    } catch {}
  }
  if (!npm || !git) throw new Error('Trusted npm/git are unavailable');
  // CLI options win over package .npmrc and environment. No install hooks run.
  const settings = SettingsManager.inMemory(
    { npmCommand: [npm, '--ignore-scripts', `--git=${git}`, '--userconfig', config, '--globalconfig', globalConfig] },
    { projectTrusted: false },
  );
  const manager = new DefaultPackageManager({
    cwd: destination,
    agentDir: join(destination, 'pi'),
    settingsManager: settings,
  });
  await manager.install(source);
  const path = manager.getInstalledPath(source, 'user');
  if (!path) throw new Error('Package was not materialized');
  process.send?.({ root: relative(destination, path) });
}
void run().then(
  () => process.exit(0),
  () => process.exit(1),
);
