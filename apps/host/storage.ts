import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SessionManager, type SessionHeader, type SessionEntry } from '@earendil-works/pi-coding-agent';

const aad = Buffer.from('agent-encrypted-v1');
export class EncryptedStore {
  constructor(
    readonly dir: string,
    private readonly key: Buffer,
  ) {
    if (key.length !== 32) throw new Error('需要 32 字节的数据密钥');
  }
  async write(name: string, value: unknown) {
    const path = join(this.dir, name);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(aad);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const envelope = JSON.stringify({
      v: 1,
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    });
    const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      const file = await open(temp, 'wx', 0o600);
      try {
        await file.writeFile(envelope);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, path);
      // Windows does not support opening directories for fsync.
      if (process.platform !== 'win32') {
        const directory = await open(dirname(path), 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
  async read<T>(name: string): Promise<T | undefined> {
    let bytes: string;
    try {
      bytes = await readFile(join(this.dir, name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const envelope = JSON.parse(bytes);
    if (envelope.v !== 1) throw new Error('不支持的数据格式');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.nonce, 'base64'));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'),
    ) as T;
  }
}
export interface Snapshot {
  header: SessionHeader;
  entries: SessionEntry[];
  leafId: string | null;
}
export function snapshot(manager: SessionManager): Snapshot {
  const header = manager.getHeader();
  if (!header) throw new Error('会话没有有效头信息');
  return structuredClone({ header, entries: manager.getEntries(), leafId: manager.getLeafId() });
}
export function restore(saved: Snapshot) {
  if (
    !saved ||
    !saved.header ||
    !Array.isArray(saved.entries) ||
    (saved.leafId !== null && !saved.entries.some((entry) => entry.id === saved.leafId))
  )
    throw new Error('会话检查点结构无效');
  const manager = SessionManager.inMemory(saved.header.cwd, { id: saved.header.id }, [saved.header, ...saved.entries]);
  if (saved.leafId === null) manager.resetLeaf();
  else if (saved.leafId !== manager.getLeafId()) manager.branch(saved.leafId);
  return manager;
}

/** Detached boundary projection; the authoritative Pi transcript is never changed. */
export class SensitiveData {
  private known = new Set<string>();
  add(value: unknown): void {
    if (typeof value === 'string' && value.length >= 8) this.known.add(value);
    else if (Array.isArray(value))
      value.forEach((v) => {
        this.add(v);
      });
    else if (value && typeof value === 'object')
      Object.values(value).forEach((v) => {
        this.add(v);
      });
  }
  text(value: string, partial = false): string {
    let text = value;
    // Compute matches against the original text so overlapping credentials cannot expose prefixes.
    const spans: Array<[number, number]> = [];
    let suffix = 0;
    for (const secret of this.known) {
      let start = value.indexOf(secret),
        span: [number, number] | undefined;
      while (start !== -1) {
        const end = start + secret.length;
        if (span && start <= span[1]) span[1] = end;
        else {
          span = [start, end];
          spans.push(span);
        }
        start = value.indexOf(secret, start + 1);
      }
      if (partial)
        for (let n = Math.min(secret.length - 1, value.length); n > suffix; n--) {
          if (value.endsWith(secret.slice(0, n))) {
            suffix = n;
            break;
          }
        }
    }
    if (suffix) spans.push([value.length - suffix, value.length]);
    spans.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const span of spans) {
      const last = merged.at(-1);
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push(span);
    }
    const chunks: string[] = [];
    let offset = 0;
    for (const [start, end] of merged) {
      chunks.push(value.slice(offset, start), '[已保护]');
      offset = end;
    }
    chunks.push(value.slice(offset));
    text = chunks.join('');
    return text
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[已保护]')
      .replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]*/g, '[已保护]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已保护]')
      .replace(
        /((?:password|passwd|authorization|api[_-]?(?:key|token)|access(?:[_-]?token)?|refresh(?:[_-]?token)?|token|secret|private[_-]?key)\s*["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;"']+)/gi,
        '$1[已保护]',
      )
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[身份信息已保护]')
      .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[身份信息已保护]')
      .replace(
        /(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?!\d)/g,
        '[身份信息已保护]',
      );
  }
  copy<T>(value: T, partial = false): T {
    const secretKey =
      /^(password|passwd|authorization|api[_-]?(?:key|token)|access(?:[_-]?token)?|refresh(?:[_-]?token)?|token|secret|private[_-]?key)$/i;
    const walk = (item: unknown, schema = false): unknown => {
      if (typeof item === 'string') return this.text(item, partial);
      if (Array.isArray(item)) return item.map((v) => walk(v, schema));
      if (item && typeof item === 'object')
        return Object.fromEntries(
          Object.entries(item).map(([k, v]) => [
            k,
            !schema && secretKey.test(k)
              ? '[已保护]'
              : walk(
                  v,
                  schema ||
                    ((k === 'schema' || k === 'parameters') &&
                      !!v &&
                      typeof v === 'object' &&
                      ('properties' in v || 'type' in v)),
                ),
          ]),
        );
      return item;
    };
    return walk(value) as T;
  }
}
