import { spawn, execFile } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const maxLineBytes = 8 * 1024 * 1024;
const serviceId = 'dev.personal.agent.reflection';
const command = promisify(execFile);
interface ProtocolMessage {
  kind: 'request' | 'ready' | 'finished';
  requestId?: string;
  operation?: string;
  input?: unknown;
  ok?: boolean;
  error?: string;
}

export class NativeReflectionExecutor {
  constructor(private readonly appBundle?: string) {}
  private bundle() {
    const supplied = this.appBundle ?? process.env.AGENT_REFLECTION_APP_BUNDLE;
    if (supplied) return resolve(supplied);
    const executable = process.execPath;
    const marker = executable.indexOf('.app/Contents/');
    return marker >= 0 ? executable.slice(0, marker + 4) : undefined;
  }
  private paths(bundle: string) {
    const bridge = join(bundle, 'Contents/Helpers/ReflectionBridge.app');
    const service = join(bridge, `Contents/XPCServices/${serviceId}.xpc`);
    return {
      bridge,
      service,
      helper: join(bridge, 'Contents/MacOS/reflection-bridge'),
      node: join(service, 'Contents/MacOS/ReflectionNode'),
      manifest: join(bridge, 'Contents/Resources/reflection-runtime.json'),
      worker: join(service, 'Contents/Resources/runtime/dist/host/reflection/worker.js'),
    };
  }
  async available(): Promise<{ available: boolean; reason?: string }> {
    if (process.platform !== 'darwin') return { available: false, reason: 'Reflection 原生隔离尚未支持此平台' };
    const bundle = this.bundle();
    if (!bundle) return { available: false, reason: '未配置同版本 Agent.app，Reflection 原生隔离不可用' };
    try {
      const canonical = await realpath(bundle);
      if (!canonical.endsWith('.app')) throw new Error('bundle');
      const paths = this.paths(canonical);
      await Promise.all([access(paths.helper), access(paths.worker), access(paths.node)]);
      const [manifest, current] = await Promise.all([
        readFile(paths.manifest, 'utf8').then(
          (text) => JSON.parse(text) as { protocol: number; version: string; architecture: string },
        ),
        readFile(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8').then(
          (text) => JSON.parse(text) as { version: string },
        ),
      ]);
      if (manifest.protocol !== 1 || manifest.version !== current.version || manifest.architecture !== process.arch)
        throw new Error('version');
      for (const path of [paths.node, paths.service, paths.bridge, canonical]) {
        await command('codesign', ['--verify', '--strict', path], { timeout: 15_000, maxBuffer: 65536 });
      }
      const identity = await command('codesign', ['-d', '--verbose=4', paths.bridge], {
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 65536,
      });
      if (!/TeamIdentifier=[A-Z0-9]{10}(?:\s|$)/.test(identity.stdout + identity.stderr))
        return {
          available: false,
          reason: 'Reflection 需要 Apple Development 或 Developer ID 签名以验证 XPC 对端；当前应用为 ad-hoc 签名',
        };
      for (const [path, inherited] of [
        [paths.service, false],
        [paths.node, true],
      ] as const) {
        const checked = await command('codesign', ['-d', '--entitlements', ':-', path], {
          encoding: 'utf8',
          timeout: 15_000,
          maxBuffer: 65536,
        });
        const conversion = command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], {
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 65536,
        });
        conversion.child.stdin?.end(checked.stdout);
        const entitlements = JSON.parse((await conversion).stdout) as Record<string, unknown>;
        if (
          entitlements['com.apple.security.app-sandbox'] !== true ||
          (inherited && entitlements['com.apple.security.inherit'] !== true) ||
          entitlements['com.apple.security.network.client'] === true ||
          entitlements['com.apple.security.network.server'] === true
        )
          throw new Error('entitlements');
      }
      return { available: true };
    } catch {
      return { available: false, reason: 'Reflection 原生组件缺失、版本不一致或沙箱签名检查失败' };
    }
  }
  async execute(
    start: unknown,
    handle: (operation: string, input: unknown) => Promise<unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const availability = await this.available();
    if (!availability.available) throw new Error(availability.reason);
    const bundle = this.bundle();
    if (!bundle) throw new Error('Reflection 原生组件不可用');
    const paths = this.paths(bundle);
    const initial = JSON.stringify(start);
    if (Buffer.byteLength(initial) > maxLineBytes) throw new Error('Reflection 启动消息过大');
    await new Promise<void>((done, reject) => {
      const child = spawn(paths.helper, [], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
      let buffer = Buffer.alloc(0),
        settled = false,
        finished = false;
      let failure: Error | undefined;
      const requests = new Set<string>();
      const seenRequests = new Set<string>();
      const inFlight = new Set<Promise<unknown>>();
      let killTimer: NodeJS.Timeout | undefined;
      const close = () => {
        signal.removeEventListener('abort', abort);
        child.stdin.end();
        killTimer ??= setTimeout(() => child.kill('SIGKILL'), 3000);
        killTimer.unref();
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        failure = error;
        try {
          void Promise.resolve(handle('cancel', {})).catch(() => {});
        } catch {}
        if (child.stdin.writable) child.stdin.write('{"kind":"cancel"}\n');
        close();
      };
      const abort = () => fail(new Error('Reflection 已取消'));
      signal.addEventListener('abort', abort, { once: true });
      child.stderr.resume(); // Never retain or forward provider/native diagnostics.
      child.stdin.on('error', () => fail(new Error('Reflection IPC 写入失败')));
      child.on('error', () => fail(new Error('Reflection 原生组件启动失败')));
      child.on('close', (code) => {
        if (killTimer) clearTimeout(killTimer);
        if (!failure && (!finished || code !== 0))
          failure = new Error(finished ? 'Reflection 原生组件异常退出' : 'Reflection Worker 已断开');
        if (failure) {
          try {
            void Promise.resolve(handle('cancel', {})).catch(() => {});
          } catch {}
        }
        settled = true;
        void Promise.allSettled([...inFlight]).then(() => {
          if (failure) reject(failure);
          else done();
        });
      });
      child.stdout.on('data', (chunk: Buffer) => {
        if (finished) {
          fail(new Error('Reflection 结束后仍发送消息'));
          return;
        }
        buffer = Buffer.concat([buffer, chunk]);
        while (!settled) {
          const end = buffer.indexOf(10);
          if (end < 0) break;
          if (end > maxLineBytes) {
            fail(new Error('Reflection IPC 消息过大'));
            break;
          }
          const line = buffer.subarray(0, end);
          buffer = buffer.subarray(end + 1);
          let message: ProtocolMessage;
          try {
            message = JSON.parse(line.toString('utf8')) as ProtocolMessage;
          } catch {
            fail(new Error('Reflection IPC 消息无效'));
            break;
          }
          if (!message || typeof message !== 'object' || Array.isArray(message)) {
            fail(new Error('Reflection IPC 消息无效'));
            break;
          }
          if (message.kind === 'ready') continue;
          if (message.kind === 'finished') {
            if (requests.size) {
              fail(new Error('Reflection 在受控操作结束前退出'));
              break;
            }
            finished = true;
            if (message.ok !== true) {
              const code =
                typeof message.error === 'string' && /^[a-z][a-z0-9_]{0,80}$/.test(message.error)
                  ? ` (${message.error})`
                  : '';
              fail(new Error(`Reflection Worker 执行失败${code}`));
              break;
            }
            if (buffer.length) fail(new Error('Reflection 结束后仍发送消息'));
            else close();
            break;
          }
          if (
            message.kind !== 'request' ||
            typeof message.requestId !== 'string' ||
            message.requestId.length > 128 ||
            typeof message.operation !== 'string' ||
            message.operation.length > 128 ||
            seenRequests.has(message.requestId) ||
            requests.size >= 32
          ) {
            fail(new Error('Reflection IPC 请求无效'));
            break;
          }
          const requestId = message.requestId;
          requests.add(requestId);
          seenRequests.add(requestId);
          const respond = (response: unknown) => {
            if (settled || signal.aborted) return;
            let encoded: string;
            try {
              encoded = JSON.stringify(response);
            } catch {
              fail(new Error('Reflection IPC 响应无效'));
              return;
            }
            if (Buffer.byteLength(encoded) > maxLineBytes) {
              fail(new Error('Reflection IPC 响应过大'));
              return;
            }
            child.stdin.write(`${encoded}\n`);
          };
          const operation = message.operation,
            input = message.input;
          const task = Promise.resolve()
            .then(() => handle(operation, input))
            .then(
              (result) => respond({ kind: 'response', requestId, ok: true, result }),
              () => respond({ kind: 'response', requestId, ok: false, error: 'host_operation_failed' }),
            )
            .finally(() => {
              requests.delete(requestId);
              inFlight.delete(task);
            });
          inFlight.add(task);
        }
        if (buffer.length > maxLineBytes) fail(new Error('Reflection IPC 消息过大'));
      });
      child.once('spawn', () => {
        if (!settled) child.stdin.write(`${initial}\n`);
      });
      if (signal.aborted) abort();
    });
  }
}
