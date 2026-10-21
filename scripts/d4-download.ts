import { open, rm } from 'node:fs/promises';
import type { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Acquire ownership before starting streams; EEXIST never authorizes cleanup. */
export async function writeNewDownload(path: string, input: Readable, budget: Transform) {
  const file = await open(path, 'wx');
  try {
    await pipeline(input, budget, file.createWriteStream());
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  } finally {
    await file.close();
  }
}
