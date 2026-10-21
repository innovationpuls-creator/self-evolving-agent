import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
export function workerChannel<T>() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const abort = new AbortController();
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + '\n');
  let begin!: (start: T) => void;
  const starting = new Promise<T>((resolve) => {
    begin = resolve;
  });
  let started = false;
  const stop = () => {
    abort.abort();
    for (const waiter of pending.values()) waiter.reject(new Error('d4_cancelled'));
    pending.clear();
  };
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.kind === 'start' && !started) {
        started = true;
        begin(message);
      } else if (message.kind === 'cancel') stop();
      else if (message.kind === 'response') {
        const waiter = pending.get(message.requestId);
        pending.delete(message.requestId);
        if (message.ok) waiter?.resolve(message.result);
        else waiter?.reject(new Error('d4_host_rejected'));
      } else stop();
    } catch {
      stop();
    }
  });
  lines.on('close', stop);
  return {
    starting,
    signal: abort.signal,
    request(operation: string, input: unknown): Promise<unknown> {
      abort.signal.throwIfAborted();
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        send({ kind: 'request', requestId, operation, input });
      });
    },
    finish(ok: boolean) {
      send({ kind: 'finished', ok, ...(ok ? {} : { error: 'd4_worker_failed' }) });
      lines.close();
    },
  };
}
