import { sign } from '@electron/osx-sign';
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';

export function signingConfiguration(env: NodeJS.ProcessEnv = process.env): {
  identity: string;
  mode: 'development' | 'distribution';
  keychain: string | undefined;
  timestamp: 'none' | undefined;
} {
  const identity = env.AGENT_CODESIGN_IDENTITY ?? '-';
  const mode =
    env.AGENT_CODESIGN_MODE ?? (identity.startsWith('Developer ID Application:') ? 'distribution' : 'development');
  if (mode !== 'development' && mode !== 'distribution')
    throw new Error('AGENT_CODESIGN_MODE must be development or distribution');
  if (mode === 'distribution' && identity === '-')
    throw new Error('Distribution requires a Developer ID signing identity');
  return {
    identity,
    mode,
    keychain: env.AGENT_CODESIGN_KEYCHAIN,
    timestamp: mode === 'distribution' ? undefined : 'none',
  };
}
export async function signDesktop(appBundle: string) {
  const config = signingConfiguration();
  const bridge = resolve(appBundle, 'Contents/Helpers/ReflectionBridge.app');
  // Reflection is signed inside-out with its existing sandbox entitlements by its builder.
  // osx-sign handles Electron frameworks/helpers and seals the final outer application.
  await sign({
    app: appBundle,
    platform: 'darwin',
    identity: config.identity,
    keychain: config.keychain,
    identityValidation: config.mode === 'distribution',
    type: config.mode,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    ignore: (path) => resolve(path) === bridge || resolve(path).startsWith(bridge + sep),
    optionsForFile: () => ({ hardenedRuntime: config.mode === 'distribution', timestamp: config.timestamp }),
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appBundle], { stdio: 'pipe' });
  const signature = execFileSync('codesign', ['-d', '-r-', '--verbose=2', appBundle], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(
    JSON.stringify({
      signing: config.identity === '-' ? 'ad-hoc' : config.mode,
      deepStrictVerification: 'passed',
      bundleId: 'dev.personal.agent',
    }),
  );
  return signature;
}
