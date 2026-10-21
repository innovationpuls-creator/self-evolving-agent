import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { VMAssets } from '../apps/host/evolution/sandbox/vm-assets.js';
import { VMChannel, isVerifiedVMClosure } from '../apps/host/evolution/sandbox/vm-channel.js';
import { CandidateStaging, permissionProfile, sha256 } from '../apps/host/evolution/sandbox/candidate.js';

const work = await mkdtemp(resolve('release/d4-failure-'));
const bin = join(work, 'bin');
await mkdir(bin);
for (const name of ['d4-vm-owner', 'd4-vm-observer', 'owner.json'])
  await copyFile(resolve('release/d4-execution/bin', name), join(bin, name));
await cp(resolve('release/d4-execution/bin/D4Execution_D4VMOwner.bundle'), join(bin, 'D4Execution_D4VMOwner.bundle'), {
  recursive: true,
});
for (const name of ['prepared.json', 'config.json', 'node-linux', 'runtime.tar'])
  await copyFile(resolve('release/d4-execution-work', name), join(work, name), constants.COPYFILE_FICLONE);
const options = { helper: join(bin, 'd4-vm-owner'), observer: join(bin, 'd4-vm-observer'), work };
const assets = await VMAssets.capture(options);
const receipt: Record<string, unknown> = { admission: false, checks: [], work };
const checks = receipt.checks as unknown[];
try {
  for (const path of [options.helper, join(work, 'config.json'), join(work, 'runtime.tar')]) {
    const original = await readFile(path);
    await writeFile(path + '.next', Buffer.concat([original, Buffer.from('changed')]));
    await rename(path + '.next', path);
    await assert.rejects(assets.verify(options), /isolated_runtime_changed/);
    await writeFile(path + '.next', original, { mode: 0o755 });
    await rename(path + '.next', path);
    checks.push({ assetReplacementRejected: path });
  }
  const vm = new VMChannel({ ...options, assets });
  await vm.start();
  await vm.close();
  assert.ok(isVerifiedVMClosure(vm.closure, vm.id));
  assert.equal(isVerifiedVMClosure(vm.closure, 'other'), false);
  assert.equal(isVerifiedVMClosure(JSON.parse(JSON.stringify(vm.closure)), vm.id), false);
  const goalHash = sha256('fixed owned fixture');
  const stage = new CandidateStaging(join(work, 'candidate'), vm.id, goalHash);
  await stage.accept({
    runId: vm.id,
    goalHash,
    permissionProfile,
    files: [{ path: 'owned.js', base64: Buffer.from('export default()=>{}').toString('base64') }],
  });
  await stage.verify(vm.closure);
  await writeFile(join(stage.directory, 'owned.js'), 'changed');
  await assert.rejects(stage.verify(vm.closure), /candidate/);
  checks.push({ actualClosure: vm.closure, serializedAndWrongActivityRejected: true, tamperRejected: true });
  const bad = new VMChannel({ ...options, assets });
  await bad.start();
  const observerBytes = await readFile(options.observer);
  await writeFile(options.observer + '.next', '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await rename(options.observer + '.next', options.observer);
  await assert.rejects(bad.close(), /isolated_observer_changed/);
  assert.equal(bad.closure, undefined);
  await writeFile(options.observer + '.next', observerBytes, { mode: 0o755 });
  await rename(options.observer + '.next', options.observer);
  await bad.close();
  checks.push({ observerFailureDeniedClosure: true, events: bad.events });
  const race = new VMChannel({ ...options, assets });
  const opening = race.start();
  await delay(100);
  await race.close();
  await assert.rejects(opening, /isolated_start_revoked/);
  assert.equal(race.closure, undefined);
  checks.push({ closeDuringAssetVerificationRevokedStart: true });
} catch (error) {
  receipt.error = String(error);
  process.exitCode = 1;
}
await writeFile(resolve('release/d4-vm-evidence/failures.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ error: receipt.error, checks: checks.length }));
