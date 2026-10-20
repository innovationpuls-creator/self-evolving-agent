import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
