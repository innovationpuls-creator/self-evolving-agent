import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const permissionProfile = 'd4-offline-prototype-v1' as const;
const fileSchema = z.object({ path: z.string().min(1).max(240), base64: z.string().max(1400000) }).strict();
export const exportSchema = z
  .object({
    runId: z.string().uuid(),
    goalHash: z.string().regex(/^[a-f0-9]{64}$/),
    permissionProfile: z.literal(permissionProfile),
    files: z.array(fileSchema).min(1).max(128),
  })
  .strict();
export type CandidateExport = z.infer<typeof exportSchema>;
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function candidateFiles(input: unknown) {
  const value = exportSchema.parse(input);
  const seen = new Set<string>();
  let total = 0;
  const files = value.files
    .map((f) => {
      if (
        !/^[a-zA-Z0-9_.@/-]+$/.test(f.path) ||
        f.path.split('/').some((p) => !p || p === '.' || p === '..') ||
        f.path.startsWith('/')
      )
        throw new Error('candidate_path_invalid');
      if (seen.has(f.path)) throw new Error('candidate_path_duplicate');
      seen.add(f.path);
      const bytes = Buffer.from(f.base64, 'base64');
      if (bytes.toString('base64') !== f.base64) throw new Error('candidate_encoding_invalid');
      total += bytes.length;
      if (total > 4 * 1024 * 1024 || bytes.length > 1024 * 1024) throw new Error('candidate_too_large');
      return { path: f.path, bytes, sha256: sha256(bytes) };
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
  for (const f of files)
    if (files.some((other) => other.path.startsWith(f.path + '/'))) throw new Error('candidate_path_collision');
  const identity = {
    runId: value.runId,
    goalHash: value.goalHash,
    permissionProfile: value.permissionProfile,
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
  };
  return { value, files, identity, digest: sha256(JSON.stringify(identity)) };
}
/** Host-owned staging. Export is never an import, review or publication request. */
export class CandidateStaging {
  private revoked = false;
  private digest?: string;
  private accepted?: ReturnType<typeof candidateFiles>;
  constructor(
    readonly directory: string,
    private readonly runId: string,
    private readonly goalHash: string,
  ) {}
  async accept(raw: unknown) {
    if (this.revoked || this.accepted) throw new Error('candidate_export_revoked_or_duplicate');
    const candidate = candidateFiles(raw);
    if (candidate.value.runId !== this.runId || candidate.value.goalHash !== this.goalHash)
      throw new Error('candidate_authorization_mismatch');
    // Reserve before awaiting to reject concurrent duplicate exports.
    this.accepted = candidate;
    try {
      await mkdir(this.directory, { recursive: false, mode: 0o700 });
      for (const file of candidate.files) {
        if (this.revoked) throw new Error('candidate_revoked');
        const path = join(this.directory, file.path);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, file.bytes, { flag: 'wx', mode: 0o600 });
      }
      if (this.revoked) throw new Error('candidate_revoked');
      this.digest = candidate.digest;
      return { digest: candidate.digest };
    } catch (error) {
      this.revoked = true;
      await rm(this.directory, { recursive: true, force: true });
      throw error;
    }
  }
  async verify(executionClosed: boolean, descendantsStopped: boolean) {
    if (this.revoked || !this.accepted || !this.digest || !executionClosed || !descendantsStopped)
      throw new Error('candidate_not_frozen');
    return this.inspect();
  }
  /** Byte inspection alone does not attest descendant cleanup or authorize import. */
  async inspect() {
    if (this.revoked || !this.accepted || !this.digest) throw new Error('candidate_unavailable');
    const actual: string[] = [];
    const scan = async (dir: string) => {
      for (const name of await readdir(join(this.directory, dir))) {
        const path = dir ? `${dir}/${name}` : name;
        const info = await lstat(join(this.directory, path));
        if (info.isSymbolicLink()) throw new Error('candidate_symlink');
        if (info.isDirectory()) await scan(path);
        else if (info.isFile()) actual.push(path);
        else throw new Error('candidate_special_file');
      }
    };
    if (!(await lstat(this.directory)).isDirectory() || (await lstat(this.directory)).isSymbolicLink())
      throw new Error('candidate_directory_changed');
    await scan('');
    if (JSON.stringify(actual.sort()) !== JSON.stringify(this.accepted.files.map((f) => f.path).sort()))
      throw new Error('candidate_membership_changed');
    for (const file of this.accepted.files) {
      if (sha256(await readFile(join(this.directory, file.path))) !== file.sha256) throw new Error('candidate_changed');
    }
    return { ...this.accepted.identity, digest: this.digest, export: this.accepted.value };
  }
  async revoke() {
    this.revoked = true;
    await rm(this.directory, { recursive: true, force: true });
  }
}
