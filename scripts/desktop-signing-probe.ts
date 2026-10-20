import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { signingConfiguration } from './sign-desktop.js';

// No certificate import, trust changes, application safeStorage item access or ACL changes.
// codesign may access the configured signing private key and require normal user authorization.
// This checks designated requirements only; actual authorization remains manual.
const root = await mkdtemp(join(tmpdir(), 'agent-signing-probe-'));
const config = signingConfiguration();
const receipt: Record<string, unknown> = {
  time: new Date().toISOString(),
  identityKind: config.identity === '-' ? 'ad-hoc' : 'configured signing identity',
  keychainAuthorization: 'not tested; requires an independently named probe and manual system authorization',
  validIdentities: execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .at(-1),
};
try {
  const builds: { cdhash: string; requirement: string }[] = [];
  for (const version of [1, 2]) {
    const source = join(root, `probe-${version}.c`),
      binary = join(root, `probe-${version}`);
    await writeFile(source, `int main(void) { return ${version}; }\n`);
    execFileSync('clang', [source, '-o', binary], { stdio: 'pipe' });
    const args = [
      '--force',
      '--sign',
      config.identity,
      '--identifier',
      'dev.personal.agent.signing-probe',
      '--timestamp=none',
    ];
    if (config.keychain) args.push('--keychain', config.keychain);
    execFileSync('codesign', [...args, binary], { stdio: 'pipe' });
    execFileSync('codesign', ['--verify', '--strict', binary], { stdio: 'pipe' });
    // codesign writes display information to stderr.
    const { spawnSync } = await import('node:child_process');
    const display = spawnSync('codesign', ['-d', '-r-', '--verbose=4', binary], { encoding: 'utf8' });
    assert.equal(display.status, 0);
    const text = display.stdout + display.stderr;
    const cdhash = text.match(/^CDHash=(.+)$/m)?.[1],
      requirement = text.match(/^(?:# )?designated => (.+)$/m)?.[1];
    assert.ok(cdhash && requirement);
    builds.push({ cdhash, requirement });
  }
  assert.notEqual(builds[0]?.cdhash, builds[1]?.cdhash);
  const stable = builds[0]?.requirement === builds[1]?.requirement;
  assert.equal(stable, config.identity !== '-');
  receipt.builds = builds;
  receipt.designatedRequirementStable = stable;
  receipt.stableIdentityValidation =
    config.identity === '-' ? 'blocked: no configured stable signing identity' : 'passed (requirements only)';
  receipt.result = 'passed';
} catch (error) {
  receipt.result = 'blocked';
  receipt.reason = error instanceof Error ? error.message.split('\n')[0] : 'signing unavailable';
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  await writeFile(
    resolve('docs/evidence/desktop-keychain-signing-probe.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  console.log(JSON.stringify(receipt));
}
