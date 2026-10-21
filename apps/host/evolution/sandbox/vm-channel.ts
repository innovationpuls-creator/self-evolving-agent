import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { VMAssets } from './vm-assets.js';
import { VMDisk } from './vm-disk.js';
const command = promisify(execFile);
type Identity = { pid: number; startAbsolute: number; physicalFootprint: number };
const closures = new WeakMap<object, string>();
export interface VMClosure {
  readonly activityId: string;
  readonly stoppedAt: number;
  readonly identities: readonly Identity[];
  readonly runtimeDigest: string;
  readonly limits: Readonly<Record<string, number>>;
}
export function isVerifiedVMClosure(value: unknown, activityId: string): value is VMClosure {
  return typeof value === 'object' && value !== null && closures.get(value) === activityId;
}
export interface VMProbeConfiguration {
  helper: string;
  observer: string;
  work: string;
  assets?: VMAssets;
}

/** Experimental transport. Never treats Guest JSON or SDK stop() as OS proof. */
export class VMChannel {
  readonly id = randomUUID();
  private child?: ChildProcessWithoutNullStreams;
  private identities: Identity[] = [];
  private ended?: Promise<void>;
  private closing?: Promise<void>;
  private revoked = false;
  private waiters = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private wireBytes = 0;
  private proof?: VMClosure;
  private disk?: VMDisk;
  private opening?: Promise<void>;
  get closure(): VMClosure | undefined {
    return this.proof;
  }
  readonly events: unknown[] = [];
  constructor(private options: VMProbeConfiguration) {}
  private closeInBackground() {
    void this.close().catch((error: unknown) => {
      this.events.push({ kind: 'shutdownObservationFailed', error: String(error) });
    });
  }
  private async inspect(pid: number): Promise<Identity | { pid: number; absent: true }> {
    await this.options.assets?.verifyObserver(this.options.observer);
    const result = JSON.parse((await command(this.options.observer, [String(pid)], { timeout: 2000 })).stdout);
    if (
      result.pid !== pid ||
      (result.absent !== true &&
        (!Number.isSafeInteger(result.startAbsolute) || !Number.isSafeInteger(result.physicalFootprint)))
    )
      throw new Error('isolated_observation_invalid');
    return result;
  }
  start(): Promise<void> {
    if (!this.opening) this.opening = this.open();
    return this.opening.catch(async (error: unknown) => {
      try {
        await this.close();
      } catch (cleanup) {
        this.events.push({ kind: 'shutdownObservationFailed', error: String(cleanup) });
      }
      throw error;
    });
  }
  private async open() {
    if (this.revoked) throw new Error('isolated_start_revoked');
    await this.options.assets?.verify(this.options);
    if (this.revoked) throw new Error('isolated_start_revoked');
    if (this.options.assets) await VMDisk.recover((pid) => this.inspect(pid));
    if (this.revoked) throw new Error('isolated_start_revoked');
    const { work, helper } = this.options;
    const prepared = JSON.parse(await readFile(join(work, 'prepared.json'), 'utf8')) as {
      rootfs: string;
      initfs: string;
    };
    const base = JSON.parse(await readFile(join(work, 'config.json'), 'utf8')) as Record<string, unknown>;
    this.disk = await VMDisk.allocate(this.id, work, prepared.rootfs);
    const disk = this.disk.disk;
    const config = {
      ...base,
      activityId: this.id,
      rootfs: disk,
      initfs: prepared.initfs,
      nodeExecutable: join(work, 'node-linux'),
      runtimeArchive: join(work, 'runtime.tar'),
      deadlineSeconds: 300,
      arguments: [
        '/usr/local/bin/python3',
        '-c',
        "import os,time\nfor _ in range(1500):\n try:\n  if os.path.exists('/opt/runtime/ready'): break\n except PermissionError: pass\n time.sleep(.02)\nelse: raise RuntimeError('runtime_not_ready')\nos.execv('/usr/local/bin/node',['node','/opt/runtime/worker.mjs'])",
      ],
    };
    const path = this.disk.config;
    await writeFile(path, JSON.stringify(config));
    await command('codesign', ['--verify', '--strict', helper]);
    if (this.revoked) throw new Error('isolated_start_revoked');
    await this.disk.launch();
    if (this.revoked) {
      await this.disk.dispose(true);
      this.disk = undefined;
      throw new Error('isolated_start_revoked');
    }
    this.child = spawn(helper, ['--probe', path], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.ended = new Promise<void>((ok) => this.child!.once('close', () => ok()));
    let pending = '',
      guest = '',
      bytes = 0,
      stderrBytes = 0;
    this.child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) {
        this.closeInBackground();
        return;
      }
      pending += chunk.toString('utf8');
      try {
        for (;;) {
          const end = pending.indexOf('\n');
          if (end < 0) break;
          const event = JSON.parse(pending.slice(0, end)) as Record<string, unknown>;
          pending = pending.slice(end + 1);
          if (event.kind !== 'output' || this.events.length < 2048)
            this.events.push(event.kind === 'output' ? { kind: 'output', stream: event.stream } : event);
          if (event.kind !== 'output') continue;
          const data = Buffer.from(String(event.base64), 'base64').toString('utf8');
          if (event.stream === 'stderr') {
            if (stderrBytes < 32768) this.events.push({ stderr: data.slice(0, 32768 - stderrBytes) });
            stderrBytes += Buffer.byteLength(data);
            continue;
          }
          guest += data;
          if (guest.length > 65536) throw new Error('isolated_response_limit');
          for (;;) {
            const newline = guest.indexOf('\n');
            if (newline < 0) break;
            const response = JSON.parse(guest.slice(0, newline)) as { id: string; value?: unknown; error?: string };
            guest = guest.slice(newline + 1);
            const waiter = this.waiters.get(response.id);
            if (!waiter) throw new Error('isolated_unexpected_response');
            this.waiters.delete(response.id);
            if (response.error) waiter.reject(new Error('isolated_guest_rejected:' + response.error));
            else waiter.resolve(response.value);
          }
        }
      } catch {
        this.closeInBackground();
      }
    });
    this.child.stderr.on('data', (chunk: Buffer) => {
      if (this.events.length < 2000) this.events.push({ ownerStderr: chunk.toString('utf8').slice(0, 4096) });
    });
    this.child.once('error', () => {
      this.closeInBackground();
    });
    this.child.once('close', () => {
      this.revoked = true;
      for (const waiter of this.waiters.values()) waiter.reject(new Error('isolated_vm_closed'));
      this.waiters.clear();
    });
    for (let n = 0; n < 300; n++) {
      if (this.revoked) throw new Error('isolated_start_failed:' + JSON.stringify(this.events));
      if (this.events.some((e) => (e as { kind?: string }).kind === 'ready')) break;
      if (n === 299) {
        throw new Error('isolated_start_timeout');
      }
      await delay(100);
    }
    const listing = (await command('ps', ['-axo', 'pid=,comm='])).stdout;
    for (const line of listing.split('\n').filter((s) => s.includes('Virtualization'))) {
      const pid = Number(line.trim().split(/\s+/)[0]);
      try {
        const files = (await command('lsof', ['-nP', '-p', String(pid), '-F', 'n'])).stdout;
        if (!files.split('\n').includes(`n${disk}`)) continue;
        const identity = await this.inspect(pid);
        if (!('absent' in identity)) this.identities.push(identity);
      } catch {
        /* Fail closed below when OS identity cannot be bound. */
      }
    }
    if (this.identities.length !== 1) {
      throw new Error('isolated_vm_identity_unproven');
    }
    await this.disk.bind(this.identities);
    this.events.push({
      kind: 'externalVMBound',
      activityId: this.id,
      disk,
      identities: this.identities.map((p) => ({ ...p })),
    });
  }
  async request(value: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (this.revoked || !this.child || signal?.aborted) throw new Error('isolated_revoked');
    const id = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ ...value, id }) + '\n');
    this.wireBytes += bytes.length;
    if (bytes.length > 65536 || this.wireBytes > 32 * 1024 * 1024) {
      await this.close();
      throw new Error('isolated_input_limit');
    }
    const promise = new Promise<unknown>((resolve, reject) => this.waiters.set(id, { resolve, reject }));
    const cancel = () => {
      this.closeInBackground();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 30000);
    this.child.stdin.write(bytes);
    try {
      return await promise;
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.revoked = true;
    for (const waiter of this.waiters.values()) waiter.reject(new Error('isolated_revoked'));
    this.waiters.clear();
    this.closing = (async () => {
      // Revocation prevents spawn after allocation; wait for the in-flight start
      // before releasing its files. open() never calls close() recursively.
      await this.opening?.catch(() => {});
      this.child?.stdin.end();
      const timer = setTimeout(() => this.child?.kill('SIGKILL'), 6000);
      try {
        await this.ended;
      } finally {
        clearTimeout(timer);
      }
      if (!this.child) {
        await this.disk?.dispose(false);
        return;
      }
      if (this.identities.length !== 1) throw new Error('isolated_vm_shutdown_unproven');
      for (let n = 0; n < 100; n++) {
        const current = await Promise.all(this.identities.map((p) => this.inspect(p.pid)));
        if (current.every((p, i) => 'absent' in p || p.startAbsolute !== this.identities[i]!.startAbsolute)) {
          await this.disk?.dispose(true);
          this.events.push({ kind: 'temporaryDiskRemoved', activityId: this.id });
          if (this.identities.length === 1 && this.options.assets) {
            this.proof = Object.freeze({
              activityId: this.id,
              stoppedAt: Date.now(),
              runtimeDigest: this.options.assets.digest,
              limits: Object.freeze({
                memoryBytes: 1073741824,
                cpuQuotaMicros: 100000,
                cpuPeriodMicros: 100000,
                tasks: 128,
                diskBytes: 2147483648,
                outputBytes: 4194304,
                inputBytes: 33554432,
                deadlineSeconds: 300,
              }),
              identities: Object.freeze(this.identities.map((p) => Object.freeze({ ...p }))),
            });
            closures.set(this.proof, this.id);
            this.events.push({
              kind: 'externalVMGone',
              activityId: this.id,
              runtimeDigest: this.options.assets.digest,
              identities: this.proof.identities,
              stoppedAt: this.proof.stoppedAt,
            });
          }
          return;
        }
        await delay(100);
      }
      throw new Error('isolated_vm_shutdown_unproven');
    })();
    const attempt = this.closing;
    void attempt.catch(() => {
      if (this.closing === attempt) this.closing = undefined;
    });
    return attempt;
  }
}
