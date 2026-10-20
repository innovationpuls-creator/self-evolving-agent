import { randomBytes } from 'node:crypto';
import { link, open, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DataKeyError, decodeDataKey, wrappedKeyDigest } from '../host/storage/data-key.js';

export interface UnlockedKey {
  key: string;
  desktopKeyProof: string;
}
export type UnlockStage = 'accessing' | 'restoring' | 'writing';
export interface SecureStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  decryptStringAsync(bytes: Buffer): Promise<{ result: string }>;
  encryptStringAsync(text: string): Promise<Buffer>;
}
export async function unlockDataKey(
  dir: string,
  storage: SecureStorage,
  signal: AbortSignal,
  stage: (value: UnlockStage) => void,
): Promise<UnlockedKey> {
  const path = join(dir, 'data-key.enc');
  stage('restoring');
  let wrapped: Buffer | undefined;
  try {
    wrapped = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if ((await readdir(dir)).length) throw new DataKeyError('key-missing');
  }
  signal.throwIfAborted();
  stage('accessing');
  if (!(await storage.isAsyncEncryptionAvailable())) throw new Error('secure-storage-unavailable');
  signal.throwIfAborted();
  if (wrapped) {
    const { result: key } = await storage.decryptStringAsync(wrapped);
    signal.throwIfAborted();
    decodeDataKey(key);
    stage('restoring');
    return { key, desktopKeyProof: wrappedKeyDigest(wrapped) };
  }
  const key = randomBytes(32).toString('base64');
  wrapped = await storage.encryptStringAsync(key);
  signal.throwIfAborted();
  stage('writing');
  if ((await readdir(dir)).length) throw new DataKeyError('key-missing');
  signal.throwIfAborted();
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const file = await open(temp, 'wx', 0o600);
    try {
      await file.writeFile(wrapped);
      await file.sync();
    } finally {
      await file.close();
    }
    signal.throwIfAborted();
    // Unlike rename, link cannot replace a concurrently created wrapped key.
    await link(temp, path);
    if (process.platform !== 'win32') {
      const directory = await open(dir, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } finally {
    await unlink(temp).catch(() => {});
  }
  stage('restoring');
  return { key, desktopKeyProof: wrappedKeyDigest(wrapped) };
}
