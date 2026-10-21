import { randomUUID } from 'node:crypto';
import { mkdir, cp, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { SensitiveData } from '../storage/storage.js';
import { SkillError, type SkillService } from '../skills/skills.js';

const name = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const activityGrant = z
  .object({
    baseRevision: z.number().int().positive(),
    goal: z.string().trim().min(1).max(8000),
    existingSkills: z.array(z.string().uuid()).max(20),
    newSkills: z.array(name).max(20),
  })
  .strict()
  .refine((x) => x.existingSkills.length + x.newSkills.length > 0, '请选择允许修改或新建的能力');
export const toolProbe = z
  .object({
    tool: z.string().min(1).max(128),
    args: z.record(z.string(), z.json()),
    expectedText: z.string().min(1).max(8000),
  })
  .strict();
export const activityResult = z
  .object({
    summary: z.string().trim().min(1).max(12000),
    packages: z
      .array(
        z
          .object({
            target: z.string().min(1),
            skillFile: z.string().min(1),
            extensions: z.array(z.string()).max(30),
            knowledgeFiles: z.array(z.string()).max(30).default([]),
            probes: z.array(toolProbe).max(50),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type ActivityResult = z.infer<typeof activityResult>;
export interface ActivityTarget {
  key: string;
  name: string;
  skillId?: string;
  baseRevision?: number;
  directory: string;
}
export interface EvolutionActivity {
  id: string;
  sessionId: string;
  project: string;
  suggestionId?: string;
  goal: string;
  status: 'discussion' | 'preparing' | 'running' | 'checking' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  revision: number;
  created: number;
  updated: number;
  grant?: { id: string; goal: string; at: number; actor: 'user'; targets: ActivityTarget[] };
  result?: ActivityResult;
  releases: Array<{ skillId: string; version: string; operationId: string }>;
  error?: string;
}
export class ActivityService {
  constructor(
    private db: DatabaseSync,
    private sensitive: SensitiveData,
    private skills: SkillService,
    private changed: () => void,
  ) {}
  init() {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS evolution_activities(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)))',
    );
    for (const a of this.list())
      if (['preparing', 'running', 'checking'].includes(a.status)) {
        this.save({ ...a, status: 'interrupted', error: 'Host 中断；保留候选和已提交版本，不自动重放开发或发布' });
      }
  }
  list(): EvolutionActivity[] {
    return this.db
      .prepare("SELECT data FROM evolution_activities ORDER BY json_extract(data,'$.created') DESC")
      .all()
      .map((row) => this.sensitive.copy(JSON.parse(String(row.data)) as EvolutionActivity));
  }
  get(id: string) {
    const a = this.list().find((a) => a.id === id);
    if (!a) throw new SkillError('开发活动不存在', 404);
    return a;
  }
  forSession(id: string) {
    return this.list().find((a) => a.sessionId === id);
  }
  private save(a: EvolutionActivity) {
    const safe = this.sensitive.copy(a);
    this.db.prepare('INSERT OR REPLACE INTO evolution_activities VALUES (?,?)').run(a.id, JSON.stringify(safe));
    this.changed();
    return safe;
  }
  create(sessionId: string, project: string, goal: string, suggestionId?: string) {
    const old = this.forSession(sessionId);
    if (old) return old;
    return this.save({
      id: randomUUID(),
      sessionId,
      project,
      goal,
      suggestionId,
      status: 'discussion',
      revision: 1,
      created: Date.now(),
      updated: Date.now(),
      releases: [],
    });
  }
  update(id: string, patch: Partial<Pick<EvolutionActivity, 'status' | 'result' | 'error' | 'releases'>>) {
    const a = this.get(id);
    return this.save({ ...a, ...patch, updated: Date.now(), revision: a.revision + 1 });
  }
  assertRunning(id: string) {
    const a = this.get(id);
    if (a.status !== 'running' || !a.grant) throw new SkillError('活动未获授权、已结束或已取消', 403);
    return { ...a, grant: a.grant };
  }
  assertAdmission(activityId: string, skillId: string, versionId?: string) {
    const a = this.get(activityId),
      r = this.skills.record(skillId);
    const target = a.grant?.targets.find(
      (t) => t.skillId === skillId || (!t.skillId && t.name === r.name && t.directory === r.source),
    );
    if (!target || a.grant?.actor !== 'user') throw new SkillError('版本超出用户授权范围', 403);
    if (versionId) {
      const release = a.releases.find((r) => r.skillId === skillId && r.version === versionId);
      const operation = release ? this.skills.operation(release.operationId) : undefined;
      if (
        !operation ||
        operation.status !== 'applied' ||
        operation.evolution?.activityId !== activityId ||
        operation.checks?.some((c) => !c.passed)
      )
        throw new SkillError('版本缺少对应授权活动的发布成功记录', 403);
    }
    return a;
  }
  async authorize(id: string, input: z.infer<typeof activityGrant>) {
    const x = activityGrant.parse(input),
      a = this.get(id);
    if (a.status !== 'discussion' || a.revision !== x.baseRevision) throw new SkillError('活动已变化，请刷新后授权');
    if (new Set(x.existingSkills).size !== x.existingSkills.length || new Set(x.newSkills).size !== x.newSkills.length)
      throw new SkillError('授权目标不能重复');
    const workspace = join(this.skills.dataDir, 'evolution', a.id);
    const targets: ActivityTarget[] = x.existingSkills.map((id) => {
      const r = this.skills.record(id);
      if (r.project && r.project !== a.project) throw new SkillError('Skill 不属于当前项目', 403);
      return { key: id, name: r.name, skillId: id, baseRevision: r.revision, directory: join(workspace, id) };
    });
    for (const n of x.newSkills) {
      if (
        targets.some((t) => t.name === n) ||
        this.skills.records().some((r) => r.name === n && (!r.project || r.project === a.project))
      )
        throw new SkillError('新能力名称已存在，请选择已有能力或使用其他名称');
      targets.push({ key: n, name: n, directory: join(workspace, n) });
    }
    // Reservation happens before any await: concurrent clients cannot grant twice.
    this.save({
      ...a,
      status: 'preparing',
      revision: a.revision + 1,
      updated: Date.now(),
      grant: { id: randomUUID(), goal: x.goal, at: Date.now(), actor: 'user', targets },
    });
    try {
      for (const t of targets) {
        await mkdir(t.directory, { recursive: true, mode: 0o700 });
        if (t.skillId) {
          const r = this.skills.record(t.skillId);
          if (r.revision !== t.baseRevision) throw new SkillError('授权后能力已变化');
          const v = this.skills.version(r.current ?? r.latest);
          // Unpublished bytes may be copied for repair; copying does not load or trust them.
          if (r.current) await this.skills.verify(v);
          await cp(this.skills.packagePath(v), t.directory, { recursive: true, dereference: false });
        }
        if ((await realpath(t.directory)) !== resolve(t.directory)) throw new SkillError('候选目录不能经过符号链接');
      }
      if (this.get(id).status !== 'preparing') throw new SkillError('活动已取消');
      return this.update(id, { status: 'running', error: undefined });
    } catch (e) {
      if (this.get(id).status !== 'cancelled')
        this.update(id, { status: 'failed', error: e instanceof SkillError ? e.message : '候选目录准备失败' });
      throw e;
    }
  }
}
