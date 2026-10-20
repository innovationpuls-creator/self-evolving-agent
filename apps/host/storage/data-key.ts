import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { EncryptedStore } from './encrypted-store.js';

export type DataKeyCode = 'key-missing' | 'key-invalid' | 'key-unverified' | 'data-unreadable';
export class DataKeyError extends Error {
  constructor(readonly code: DataKeyCode) {
    super(code);
  }
}
export function decodeDataKey(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) throw new DataKeyError('key-invalid');
  return bytes;
}
export const wrappedKeyDigest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Runs under the Host directory lock, before SQLite migrations or recovery writes.
// Desktop proof is only supplied over the trusted parent port, never from CLI/HTTP.
export async function ensureKeyIdentity(
  store: EncryptedStore,
  validateSession: (id: string) => Promise<unknown>,
  desktopKeyProof?: string,
) {
  let credentials: unknown;
  try {
    credentials = await store.read('credentials.enc');
  } catch {
    throw new DataKeyError('data-unreadable');
  }
  if (credentials !== undefined) {
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials))
      throw new DataKeyError('data-unreadable');
    return;
  }
  let files: string[];
  try {
    files = await readdir(join(store.dir, 'sessions'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    files = [];
  }
  const ids = new Set(
    files.flatMap((name) => {
      const match = /^([a-f0-9-]{36})\.enc(?:\.prev)?$/.exec(name);
      return match?.[1] ? [match[1]] : [];
    }),
  );
  let authenticated = false;
  for (const id of ids) {
    if (await validateSession(id).catch(() => undefined)) {
      authenticated = true;
      break;
    }
  }
  // A wrapped key never overrides failed historical ciphertext authentication.
  if (ids.size && !authenticated) throw new DataKeyError('data-unreadable');
  if (!authenticated && desktopKeyProof) {
    const wrapped = await readFile(join(store.dir, 'data-key.enc'));
    if (wrappedKeyDigest(wrapped) !== desktopKeyProof) throw new DataKeyError('key-unverified');
    authenticated = true;
  }
  if (!authenticated) {
    const entries = await readdir(store.dir);
    if (entries.some((entry) => entry !== 'host.lock')) throw new DataKeyError('key-unverified');
  }
  await store.write('credentials.enc', {});
}
