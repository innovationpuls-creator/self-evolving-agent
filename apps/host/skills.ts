import { discoverSkillText } from './skill-discovery.js';
import { dependencyIdentity, hostIdentity } from './skill-dependencies.js';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, readdir, lstat, realpath, rm, rename, readlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import {
  DefaultPackageManager,
  SettingsManager,
  loadSkills,
  loadSkillsFromDir,
  type Skill,
} from '@earendil-works/pi-coding-agent';

export class SkillError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export interface Binding {
  skill: string;
  extensions: string[];
  knowledgeFiles?: string[];
}
export interface ImportSkill {
  source: string;
  project?: string;
  bindings?: Binding[];
}
export interface SkillRecord {
  id: string;
  source: string;
  project: string;
  name: string;
  description: string;
  enabled: boolean;
  revision: number;
  current?: string;
  latest: string;
}
export interface SkillVersion {
  id: string;
  skillId: string;
  snapshot: string;
  packageRoot: string;
  skillFile: string;
  extensions: string[];
  knowledgeFiles: string[];
  digest: string;
  created: number;
  review?: { digest: string; notes: string; at: number };
  error?: string;
}
export interface SkillOperation {
  id: string;
  skillId: string;
  status: 'checking' | 'waiting' | 'applied' | 'failed' | 'interrupted';
  message: string;
  created: number;
}
export interface SkillLoadout {
  records: SkillRecord[];
  versions: SkillVersion[];
}
interface KnowledgeRevision {
  id: string;
  skillId: string;
  version: string;
  file: string;
  content: string;
  created: number;
}
export type ApplySkills = (
  next: SkillLoadout,
  previous: SkillLoadout,
  operation: SkillOperation,
  commit: () => void,
) => Promise<void>;

function json<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}
export function contained(root: string, path: string) {
  const r = relative(root, path);
  return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r));
}
function child(root: string, path: string) {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0'))
    throw new SkillError('文件必须使用包内相对路径', 400);
  const p = resolve(root, path);
  if (!contained(root, p)) throw new SkillError('文件路径超出 Skill 目录', 400);
  return p;
}
async function files(root: string, dir = root): Promise<string[]> {
  const result: string[] = [];
  for (const name of (await readdir(dir)).sort()) {
    if (name === '.git') continue;
    const p = join(dir, name),
      info = await lstat(p);
    if (info.isSymbolicLink()) {
      if (!contained(root, await realpath(p))) throw new SkillError('版本目录包含指向外部的符号链接');
      result.push(relative(root, p));
    } else if (info.isDirectory()) result.push(...(await files(root, p)));
    else if (info.isFile()) result.push(relative(root, p));
    else throw new SkillError('Skill 包含不支持的文件类型');
  }
  return result;
}
async function digest(root: string, meta: { packageRoot: string; extensions: string[]; [key: string]: unknown }) {
  const runtime = meta.extensions.length ? await hostIdentity() : '';
  const hash = createHash('sha256').update(JSON.stringify(meta)).update(runtime);
  for (const path of await files(root)) {
    const p = join(root, path),
      info = await lstat(p);
    const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(p)) : await readFile(p);
    hash.update(JSON.stringify([path, bytes.length, info.mode & 0o111])).update(bytes);
  }
  return hash.digest('hex');
}
async function copyTree(source: string, target: string) {
  await files(source); // Validate before copying; no external symlink traversal.
  await cp(source, target, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: (p) => !p.split(sep).includes('.git'),
  });
  await files(target);
}

