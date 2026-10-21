import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { startHost } from '../apps/host/transport/server.js';
import { mkdir, readFile, stat, writeFile, open } from 'node:fs/promises';
import { VMDisk } from '../apps/host/evolution/sandbox/vm-disk.js';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { createServer, connect, type Server } from 'node:net';
import { createSocket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { networkInterfaces } from 'node:os';

// This exercises an experimental SDK helper. It does not grant publication.
const command = promisify(execFile);
const work = resolve(process.env.AGENT_D4_VM_WORK ?? 'release/d4-execution-work');
const output = resolve('release/d4-vm-evidence');
const helper = resolve('release/d4-execution/bin/d4-vm-owner');
const observer = resolve('release/d4-execution/bin/d4-vm-observer');
await mkdir(output, { recursive: true });
const prepared = JSON.parse(await readFile(join(work, 'prepared.json'), 'utf8')) as { rootfs: string; initfs: string };
const base = JSON.parse(await readFile(join(work, 'config.json'), 'utf8')) as Record<string, unknown>;
const probe = await readFile(resolve('scripts/d4-vm-guest-probe.py'), 'utf8');
const dependencyProbe = await readFile(resolve('scripts/d4-vm-dependency-probe.py'), 'utf8');
const dependencyFixtures = JSON.parse(
  (await command('python3', ['scripts/d4-vm-dependency-probe.py', '--fixtures'], { maxBuffer: 65536 })).stdout,
) as Array<{ name: string; sha256: string; base64: string }>;
const host = await startHost({
  dataDir: join(work, `host-probe-${randomUUID()}`),
  key: randomBytes(32),
  token: randomBytes(32).toString('hex'),
});
const fake = fauxProvider({
  models: [{ id: 'resource-observer', contextWindow: 100000, maxTokens: 256 }],
  tokensPerSecond: 100000,
});
host.service.runtime.registerNativeProvider(fake.provider);
const hostSession = await host.service.create(work, fake.provider.id, 'resource-observer');
const hostBusiness = async () => {
  const marker = 'host-resource-service-' + randomUUID();
  const startedAt = Date.now();
  fake.setResponses([
    fauxAssistantMessage(fauxToolCall('bash', { command: 'printf ' + marker }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('host-done'),
  ]);
  await host.service.prompt(hostSession.id, 'Run the fixed Host service probe.');
  while ((await host.service.viewSession(hostSession.id)).busy) {
    if (Date.now() - startedAt > 15000) throw new Error('host_business_probe_timeout');
    await delay(10);
  }
  const state = await host.service.viewSession(hostSession.id);
  assert.ok(
    state.messages.some(
      (m) =>
        m.role === 'toolResult' && !m.isError && m.content.some((part) => part.type === 'text' && part.text === marker),
    ),
  );
  // This proves a fresh concurrent Host call, not overlap with enforcement.
  return { completed: true, marker, startedAt, completedAt: Date.now(), pressureOverlapProven: false };
};
type Identity = { pid: number; startAbsolute: number; physicalFootprint: number };
const inspect = async (pid: number): Promise<Identity | { pid: number; absent: true }> => {
  const result = JSON.parse((await command(observer, [String(pid)], { timeout: 2000 })).stdout);
  if (result.pid !== pid || (result.absent !== true && !Number.isSafeInteger(result.startAbsolute)))
    throw new Error('observer_invalid');
  return result;
};
const receipt = {
  time: new Date().toISOString(),
  baseline: 'b01acb8',
  sdk: '0.52.1',
  admission: false,
  helper: JSON.parse(await readFile(resolve('release/d4-execution/bin/owner.json'), 'utf8')) as unknown,
  dependencyFixtures: dependencyFixtures.map(({ name, sha256 }) => ({ name, sha256 })),
  scope: 'experimental VM probes; formal path has separate receipt; no D4 admission',
  cases: [] as Record<string, unknown>[],
  blockers: ['host_preparation_and_ipc_aggregate_limits_unproven', 'full_six_item_acceptance_incomplete'],
};
const receiptId = randomUUID();
const networkServers: Server[] = [];
const udp = createSocket('udp4');
const address = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && !a.internal && a.family === 'IPv4')?.address;
assert.ok(address, 'Host non-loopback IPv4 required for paired network probes');
const listen = async (hostname?: string, path?: string) => {
  const server = createServer((socket) => {
    socket.on('error', () => {});
    socket.end();
  });
  networkServers.push(server);
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    if (path) server.listen(path, ok);
    else server.listen(0, hostname, ok);
  });
  return server;
};
const positive = async (hostname: string, port?: number) =>
  new Promise<void>((ok, fail) => {
    const socket = port ? connect(port, hostname) : connect(hostname);
    socket.once('connect', () => {
      socket.destroy();
      ok();
    });
    socket.once('error', fail);
    socket.setTimeout(3000, () => {
      socket.destroy();
      fail(Error('Host network positive timeout'));
    });
  });
