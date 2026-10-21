import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
const command = promisify(execFile);
export async function hashFile(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
/** Frozen trusted-side inputs. Rechecked for every VM, never supplied by Guest. */
export class VMAssets {
  private constructor(
    readonly hashes: ReadonlyMap<string, string>,
    readonly digest: string,
    readonly team: string,
  ) {}
  static async capture(options: { helper: string; observer: string; work: string }) {
    const configPath = join(options.work, 'config.json'),
      preparedPath = join(options.work, 'prepared.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { kernel: string };
    const prepared = JSON.parse(await readFile(preparedPath, 'utf8')) as { rootfs: string; initfs: string };
    const manifest = JSON.parse(await readFile(join(dirname(options.helper), 'owner.json'), 'utf8')) as {
      team: string;
      sha256: string;
      observerSha256: string;
    };
    if (!/^[A-Z0-9]{10}$/.test(manifest.team)) throw new Error('isolated_signing_team_missing');
    const hashes = new Map<string, string>();
    for (const path of [
      options.helper,
      options.observer,
      configPath,
      preparedPath,
      config.kernel,
      prepared.rootfs,
      prepared.initfs,
      join(options.work, 'node-linux'),
      join(options.work, 'runtime.tar'),
    ])
      hashes.set(path, await hashFile(path));
    if (hashes.get(options.helper) !== manifest.sha256 || hashes.get(options.observer) !== manifest.observerSha256)
      throw new Error('isolated_binary_manifest_mismatch');
    const digest = createHash('sha256')
      .update(JSON.stringify({ sdk: '0.52.1', pi: '1.3.0', hashes: [...hashes] }))
      .digest('hex');
    const assets = new VMAssets(hashes, digest, manifest.team);
    await assets.signatures(options);
    return assets;
  }
  private async signatures(options: { helper: string; observer: string }) {
    for (const path of [options.helper, options.observer]) {
      await command('codesign', ['--verify', '--strict', path]);
      const signature = (await command('codesign', ['-d', '--verbose=4', path])).stderr;
      if (!signature.includes(`TeamIdentifier=${this.team}\n`) || !signature.includes('Authority=Apple Development:'))
        throw new Error('isolated_signing_identity_mismatch');
    }
  }
  async verify(options: { helper: string; observer: string }) {
    for (const [path, hash] of this.hashes)
      if ((await hashFile(path)) !== hash) throw new Error('isolated_runtime_changed:' + path);
    await this.signatures(options);
  }
  async verifyObserver(path: string) {
    if ((await hashFile(path)) !== this.hashes.get(path)) throw new Error('isolated_observer_changed');
  }
}