export class SkillService {
  private apply?: ApplySkills;
  private tail = Promise.resolve();
  private pending = new Set<Promise<unknown>>();
  private closed = false;
  constructor(
    public dataDir: string,
    private db: DatabaseSync,
    private changed: (event: unknown) => void,
  ) {}
  async init() {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    this.dataDir = await realpath(this.dataDir);
    this.db.exec(`CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skill_versions(id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skill_operations(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skill_knowledge(id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, data TEXT NOT NULL);`);
    for (const op of this.operations())
      if (op.status === 'checking' || op.status === 'waiting')
        this.saveOperation({
          ...op,
          status: 'interrupted',
          message: 'Host 已中断更新，继续使用已提交的正式版本；未自动重放等待请求',
        });
    await mkdir(join(this.dataDir, 'skills', 'versions'), { recursive: true, mode: 0o700 });
    await mkdir(join(this.dataDir, 'skills', 'drafts'), { recursive: true, mode: 0o700 });
  }
  connect(apply: ApplySkills) {
    this.apply = apply;
  }
  private transaction(fn: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  private save(record: SkillRecord) {
    this.db.prepare('INSERT OR REPLACE INTO skills VALUES (?,?)').run(record.id, JSON.stringify(record));
  }
  private saveVersion(version: SkillVersion) {
    this.db
      .prepare('INSERT OR REPLACE INTO skill_versions VALUES (?,?,?)')
      .run(version.id, version.skillId, JSON.stringify(version));
  }
  private saveOperation(operation: SkillOperation, notify = true) {
    this.db
      .prepare('INSERT OR REPLACE INTO skill_operations VALUES (?,?)')
      .run(operation.id, JSON.stringify(operation));
    if (notify) this.changed({ type: 'skills', operation });
  }
  records() {
    return this.db
      .prepare('SELECT data FROM skills')
      .all()
      .map((r) => json<SkillRecord>(r.data));
  }
  record(id: string) {
    const r = this.records().find((r) => r.id === id);
    if (!r) throw new SkillError('Skill 不存在', 404);
    return r;
  }
  version(id: string) {
    const r = this.db.prepare('SELECT data FROM skill_versions WHERE id=?').get(id);
    if (!r) throw new SkillError('版本不存在', 404);
    return json<SkillVersion>(r.data);
  }
  versions(id: string) {
    this.record(id);
    return this.db
      .prepare('SELECT data FROM skill_versions WHERE skill_id=?')
      .all(id)
      .map((r) => json<SkillVersion>(r.data))
      .sort((a, b) => b.created - a.created);
  }
  operations() {
    return this.db
      .prepare('SELECT data FROM skill_operations')
      .all()
      .map((r) => json<SkillOperation>(r.data))
      .sort((a, b) => b.created - a.created);
  }
  operation(id: string) {
    const op = this.operations().find((o) => o.id === id);
    if (!op) throw new SkillError('操作不存在', 404);
    return op;
  }
  loadout(): SkillLoadout {
    const records = this.records();
    return { records, versions: records.filter((r) => r.current).map((r) => this.version(r.current!)) };
  }
  root(v: SkillVersion) {
    return join(this.dataDir, 'skills', 'versions', v.snapshot);
  }
  packagePath(v: SkillVersion) {
    return child(this.root(v), v.packageRoot || '.');
  }
  private async verifyDependencies(v: SkillVersion) {
    if (v.extensions.length)
      try {
        await dependencyIdentity(this.root(v), this.packagePath(v));
      } catch {
        throw new SkillError('依赖缺失、未锁定或越出快照；请准备完整依赖及 package-lock.json 后重新导入');
      }
  }
  async verify(v: SkillVersion) {
    await this.verifyDependencies(v);
    const current = await digest(this.root(v), {
      packageRoot: v.packageRoot,
      skillFile: v.skillFile,
      extensions: v.extensions,
      knowledgeFiles: v.knowledgeFiles,
    });
    if (current !== v.digest) throw new SkillError('版本内容或依赖已改变，需要重新审查');
    if (v.extensions.length && v.review?.digest !== v.digest)
      throw new SkillError('可执行版本尚未完成人工代码、依赖及权限审查');
  }
  private assertRevision(r: SkillRecord, revision: number) {
    if (r.revision !== revision) throw new SkillError('Skill 已被其他窗口修改，请重新加载后再编辑');
  }
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new SkillError('Host 正在退出'));
    const task = this.tail.then(fn);
    this.tail = task.then(
      () => {},
      () => {},
    );
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task)).catch(() => {});
    return task;
  }
  async discover(project?: string) {
    const cwd = project ? await realpath(resolve(project)) : process.cwd();
    // Native text parsing only. Never instantiate an Extension to discover a Skill.
    const native = await discoverSkillText(cwd);
    const seen = new Set<string>();
    const discovered = [];
    for (const s of native.skills) {
      const source = await realpath(s.filePath);
      if (seen.has(source)) continue;
      seen.add(source);
      const managed = this.records().find(
        (r) =>
          (r.project === '' || r.project === cwd) &&
          resolve(r.source, this.version(r.latest).skillFile) === resolve(s.filePath),
      );
      if (!managed) discovered.push({ ...s, source });
    }
    return {
      skills: this.records().filter((r) => !r.project || r.project === cwd),
      discovered,
      diagnostics: native.diagnostics,
      operations: this.operations(),
    };
  }
  async detail(id: string) {
    const skill = this.record(id),
      versions = this.versions(id),
      v = this.version(skill.latest);
    return {
      skill,
      versions,
      files: await files(this.packagePath(v)),
      operations: this.operations().filter((o) => o.skillId === id),
      draftDir: join(this.dataDir, 'skills', 'drafts', id),
      snapshotFiles: await files(this.root(v)),
      knowledge: this.knowledge(id),
    };
  }
  private knowledge(id: string) {
    return this.db
      .prepare('SELECT data FROM skill_knowledge WHERE skill_id=?')
      .all(id)
      .map((r) => json<KnowledgeRevision>(r.data))
      .sort((a, b) => a.created - b.created);
  }
  async read(id: string, version: string, path: string, snapshot = false) {
    const record = this.record(id);
    const v = this.version(version);
    if (v.skillId !== id) throw new SkillError('版本不属于当前 Skill');
    const root = snapshot ? this.root(v) : this.packagePath(v),
      p = child(root, path);
    if (!contained(root, await realpath(p))) throw new SkillError('文件路径超出版本目录');
    const bytes = await readFile(p);
    if (bytes.length > 1024 * 1024 || bytes.includes(0)) throw new SkillError('此文件不支持文本编辑');
    const overlay =
      !snapshot && v.knowledgeFiles.includes(path)
        ? this.knowledge(id)
            .filter((k) => k.file === path)
            .at(-1)
        : undefined;
    return {
      path,
      baseRevision: record.revision,
      version,
      latest: record.latest,
      content: overlay?.content ?? bytes.toString('utf8'),
    };
  }
  startImport(input: ImportSkill) {
    const op: SkillOperation = {
      id: randomUUID(),
      skillId: 'catalog',
      status: 'checking',
      message: '正在获取并准备候选 Package',
      created: Date.now(),
    };
    this.saveOperation(op);
    void this.import(input).then(
      () => {
        op.status = 'applied';
        op.message = '候选已保存，尚未授予执行信任';
        this.saveOperation(op);
      },
      (e) => {
        op.status = 'failed';
        op.message = e instanceof SkillError ? e.message : 'Package 准备失败，正式版本未改变';
        this.saveOperation(op);
      },
    );
    return op;
  }
  async import(input: ImportSkill) {
    return this.serialize(async () => {
      const snapshot = randomUUID(),
        destination = join(this.dataDir, 'skills', 'versions', snapshot);
      let packageRoot = '.',
        source = input.source;
      try {
        if (
          source.startsWith('npm:') ||
          source.startsWith('git:') ||
          source.startsWith('https:') ||
          source.startsWith('git@')
        ) {
          const acquired = await this.acquire(source, destination);
          packageRoot = acquired;
        } else {
          source = await realpath(resolve(source));
          if ((await lstat(source)).isFile()) source = dirname(source);
          if (contained(source, destination)) throw new SkillError('不能将包含产品数据的目录导入自身');
          await copyTree(source, destination);
        }
        const root = child(destination, packageRoot),
          settings = SettingsManager.inMemory(
            { packages: [{ source: root, prompts: [], themes: [] }] },
            { projectTrusted: false },
          );
        const paths = await new DefaultPackageManager({
          cwd: root,
          agentDir: join(destination, '.resolver'),
          settingsManager: settings,
        }).resolve(async () => 'error');
        const skills: Skill[] = [];
        for (const r of paths.skills.filter(
          (r) => r.enabled && r.metadata.origin === 'package' && contained(root, r.path),
        ))
          skills.push(
            ...loadSkills({ cwd: root, agentDir: root, skillPaths: [r.path], includeDefaults: false }).skills,
          );
        if (!skills.length) skills.push(...loadSkillsFromDir({ dir: root, source: 'path' }).skills);
        if (!skills.length) throw new SkillError('未发现有效 SKILL.md');
        const extensionPaths = paths.extensions
          .filter((r) => r.enabled && r.metadata.origin === 'package' && contained(root, r.path))
          .map((r) => relative(root, r.path));
        const bindings = input.bindings ?? [];
        if (extensionPaths.length && !bindings.length)
          throw new SkillError('特殊 Package 需要明确绑定每个 Skill 与其 Extension 路径');
        const owned = new Set<string>(),
          boundSkills = new Set<string>();
        for (const b of bindings) {
          if (boundSkills.has(b.skill)) throw new SkillError('Skill 绑定重复，不能共享或静默覆盖归属');
          boundSkills.add(b.skill);
          if (!skills.some((s) => relative(root, s.filePath) === b.skill))
            throw new SkillError('绑定的 Skill 路径不属于该 Package');
          for (const p of b.extensions) {
            child(root, p);
            if (!extensionPaths.includes(p) || owned.has(p))
              throw new SkillError('Extension 绑定无效或被多个 Skill 共享，请拆分独立 Extension');
            owned.add(p);
          }
          for (const p of b.knowledgeFiles ?? [])
            if (!p.endsWith('.md') || p === b.skill) {
              throw new SkillError('知识文件必须为独立 Markdown 文件');
            } else child(root, p);
        }
        if (owned.size !== extensionPaths.length) throw new SkillError('Package 存在尚未明确归属的 Extension');
        const project = input.project ? await realpath(resolve(input.project)) : '';
        const added: SkillRecord[] = [],
          versions: SkillVersion[] = [];
        for (const s of skills) {
          if (!contained(root, await realpath(s.filePath))) throw new SkillError('Skill 路径超出 Package');
          const skillFile = relative(root, s.filePath),
            binding = bindings.find((b) => b.skill === skillFile);
          const previous = this.records().find(
            (r) => r.source === source && r.project === project && this.version(r.latest).skillFile === skillFile,
          );
          const id = previous?.id ?? randomUUID(),
            v: SkillVersion = {
              id: randomUUID(),
              skillId: id,
              snapshot,
              packageRoot,
              skillFile,
              extensions: binding?.extensions ?? [],
              knowledgeFiles: binding?.knowledgeFiles ?? [],
              digest: '',
              created: Date.now(),
            };
          v.digest = await digest(destination, {
            packageRoot,
            skillFile,
            extensions: v.extensions,
            knowledgeFiles: v.knowledgeFiles,
          });
          const record: SkillRecord = {
            id,
            source,
            project,
            name: s.name,
            description: s.description,
            enabled: previous?.enabled ?? true,
            revision: (previous?.revision ?? 0) + 1,
            current: previous?.current,
            latest: v.id,
          };
          added.push(record);
          versions.push(v);
        }
        this.transaction(() => {
          for (const v of versions) this.saveVersion(v);
          for (const r of added) this.save(r);
        });
        this.changed({ type: 'skills' });
        return added;
      } catch (e) {
        if (!this.records().some((r) => this.version(r.latest).snapshot === snapshot))
          await rm(destination, { recursive: true, force: true });
        throw e;
      }
    });
  }
  private async acquire(source: string, destination: string): Promise<string> {
    let script = fileURLToPath(new URL('./skill-acquire.js', import.meta.url));
    const args: string[] = [];
    if (!existsSync(script)) {
      script = script.replace(/\.js$/, '.ts');
      args.push('--import', 'tsx');
    }
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: homedir(),
      TMPDIR: process.env.TMPDIR,
      ELECTRON_RUN_AS_NODE: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_KEY_1: 'protocol.ext.allow',
      GIT_CONFIG_VALUE_1: 'never',
      GIT_ALLOW_PROTOCOL: 'https:http:ssh:git',
      GIT_SSH_COMMAND: process.platform === 'win32' ? 'ssh -F NUL' : '/usr/bin/ssh -F /dev/null',
    };
    return new Promise((ok, fail) => {
      const worker = fork(script, [source, destination], {
        execArgv: args,
        env,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      let result: string | undefined;
      const timer = setTimeout(() => {
        worker.kill();
        fail(new SkillError('获取 Package 超时，旧版保持不变'));
      }, 180000);
      worker.on('message', (message: unknown) => {
        if (message && typeof message === 'object' && 'root' in message && typeof message.root === 'string')
          result = message.root;
      });
      worker.once('error', () => {
        clearTimeout(timer);
        fail(new SkillError('Package 获取进程无法启动'));
      });
      worker.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0 && result) ok(result);
        else fail(new SkillError('Package 获取失败，请检查来源及本机 npm/git；安装脚本不会自动执行'));
      });
    });
  }
  async edit(id: string, baseRevision: number, edits: Array<{ path: string; content: string | null }>) {
    return this.serialize(async () => {
      const record = this.record(id);
      this.assertRevision(record, baseRevision);
      const old = this.version(record.latest),
        v = {
          ...old,
          id: randomUUID(),
          snapshot: randomUUID(),
          created: Date.now(),
          review: undefined,
          error: undefined,
        };
      const target = this.root(v);
      try {
        await copyTree(this.root(old), target);
        for (const edit of edits) {
          const p = child(this.packagePath(v), edit.path);
          await mkdir(dirname(p), { recursive: true });
          if (existsSync(p) && !(await lstat(p)).isFile()) throw new SkillError('不能编辑目录或链接');
          if (edit.content === null) await rm(p, { force: true });
          else await writeFile(p, edit.content, { mode: 0o600 });
        }
        const result = loadSkills({
          cwd: this.packagePath(v),
          agentDir: this.packagePath(v),
          skillPaths: [child(this.packagePath(v), v.skillFile)],
          includeDefaults: false,
        });
        const parsed = result.skills[0];
        if (!parsed || result.diagnostics.some((d) => d.type === 'error'))
          throw new SkillError('SKILL.md 解析失败，请检查名称和描述');
        v.digest = await digest(target, {
          packageRoot: v.packageRoot,
          skillFile: v.skillFile,
          extensions: v.extensions,
          knowledgeFiles: v.knowledgeFiles,
        });
        this.transaction(() => {
          this.saveVersion(v);
          this.save({
            ...record,
            name: parsed.name,
            description: parsed.description,
            latest: v.id,
            revision: record.revision + 1,
          });
        });
        this.changed({ type: 'skills' });
        return this.detail(id);
      } catch (e) {
        await rm(target, { recursive: true, force: true });
        throw e;
      }
    });
  }
  async prepareDraft(id: string) {
    return this.serialize(async () => {
      const r = this.record(id),
        v = this.version(r.latest),
        dir = join(this.dataDir, 'skills', 'drafts', id);
      if (existsSync(dir)) throw new SkillError('已有编辑目录，请先导入修改或保留其中内容');
      await copyTree(this.packagePath(v), dir);
      await writeFile(join(dir, '.agent-base.json'), JSON.stringify({ revision: r.revision, version: v.id }));
      return { directory: dir, revision: r.revision };
    });
  }
  async importDraft(id: string, baseRevision: number) {
    const dir = join(this.dataDir, 'skills', 'drafts', id),
      base = json<{ revision: number; version: string }>(await readFile(join(dir, '.agent-base.json'), 'utf8'));
    if (base.revision !== baseRevision) throw new SkillError('候选目录的基础修订已改变');
    const all = await files(dir),
      edits: Array<{ path: string; content: string | null }> = [];
    const v = this.version(base.version);
    for (const p of all) {
      if (p === '.agent-base.json') continue;
      const content = await readFile(join(dir, p));
      let old: Buffer | undefined;
      try {
        old = await readFile(child(this.packagePath(v), p));
      } catch {}
      if (!old?.equals(content)) {
        if (content.includes(0)) throw new SkillError('候选包含二进制变更，请重新导入 Package');
        edits.push({ path: p, content: content.toString('utf8') });
      }
    }
    for (const p of await files(this.packagePath(v))) if (!all.includes(p)) edits.push({ path: p, content: null });
    const result = await this.edit(id, baseRevision, edits);
    await rm(dir, { recursive: true, force: true });
    return result;
  }
  async discardDraft(id: string) {
    return this.serialize(async () => {
      this.record(id);
      await rm(join(this.dataDir, 'skills', 'drafts', id), { recursive: true, force: true });
    });
  }
  async review(id: string, versionId: string, digestValue: string, notes: string) {
    return this.serialize(async () => {
      const v = this.version(versionId);
      if (v.skillId !== id || v.digest !== digestValue) throw new SkillError('审查对象与版本摘要不匹配');
      if (notes.trim().length < 10) throw new SkillError('请记录实际代码、依赖及权限审查结论');
      const actual = await digest(this.root(v), {
        packageRoot: v.packageRoot,
        skillFile: v.skillFile,
        extensions: v.extensions,
        knowledgeFiles: v.knowledgeFiles,
      });
      if (actual !== v.digest) throw new SkillError('内容已改变，不能沿用此次审查');
      await this.verifyDependencies(v);
      v.review = { digest: v.digest, notes, at: Date.now() };
      this.saveVersion(v);
      this.changed({ type: 'skills' });
      return v;
    });
  }
  waiting(op: SkillOperation) {
    op.status = 'waiting';
    op.message = '等待当前任务完成后切换';
    this.saveOperation(op);
  }
  publish(id: string, versionId: string, baseRevision: number, enabled?: boolean) {
    const record = this.record(id);
    this.assertRevision(record, baseRevision);
    const v = this.version(versionId);
    if (v.skillId !== id) throw new SkillError('版本不属于当前 Skill');
    const op: SkillOperation = {
      id: randomUUID(),
      skillId: id,
      status: 'checking',
      message: '正在检查候选版本',
      created: Date.now(),
    };
    this.saveOperation(op);
    void this.serialize(async () => {
      try {
        const r = this.record(id);
        this.assertRevision(r, baseRevision);
        if (enabled !== false) await this.verify(v);
        const parsed =
          enabled === false
            ? r
            : loadSkills({
                cwd: this.packagePath(v),
                agentDir: this.packagePath(v),
                skillPaths: [child(this.packagePath(v), v.skillFile)],
                includeDefaults: false,
              }).skills[0];
        if (!parsed) throw new SkillError('正式说明无效');
        const previous = this.loadout(),
          nextRecord = {
            ...r,
            name: parsed.name,
            description: parsed.description,
            current: v.id,
            enabled: enabled ?? r.enabled,
            revision: r.revision + 1,
          };
        const next = {
          records: previous.records.map((x) => (x.id === id ? nextRecord : x)),
          versions: [...previous.versions.filter((x) => x.skillId !== id), v],
        };
        if (!this.apply) throw new SkillError('Skill 运行服务尚未就绪');
        await this.apply(next, previous, op, () =>
          this.transaction(() => {
            this.save(nextRecord);
            op.status = 'applied';
            op.message = '已生效';
            this.saveOperation(op, false);
          }),
        );
        this.changed({ type: 'skills', operation: op });
      } catch (e) {
        op.status = 'failed';
        op.message = e instanceof SkillError ? e.message : '检查或切换失败，已尝试保留上一可用版本';
        this.saveOperation(op);
      }
    }).catch(() => {});
    return op;
  }
  async setKnowledge(id: string, baseRevision: number, path: string, content: string) {
    return this.serialize(async () => {
      const r = this.record(id);
      this.assertRevision(r, baseRevision);
      if (!r.current) throw new SkillError('请先启用正式版本');
      const v = this.version(r.current);
      if (!v.knowledgeFiles.includes(path)) throw new SkillError('该文件不是明确声明的独立知识文件');
      await this.verify(v);
      const entry: KnowledgeRevision = {
        id: randomUUID(),
        skillId: id,
        version: v.id,
        file: path,
        content,
        created: Date.now(),
      };
      this.transaction(() => {
        this.db.prepare('INSERT INTO skill_knowledge VALUES (?,?,?)').run(entry.id, id, JSON.stringify(entry));
        this.save({ ...r, revision: r.revision + 1 });
      });
      this.changed({ type: 'skills' });
      return entry;
    });
  }
  async resourcePaths(cwd: string, loadout = this.loadout()) {
    cwd = await realpath(cwd);
    const skillPaths: string[] = [],
      extensionPaths: string[] = [];
    for (const r of loadout.records.filter((r) => r.enabled && r.current && (!r.project || r.project === cwd))) {
      const v = loadout.versions.find((v) => v.id === r.current);
      if (!v) throw new SkillError('正式版本引用缺失');
      await this.verify(v);
      let root = this.packagePath(v);
      const knowledge = this.knowledge(r.id).filter((k) => v.knowledgeFiles.includes(k.file));
      if (knowledge.length) {
        const view = join(this.dataDir, 'skills', 'views', `${v.id}-${knowledge.at(-1)!.id}`);
        if (!existsSync(view)) {
          const temp = `${view}.${randomUUID()}.tmp`;
          await mkdir(dirname(view), { recursive: true });
          await copyTree(root, temp);
          for (const k of knowledge) await writeFile(child(temp, k.file), k.content);
          await rename(temp, view).catch(async (e) => {
            await rm(temp, { recursive: true, force: true });
            if (!existsSync(view)) throw e;
          });
        }
        root = view;
      }
      skillPaths.push(child(root, v.skillFile));
      for (const p of v.extensions) extensionPaths.push(child(this.packagePath(v), p));
    }
    return { skillPaths, extensionPaths };
  }
  filterNative(skills: Skill[], cwd: string, loadout = this.loadout()) {
    const relevant = loadout.records.filter((r) => !r.project || r.project === cwd);
    return skills.filter(
      (s) => !relevant.some((r) => resolve(r.source, this.version(r.latest).skillFile) === resolve(s.filePath)),
    );
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.pending]);
  }
}