let networkTargets: Record<string, string | number> = {};
const setupNetwork = async () => {
  const tcp = await listen(address),
    tcp6 = await listen('::1');
  const port = (server: Server) => {
    const bound = server.address();
    assert.ok(bound && typeof bound !== 'string');
    return bound.port;
  };
  const unixPath = join(work, 'network-probe.sock');
  await listen(undefined, unixPath);
  await positive(address, port(tcp));
  await positive('::1', port(tcp6));
  await positive(unixPath);
  await new Promise<void>((ok) => udp.bind(0, address, ok));
  await new Promise<void>((ok, fail) => {
    udp.once('message', () => ok());
    const client = createSocket('udp4');
    client.send('positive', udp.address().port, address, (error) => {
      client.close();
      if (error) fail(error);
    });
  });
  const dnsAddress = (await lookup('example.com', { family: 4 })).address;
  networkTargets = { address, tcp: port(tcp), tcp6: port(tcp6), udp: udp.address().port, unix: unixPath, dnsAddress };
  Object.assign(receipt, {
    networkPositiveControls: { ...networkTargets, tcp: true, tcp6: true, udp: true, unix: true, dns: true },
  });
};
const persist = async () => {
  const bytes = JSON.stringify(receipt, null, 2) + '\n';
  await writeFile(join(output, `receipt-${receiptId}.json`), bytes);
  await writeFile(join(output, 'receipt.json'), bytes);
};
await command('codesign', ['--verify', '--strict', helper]);

