import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  candidateFiles,
  CandidateStaging,
  permissionProfile,
  sha256,
} from '../apps/host/evolution/sandbox/candidate.js';
import { NativeD4Executor } from '../apps/host/evolution/sandbox/native-executor.js';
const fixture = () => ({
  runId: randomUUID(),
  goalHash: sha256('authorized goal'),
  permissionProfile,
  files: [{ path: 'extensions/tool.js', base64: Buffer.from('export default()=>{}').toString('base64') }],
});
test('D4 export binds goal, scope, every byte and file membership', () => {
  const raw = fixture(),
    first = candidateFiles(raw);
  assert.equal(candidateFiles(raw).digest, first.digest);
  for (const change of [
    { goalHash: sha256('other') },
    { runId: randomUUID() },
    { files: [{ path: 'extensions/other.js', base64: raw.files[0]!.base64 }] },
    { files: [{ path: 'extensions/tool.js', base64: Buffer.from('changed').toString('base64') }] },
  ])
    assert.notEqual(candidateFiles({ ...raw, ...change }).digest, first.digest);
  for (const path of ['../escape', '/absolute', 'a/../b', 'a\\b', 'a//b', 'a/./b'])
    assert.throws(() => candidateFiles({ ...raw, files: [{ ...raw.files[0], path }] }));
  assert.throws(() => candidateFiles({ ...raw, permissionProfile: 'more-permissions' }));
  assert.throws(() => candidateFiles({ ...raw, files: [raw.files[0], raw.files[0]] }));
  assert.throws(() =>
    candidateFiles({
      ...raw,
      files: [
        { path: 'a', base64: '' },
        { path: 'a/b', base64: '' },
      ],
    }),
  );
  assert.throws(() => candidateFiles({ ...raw, files: [{ path: 'a', base64: '!!!' }] }));
  assert.throws(() =>
    candidateFiles({ ...raw, files: [{ path: 'a', base64: Buffer.alloc(1024 * 1024 + 1).toString('base64') }] }),
  );
});
test('D4 staging rejects wrong authorization, duplicate export, missing cleanup and tamper', async () => {
  const root = await mkdtemp(join(tmpdir(), 'd4-stage-test-'));
  const raw = fixture();
  const staging = new CandidateStaging(join(root, 'candidate'), raw.runId, raw.goalHash);
  try {
    await assert.rejects(staging.accept({ ...raw, runId: randomUUID() }));
    const result = await staging.accept(raw);
    assert.equal(result.digest, candidateFiles(raw).digest);
    await assert.rejects(staging.accept(raw));
    await assert.rejects(staging.verify(false, true));
    await assert.rejects(staging.verify(true, false));
    assert.equal((await staging.verify(true, true)).digest, result.digest);
    await writeFile(join(staging.directory, 'extensions/tool.js'), 'changed');
    await assert.rejects(staging.verify(true, true));
    await staging.revoke();
    await assert.rejects(staging.verify(true, true));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('D4 extra files and symlinks cannot enter frozen candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'd4-tree-test-'));
  const raw = fixture();
  const staging = new CandidateStaging(join(root, 'candidate'), raw.runId, raw.goalHash);
  try {
    await staging.accept(raw);
    await writeFile(join(staging.directory, 'extra.js'), 'injected');
    await assert.rejects(staging.verify(true, true));
    await rm(join(staging.directory, 'extra.js'));
    await rm(join(staging.directory, 'extensions/tool.js'));
    await writeFile(join(root, 'outside'), 'export default()=>{}');
    await symlink(join(root, 'outside'), join(staging.directory, 'extensions/tool.js'));
    await assert.rejects(staging.verify(true, true));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('D4 fails closed without its own signed runtime', async () => {
  const executor = new NativeD4Executor('/missing/Agent.app');
  assert.equal((await executor.available()).available, false);
  await assert.rejects(executor.execute({}, async () => ({}), new AbortController().signal));
});
