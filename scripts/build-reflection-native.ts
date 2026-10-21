import { createHash } from 'node:crypto';
import { signingConfiguration } from './sign-desktop.js';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const native = join(root, 'apps/desktop/native/reflection');
const nodeVersion = '24.22.0';
const serviceId = 'dev.personal.agent.reflection';
const bridgeId = 'dev.personal.agent.reflection-bridge';
function run(command: string, args: string[], cwd?: string) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    cwd,
    maxBuffer: 8 * 1024 * 1024,
    env:
      command === 'npm'
        ? Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)))
        : process.env,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr.slice(0, 1000)}`);
  return `${result.stdout}${result.stderr}`;
}
async function download(url: string) {
  const result = spawnSync(
    'curl',
    [
      '--silent',
      '--show-error',
      '--fail',
      '--location',
      '--proto',
      '=https',
      '--connect-timeout',
      '15',
      '--max-time',
      '120',
      url,
    ],
    { maxBuffer: 128 * 1024 * 1024, timeout: 125_000 },
  );
  if (result.error || result.status !== 0) throw new Error('Official Node HTTPS download failed');
  return result.stdout;
}
async function officialNode(arch: string) {
  const cache = join(root, 'release/reflection-native-cache', `node-v${nodeVersion}-darwin-${arch}`);
  await mkdir(cache, { recursive: true });
  const filename = `node-v${nodeVersion}-darwin-${arch}.tar.gz`;
  const base = `https://nodejs.org/dist/v${nodeVersion}`;
  const sumsPath = join(cache, 'SHASUMS256.txt');
  let sums: Buffer;
  try {
    sums = await readFile(sumsPath);
  } catch {
    sums = await download(`${base}/SHASUMS256.txt`);
    await writeFile(sumsPath, sums);
  }
  const expected = sums
    .toString('utf8')
    .split('\n')
    .find((line) => line.trim().endsWith(` ${filename}`))
    ?.split(/\s+/)[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Official Node SHA256 entry is missing');
  const archivePath = join(cache, filename);
  let archive: Buffer;
  try {
    archive = await readFile(archivePath);
  } catch {
    archive = await download(`${base}/${filename}`);
    await writeFile(archivePath, archive);
  }
  if (createHash('sha256').update(archive).digest('hex') !== expected) {
    await rm(archivePath, { force: true });
    throw new Error('Official Node archive SHA256 mismatch');
  }
  run('tar', ['-xzf', archivePath, '-C', cache, '--no-same-owner', '--no-same-permissions']);
  const executable = join(cache, filename.replace('.tar.gz', ''), 'bin/node');
  if (!run(executable, ['--version']).includes(`v${nodeVersion}`)) throw new Error('Bundled Node version mismatch');
  if (run('otool', ['-L', executable]).includes('Electron Framework'))
    throw new Error('Reflection Node depends on Electron');
  return { executable, url: `${base}/${filename}`, sha256: expected };
}
function info(id: string, executable: string, type: string, version: string, service = false) {
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleExecutable</key><string>${executable}</string><key>CFBundlePackageType</key><string>${type}</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundleShortVersionString</key><string>${version}</string><key>LSMinimumSystemVersion</key><string>15.0</string>${service ? '<key>XPCService</key><dict><key>ServiceType</key><string>Application</string></dict>' : '<key>LSUIElement</key><true/>'}</dict></plist>`;
}
export async function buildReflectionNative(appBundle: string, hostDist = join(root, 'dist/host')) {
  if (process.platform !== 'darwin') return;
  const arch = process.arch;
  if (arch !== 'arm64' && arch !== 'x64') throw new Error('Unsupported macOS Reflection architecture');
  const node = await officialNode(arch);
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    version: string;
    workspaces?: string[];
  };
  const bridge = join(appBundle, 'Contents/Helpers/ReflectionBridge.app');
  const service = join(bridge, `Contents/XPCServices/${serviceId}.xpc`);
  const serviceContents = join(service, 'Contents');
  const runtime = join(serviceContents, 'Resources/runtime');
  const serviceBinary = join(serviceContents, 'MacOS/reflection-service');
  const nodeBinary = join(serviceContents, 'MacOS/ReflectionNode');
  const clientBinary = join(bridge, 'Contents/MacOS/reflection-bridge');
  await Promise.all([
    mkdir(dirname(serviceBinary), { recursive: true }),
    mkdir(dirname(clientBinary), { recursive: true }),
    mkdir(runtime, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(bridge, 'Contents/Info.plist'), info(bridgeId, 'reflection-bridge', 'APPL', metadata.version)),
    writeFile(
      join(serviceContents, 'Info.plist'),
      info(serviceId, 'reflection-service', 'XPC!', metadata.version, true),
    ),
    cp(node.executable, nodeBinary),
    cp(hostDist, join(runtime, 'dist/host'), { recursive: true }),
    writeFile(join(runtime, 'package.json'), JSON.stringify({ type: 'module', private: true })),
  ]);
  await access(join(runtime, 'dist/host/reflection/worker.js'));
  const lock = await readFile(join(root, 'package-lock.json'));
  const digest = createHash('sha256').update(lock).digest('hex').slice(0, 16);
  const dependencies = join(root, 'release/reflection-native-cache', `dependencies-${digest}`);
  await mkdir(dependencies, { recursive: true });
  try {
    await access(join(dependencies, 'complete'));
  } catch {
    await cp(join(root, 'package.json'), join(dependencies, 'package.json'));
    await writeFile(join(dependencies, 'package-lock.json'), lock);
    for (const app of await readdir(join(root, 'apps'))) {
      const target = join(dependencies, 'apps', app);
      await mkdir(target, { recursive: true });
      try {
        await cp(join(root, 'apps', app, 'package.json'), join(target, 'package.json'));
      } catch {
        /* Non-workspace source directory. */
      }
    }
    await writeFile(join(dependencies, '.npmrc'), 'ignore-scripts=true\nallow-scripts=\n');
    await writeFile(join(dependencies, 'npm-user.npmrc'), '');
    await writeFile(join(dependencies, 'npm-global.npmrc'), '');
    run(
      'npm',
      [
        'ci',
        '--omit=dev',
        '--ignore-scripts',
        '--bin-links=false',
        '--no-audit',
        '--no-fund',
        `--userconfig=${join(dependencies, 'npm-user.npmrc')}`,
        `--globalconfig=${join(dependencies, 'npm-global.npmrc')}`,
      ],
      dependencies,
    );
    await writeFile(join(dependencies, 'complete'), digest);
  }
  await cp(join(dependencies, 'node_modules'), join(runtime, 'node_modules'), {
    recursive: true,
    filter: (path) => !path.split('/').some((part) => part === '.bin' || part === '@agent'),
  });
  const target = arch === 'arm64' ? 'arm64-apple-macosx15.0' : 'x86_64-apple-macosx15.0';
  const flags = [
    '-fobjc-arc',
    '-fblocks',
    '-target',
    target,
    '-framework',
    'Foundation',
    '-framework',
    'Security',
    join(native, 'bridge.m'),
  ];
  run('clang', [...flags, '-DREFLECTION_SERVICE', '-o', serviceBinary]);
  run('clang', [...flags, '-o', clientBinary]);
  const signing = signingConfiguration();
  const { identity } = signing;
  const sign = (path: string, entitlements?: string) =>
    run('codesign', [
      '--force',
      '--sign',
      identity,
      ...(signing.timestamp === 'none' ? ['--timestamp=none'] : ['--timestamp']),
      ...(signing.keychain ? ['--keychain', signing.keychain] : []),
      ...(entitlements ? ['--entitlements', join(native, entitlements)] : []),
      path,
    ]);
  sign(nodeBinary, 'node.entitlements');
  sign(service, 'service.entitlements');
  sign(bridge);
  sign(appBundle);
  for (const path of [nodeBinary, service, bridge, appBundle]) run('codesign', ['--verify', '--strict', path]);
  const manifest = {
    protocol: 1,
    version: metadata.version,
    nodeVersion,
    node: { url: node.url, sha256: node.sha256 },
    identity,
    architecture: arch,
  };
  // Resource metadata is included in the bridge's signature, so sign outward again after writing it.
  await mkdir(join(bridge, 'Contents/Resources'), { recursive: true });
  await writeFile(join(bridge, 'Contents/Resources/reflection-runtime.json'), JSON.stringify(manifest, null, 2));
  sign(bridge);
  sign(appBundle);
  for (const path of [service, bridge, appBundle]) run('codesign', ['--verify', '--strict', path]);
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = process.argv[2];
  if (!app) throw new Error('Usage: tsx scripts/build-reflection-native.ts /path/to/Agent.app');
  await buildReflectionNative(resolve(app));
}