async function run(mode: string, role: 'A' | 'B', cancellation?: 'eof' | 'kill') {
  const id = randomUUID();
  const lease = await VMDisk.allocate(id, work, prepared.rootfs);
  const disk = lease.disk;
  let stopped = false;
  let inherited: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const hostCanary = join(work, `host-canary-${role}`);
    const hostToken = 'host-private-' + randomBytes(16).toString('hex');
    await writeFile(hostCanary, hostToken);
    inherited = await open(hostCanary, 'r');
    const positiveFD = Buffer.alloc(128);
    assert.equal((await inherited.read(positiveFD, 0, 128, 0)).bytesRead, hostToken.length);
    const other = role === 'A' ? 'B' : 'A';
    const denied = ['workspace', 'cache', 'build', 'tmp'].flatMap((p) => [
      `/tmp/${other}/${p}/canary`,
      `/tmp/${role}/../${other}/${p}/canary`,
    ]);
    denied.push(hostCanary, prepared.rootfs, disk);
    const config = {
      ...base,
      activityId: id,
      rootfs: disk,
      initfs: prepared.initfs,
      nodeExecutable: join(work, 'node-linux'),
      ...(mode === 'dependencies' ? { runtimeArchive: join(work, 'runtime.tar') } : {}),
      arguments: [
        '/usr/local/bin/python3',
        '-c',
        mode === 'dependencies' ? dependencyProbe : probe,
        mode,
        role,
        JSON.stringify(denied),
        JSON.stringify(mode === 'network' ? networkTargets : dependencyFixtures),
      ],
      deadlineSeconds: mode === 'detached' ? 6 : mode === 'dependencies' ? 90 : 30,
    };
    const configPath = lease.config;
    await writeFile(configPath, JSON.stringify(config));
    const begin = performance.now();
    await lease.launch();
    const child = spawn(helper, ['--probe', configPath], { stdio: ['pipe', 'pipe', 'pipe', inherited.fd] });
    const events: Record<string, unknown>[] = [];
    let pending = '',
      stderr = '',
      outputBytes = 0,
      readyMs: number | undefined,
      canceled = false;
    let stdout = '',
      overflow = false;
    let hostProgress: ReturnType<typeof hostBusiness> | undefined;
    child.stdout!.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 8 * 1024 * 1024) {
        overflow = true;
        child.kill('SIGKILL');
        return;
      }
      pending += chunk.toString('utf8');
      for (;;) {
        const end = pending.indexOf('\n');
        if (end < 0) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.kind === 'output') {
          const bytes = Buffer.from(String(event.base64), 'base64');
          if (stdout.length < 65536) stdout += bytes.subarray(0, 65536 - stdout.length).toString('utf8');
          events.push({ kind: 'output', stream: event.stream, bytes: bytes.length });
        } else {
          events.push(event);
          if (event.kind === 'ready') readyMs = performance.now() - begin;
        }
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderr.length < 65536) stderr += chunk.toString('utf8');
    });
    let finished = false;
    const closed = new Promise<{ code: number | null; signal: string | null }>((ok, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        finished = true;
        ok({ code, signal });
      });
    });
    const bound = new Map<number, Identity>();
    const samples: Identity[] = [];
    const monitor = (async () => {
      while (!finished) {
        const listing = (await command('ps', ['-axo', 'pid=,comm='])).stdout;
        const candidates = listing
          .split('\n')
          .filter((s) => s.includes('Virtualization'))
          .map((s) => Number(s.trim().split(/\s+/)[0]));
        for (const pid of candidates) {
          try {
            const open = (await command('lsof', ['-nP', '-p', String(pid), '-F', 'n'], { maxBuffer: 1024 * 1024 }))
              .stdout;
            if (!open.split('\n').includes(`n${disk}`)) continue;
            const identity = await inspect(pid);
            if (!('absent' in identity)) {
              bound.set(pid, identity);
              if (bound.size === 1) await lease.bind([...bound.values()]);
              samples.push(identity);
            }
          } catch {
            /* lack of observation is a missing proof, never success */
          }
        }
        if (cancellation && !canceled && events.some((e) => e.kind === 'output') && bound.size) {
          canceled = true;
          if (cancellation === 'eof') child.stdin!.end();
          else child.kill('SIGKILL');
        }
        if (
          role === 'A' &&
          ['cpu', 'pids', 'threads', 'memory', 'output', 'storage'].includes(mode) &&
          readyMs !== undefined &&
          !hostProgress
        )
          hostProgress = hostBusiness();
        if (performance.now() - begin > (mode === 'dependencies' ? 100000 : 45000)) child.kill('SIGKILL');
        await delay(150);
      }
    })();
    const exit = await closed;
    await monitor;
    const identities = [...bound.values()];
    let gone = false;
    for (let i = 0; i < 40; i++) {
      const current = await Promise.all(identities.map((p) => inspect(p.pid)));
      gone =
        identities.length > 0 &&
        current.every((p, n) => 'absent' in p || p.startAbsolute !== identities[n]!.startAbsolute);
      if (gone) break;
      await delay(100);
    }
    const diskInfo = await stat(disk);
    stopped = gone;
    const result = {
      id,
      role,
      mode,
      cancellation,
      canceled,
      exit,
      readyMs,
      elapsedMs: performance.now() - begin,
      identities,
      gone,
      samples,
      events,
      stdout,
      stderr,
      outputBytes,
      overflow,
      disk: { path: disk, bytes: diskInfo.size, allocatedBytes: diskInfo.blocks * 512 },
      // Self-reported business/assertions and supervisor/OS observations stay separate.
      workloadReportOnly: true,
      hostFDInjected: {
        descriptor: 3,
        readableInHost: positiveFD.toString('utf8', 0, hostToken.length) === hostToken,
        leakedToGuest: stdout.includes(Buffer.from(hostToken).toString('base64')),
      },
      hostBusiness: await hostProgress,
    };
    receipt.cases.push(result);
    await writeFile(join(output, `${id}.json`), JSON.stringify(result, null, 2) + '\n');
    await persist();
    console.log(
      JSON.stringify({
        mode,
        role,
        ...exit,
        readyMs,
        boundVMs: identities.length,
        gone,
        stderr,
        stdout: stdout.slice(0, 1000),
      }),
    );
    assert.equal(overflow, false, 'owner IPC exceeded observer budget');
    assert.equal(result.hostFDInjected.leakedToGuest, false, 'inherited Host FD crossed the VM boundary');
    assert.ok(gone, 'actual VZ process exit must be confirmed');
    if (mode === 'boundary' || mode === 'dependencies' || mode === 'network')
      assert.ok(
        events.some((e) => e.kind === 'workloadExited' && e.exitCode === 0),
        'positive and negative boundary workload must succeed',
      );
    if (mode === 'pids' || mode === 'threads')
      assert.ok(
        events.some((e) => e.kind === 'statistics' && e.tasks === 128),
        'aggregate task limit observed',
      );
    if (mode === 'memory')
      assert.ok(
        events.some((e) => e.kind === 'workloadExited' && e.exitCode === 137),
        'aggregate OOM kills workload',
      );
    if (mode === 'memory')
      assert.ok(
        events.some((e) => Number(e.oomKill) > 0),
        'trusted supervisor observed cgroup OOM counter',
      );
    if (mode === 'cpu')
      assert.ok(
        events.some((e) => e.kind === 'statistics' && Number(e.throttledUsec) > 1000000),
        'aggregate CPU throttling observed',
      );
    if (mode === 'output')
      assert.ok(
        events.some((e) => e.reason === 'output_limit'),
        'combined output limit observed',
      );
    if (mode === 'storage')
      assert.equal(stdout.split('"errno": 28').length - 1, 2, 'both writers hit aggregate filesystem limit');
    return result;
  } finally {
    try {
      await lease.dispose(stopped);
    } finally {
      await inherited?.close();
    }
  }
}

