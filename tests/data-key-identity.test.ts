import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../apps/host/transport/server.js';
import { EncryptedStore } from '../apps/host/storage/storage.js';
import { DataKeyError, wrappedKeyDigest } from '../apps/host/storage/data-key.js';

async function files(dir: string): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'host.lock') continue;
    if (entry.isDirectory()) {
      for (const [path, hash] of Object.entries(await files(join(dir, entry.name))))
        values[`${entry.name}/${path}`] = hash;
    } else
      values[entry.name] = createHash('sha256')
        .update(await readFile(join(dir, entry.name)))
        .digest('hex');
  }
  return values;
}
async function fixture(fn: (dir: string, key: Buffer, token: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'key-identity-'));
  try {
    await fn(dir, randomBytes(32), randomBytes(32).toString('hex'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('empty Web directory establishes encrypted identity and later wrong key cannot mutate SQLite', () =>
  fixture(async (dir, key, token) => {
    const first = await startHost({ dataDir: dir, key, token });
    await first.close();
    assert.deepEqual(await new EncryptedStore(dir, key).read('credentials.enc'), {});
    const before = await files(dir);
    await assert.rejects(startHost({ dataDir: dir, key: randomBytes(32), token }), DataKeyError);
    assert.deepEqual(await files(dir), before);
    const second = await startHost({ dataDir: dir, key, token });
    await second.close();
  }));

test('legacy SQLite-only Web directory refuses binding without changing any file', () =>
  fixture(async (dir, key, token) => {
    const host = await startHost({ dataDir: dir, key, token });
    await host.close();
    await unlink(join(dir, 'credentials.enc'));
    const before = await files(dir);
    await assert.rejects(
      startHost({ dataDir: dir, key, token }),
      (error) => error instanceof DataKeyError && error.code === 'key-unverified',
    );
    assert.deepEqual(await files(dir), before);
  }));

test('legacy Desktop SQLite-only directory can establish identity only with original unlocked wrapped-key proof', () =>
  fixture(async (dir, key, token) => {
    const host = await startHost({ dataDir: dir, key, token });
    await host.close();
    await unlink(join(dir, 'credentials.enc'));
    const wrapped = randomBytes(51);
    await writeFile(join(dir, 'data-key.enc'), wrapped);
    const before = await files(dir);
    await assert.rejects(
      startHost({ dataDir: dir, key, token, desktopKeyProof: wrappedKeyDigest(randomBytes(51)) }),
      DataKeyError,
    );
    assert.deepEqual(await files(dir), before);
    const restored = await startHost({ dataDir: dir, key, token, desktopKeyProof: wrappedKeyDigest(wrapped) });
    await restored.close();
    assert.deepEqual(await readFile(join(dir, 'data-key.enc')), wrapped);
    assert.deepEqual(await new EncryptedStore(dir, key).read('credentials.enc'), {});
    const after = await files(dir);
    await assert.rejects(
      startHost({ dataDir: dir, key: randomBytes(32), token, desktopKeyProof: wrappedKeyDigest(wrapped) }),
      DataKeyError,
    );
    assert.deepEqual(await files(dir), after);
  }));

test('legacy Session identity authenticates before writes and supports previous-checkpoint fallback', () =>
  fixture(async (dir, key, token) => {
    const host = await startHost({ dataDir: dir, key, token });
    const session = await host.service.create(dir, 'openai-codex', 'gpt-6-luna');
    await host.close();
    await unlink(join(dir, 'credentials.enc'));
    const current = join(dir, 'sessions', `${session.id}.enc`);
    const original = await readFile(current);
    await writeFile(`${current}.prev`, original);
    await writeFile(current, 'damaged');
    const before = await files(dir);
    await assert.rejects(startHost({ dataDir: dir, key: randomBytes(32), token }), DataKeyError);
    assert.deepEqual(await files(dir), before);
    const restored = await startHost({ dataDir: dir, key, token });
    assert.equal((await restored.service.viewSession(session.id)).id, session.id);
    await restored.close();
    assert.equal(await readFile(current, 'utf8'), 'damaged');
    assert.deepEqual(await readFile(`${current}.prev`), original);
  }));

test('wrapped-key proof cannot override wrong historical Session key or corrupt credentials', () =>
  fixture(async (dir, key, token) => {
    const host = await startHost({ dataDir: dir, key, token });
    await host.service.create(dir, 'openai-codex', 'gpt-6-luna');
    await host.close();
    await unlink(join(dir, 'credentials.enc'));
    const wrapped = randomBytes(51);
    await writeFile(join(dir, 'data-key.enc'), wrapped);
    const before = await files(dir);
    await assert.rejects(
      startHost({ dataDir: dir, key: randomBytes(32), token, desktopKeyProof: wrappedKeyDigest(wrapped) }),
      DataKeyError,
    );
    assert.deepEqual(await files(dir), before);
    await writeFile(join(dir, 'credentials.enc'), 'corrupt');
    const corrupted = await files(dir);
    await assert.rejects(
      startHost({ dataDir: dir, key, token, desktopKeyProof: wrappedKeyDigest(wrapped) }),
      DataKeyError,
    );
    assert.deepEqual(await files(dir), corrupted);
  }));

test('a corrupt legacy Session cannot hide a healthy Session during identity bootstrap', () =>
  fixture(async (dir, key, token) => {
    const host = await startHost({ dataDir: dir, key, token });
    const good = await host.service.create(dir, 'openai-codex', 'gpt-6-luna');
    await host.close();
    await unlink(join(dir, 'credentials.enc'));
    await writeFile(join(dir, 'sessions/00000000-0000-4000-8000-000000000000.enc'), 'corrupt');
    const restored = await startHost({ dataDir: dir, key, token });
    assert.equal((await restored.service.viewSession(good.id)).id, good.id);
    await restored.close();
  }));
