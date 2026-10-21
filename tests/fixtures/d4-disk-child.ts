import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { VMDisk } from '../../apps/host/evolution/sandbox/vm-disk.js';

const work = process.argv[2]!;
const lines = createInterface({ input: process.stdin });
const stop = new Promise<void>((ok) => lines.once('close', ok));
try {
  const lease = await VMDisk.allocate(randomUUID(), work, join(work, 'base'));
  console.log(JSON.stringify({ disk: lease.disk }));
  await stop;
  await lease.dispose(false);
} catch (error) {
  console.log(JSON.stringify({ error: String(error) }));
  process.exitCode = 1;
} finally {
  lines.close();
}