async function paired<T>(activities: Promise<T>[]): Promise<T[]> {
  // A failed assertion must not abandon another Activity's VM/disk cleanup.
  const settled = await Promise.allSettled(activities);
  const failures = settled.filter((result) => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      'D4 paired probes failed',
    );
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

try {
  await setupNetwork();
  await persist();
  const pair = await paired([run('boundary', 'A'), run('boundary', 'B')]);
  if (
    pair.some(
      (r) => r.exit.code !== 0 || !r.gone || !r.events.some((e) => e.kind === 'workloadExited' && e.exitCode === 0),
    )
  ) {
    receipt.blockers.push('basic_vm_boundary_or_shutdown_probe_failed');
    await persist();
    process.exitCode = 1;
  } else {
    await paired([run('dependencies', 'A'), run('dependencies', 'B')]);
    await paired([run('network', 'A'), run('network', 'B')]);
    for (const mode of ['cpu', 'pids', 'threads', 'memory', 'output', 'storage'])
      await paired([run(mode, 'A'), run('boundary', 'B')]);
    await run('detached', 'A', 'eof');
    await run('detached', 'A', 'kill');
    await run('detached', 'A');
  }
} finally {
  try {
    await host.close();
  } finally {
    await Promise.allSettled([
      new Promise<void>((ok, fail) => {
        try {
          udp.close(ok);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ERR_SOCKET_DGRAM_NOT_RUNNING') ok();
          else fail(error);
        }
      }),
      ...networkServers.map((server) => new Promise<void>((ok) => server.close(() => ok()))),
    ]);
  }
}
