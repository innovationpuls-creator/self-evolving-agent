import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { Type, type Static, type TSchema } from 'typebox';
import { z } from 'zod';
import type { ModelRuntime, ToolDefinition, SessionManager } from '@earendil-works/pi-coding-agent';
import {
  validateToolArguments,
  type AssistantMessage,
  type ToolCall,
  type Tool,
  type Model,
  type Api,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { EncryptedStore, restore, type Snapshot, type SensitiveData } from '../storage/storage.js';
import { MemoryService, type MemoryContext, type MemorySource } from '../memory/memory.js';
import { memoryTools } from '../memory/memory-tools.js';
import { diagnosticTools } from '../diagnostics/diagnostic-tools.js';
import type {
  DiagnosticService,
  DiagnosticTrace,
  DiagnosticTurn,
  DiagnosticCall,
  DiagnosticEvent,
} from '../diagnostics/diagnostics.js';
import type { DiagnosticHistory } from '../diagnostics/diagnostic-history.js';
import {
  evolutionEvidence,
  evolutionInput,
  type EvolutionEvidence,
  type EvolutionContext,
  type EvolutionService,
} from '../evolution/evolution.js';
import { evolutionTools } from '../evolution/evolution-tools.js';
import type { SkillService } from '../skills/skills.js';
import { ReflectionJobs, type ReflectionJob, type ReflectionRegistration } from './reflection-jobs.js';
import { NativeReflectionExecutor } from './native-executor.js';
import { reflectionOutputGuidance } from './reflection-prompt.js';

export const reflectionMarker = 'reflection_settled_v1';
export interface SessionRecord {
  id: string;
  cwd: string;
  provider: string;
  model: string;
  title: string;
  updated: number;
  purpose?: 'chat' | 'reflection' | 'discussion';
  project?: string;
  interrupted?: boolean;
}
export interface SavedSession {
  record: SessionRecord;
  session: Snapshot;
}
export interface ReflectionRecord {
  id: string;
  jobId: string;
  sessionId: string;
  reflectionSessionId: string;
  project: string;
  status: ReflectionJob['status'];
  created: number;
  updated: number;
  summary: string;
  findings: string[];
  uncertainties: string[];
  evidence: EvolutionEvidence[];
  changes: Array<{
    kind: 'memory' | 'skill_knowledge' | 'suggestion';
    id: string;
    revision?: number;
    knowledgeRevision?: string;
    file?: string;
    version?: string;
    summary?: string;
  }>;
  error?: string;
}
export interface ReflectionExecutor {
  available(signal?: AbortSignal): Promise<{ available: boolean; reason?: string }>;
  execute(
    start: unknown,
    handle: (operation: string, input: unknown) => Promise<unknown>,
    signal: AbortSignal,
  ): Promise<void>;
}
interface Dependencies {
  db: DatabaseSync;
  store: EncryptedStore;
  sensitive: SensitiveData;
  runtime: ModelRuntime;
  memory: MemoryService;
  diagnostics: DiagnosticService;
  history: DiagnosticHistory;
  skills: SkillService;
  evolution: EvolutionService;
  read: (id: string) => Promise<{ saved: SavedSession; previous: boolean } | undefined>;
  records: () => Promise<SessionRecord[]>;
  canRun: () => boolean;
  changed: () => void;
  refreshKnowledge: () => Promise<void>;
  executor?: ReflectionExecutor;
  appBundle?: string;
  delayMs?: number;
  modelTimeoutMs?: number;
}
const evidenceInput = Type.Array(
  Type.Unsafe<EvolutionEvidence>(JSON.parse(JSON.stringify(z.toJSONSchema(evolutionEvidence)))),
  { maxItems: 100 },
);
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
const recordInput = z
  .object({
    summary: z.string().trim().min(1).max(32000),
    findings: z.array(z.string().max(8000)).max(100),
    uncertainties: z.array(z.string().max(8000)).max(100),
    evidence: z.array(evolutionEvidence).max(100),
  })
  .strict();
export class ReflectionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = 'REFLECTION_FAILED',
  ) {
    super(message);
  }
}
/** Product coordination only; Pi remains the sole agent loop and tool executor. */
export class ReflectionService {
  readonly jobs: ReflectionJobs;
  private executor: ReflectionExecutor;
  private timer?: ReturnType<typeof setTimeout>;
  private closing = false;
  private pumping = false;
  private pumpDone?: Promise<void>;
  private run?: Promise<void>;
  private abort?: AbortController;
  private environment?: { available: boolean; reason?: string; checkedAt: number };
  private environmentCheck?: {
    controller: AbortController;
    promise: Promise<{ available: boolean; reason?: string }>;
    waiters: number;
  };
  constructor(private d: Dependencies) {
    this.jobs = new ReflectionJobs(d.db, d.changed, { delayMs: d.delayMs });
    this.executor = d.executor ?? new NativeReflectionExecutor(d.appBundle);
  }
  init() {
    this.jobs.init();
    this.d.db.exec('BEGIN IMMEDIATE');
    try {
      const v = this.d.db.prepare('SELECT version FROM product_migrations WHERE name=?').get('reflection_records');
      if (v && Number(v.version) !== 1) throw new Error('Unsupported Reflection records schema');
      if (!v)
        this.d.db.exec(`CREATE TABLE reflections(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,project TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE reflection_effects(run_id TEXT NOT NULL,call_id TEXT NOT NULL,result TEXT NOT NULL CHECK(json_valid(result)),PRIMARY KEY(run_id,call_id));
        CREATE INDEX reflection_record_session ON reflections(session_id); INSERT INTO product_migrations VALUES('reflection_records',1);`);
      this.d.db.exec('COMMIT');
    } catch (error) {
      this.d.db.exec('ROLLBACK');
      throw error;
    }
  }
  recover(record: SessionRecord, saved: Snapshot) {
    if (record.purpose === 'reflection') return;
    const manager = restore(saved);
    for (const entry of saved.entries) {
      if (entry.type !== 'custom' || entry.customType !== reflectionMarker) continue;
      const marker = z
        .object({
          version: z.literal(1),
          settledAt: z.number().finite(),
          status: z.enum(['ended', 'stopped', 'failed']),
          traceId: z.string().uuid().optional(),
        })
        .strict()
        .parse(entry.data);
      const input: ReflectionRegistration = {
        sessionId: record.id,
        project: record.project ?? record.cwd,
        provider: record.provider,
        model: record.model,
        markerEntryId: entry.id,
        settledAt: marker.settledAt,
        status: marker.status,
        ...(marker.traceId ? { traceId: marker.traceId } : {}),
        ancestorIds: manager.getBranch(entry.id).map((e) => e.id),
      };
      this.jobs.register(input);
    }
  }
  async availability(force = false, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!force && this.environment && Date.now() - this.environment.checkedAt < 60_000) return this.environment;
    if (!this.environmentCheck) {
      const controller = new AbortController();
      const promise = this.executor.available(controller.signal).then((value) => {
        controller.signal.throwIfAborted();
        this.environment = { ...value, checkedAt: Date.now() };
        // Every completed check changes checkedAt and may change the result even when no Job moves.
        this.notify();
        return this.environment;
      });
      const check = { controller, promise, waiters: 0 };
      this.environmentCheck = check;
      void promise
        .finally(() => {
          if (this.environmentCheck === check) this.environmentCheck = undefined;
        })
        .catch(() => {});
    }
    const check = this.environmentCheck;
    check.waiters++;
    let cancel: (() => void) | undefined;
    try {
      if (!signal) return await check.promise;
      return await Promise.race([
        check.promise,
        new Promise<never>((_resolve, reject) => {
          cancel = () => reject(signal.reason);
          signal.addEventListener('abort', cancel, { once: true });
          if (signal.aborted) cancel();
        }),
      ]);
    } finally {
      if (cancel) signal?.removeEventListener('abort', cancel);
      check.waiters--;
      if (!check.waiters && this.environmentCheck === check) {
        this.environmentCheck = undefined;
        check.controller.abort();
      }
    }
  }
  async recheck(signal?: AbortSignal) {
    const available = await this.availability(true, signal);
    if (available.available) this.jobs.recheck();
    else this.jobs.setUnavailable(available.reason ?? '反思环境检查未通过');
    this.wake();
  }
  catalog(input: { sessionId?: string; limit?: number; offset?: number; statusOnly?: boolean } = {}) {
    const limit = input.statusOnly ? 1 : (input.limit ?? 20);
    const offset = input.statusOnly ? 0 : (input.offset ?? 0);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
      throw new ReflectionError('反思分页无效', 400);
    const where = input.sessionId ? 'WHERE j.session_id=?' : '';
    const params = input.sessionId ? [input.sessionId] : [];
    const counts = this.d.db
      .prepare(`SELECT status,COUNT(*) AS count FROM reflection_jobs j ${where} GROUP BY status`)
      .all(...params);
    const total = counts.reduce((sum, row) => sum + Number(row.count), 0);
    const order = input.statusOnly
      ? "CASE j.status WHEN 'running' THEN 0 WHEN 'waiting_user' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,j.updated DESC,j.id DESC"
      : 'j.created DESC,j.id DESC';
    const rows = this.d.db
      .prepare(`SELECT j.id,j.session_id,j.created,j.updated,j.scheduled_at,j.status,j.error,j.reflection_session_id,
      ${input.statusOnly ? 'NULL AS summary' : "substr(json_extract(r.data,'$.summary'),1,240) AS summary"},
      (SELECT COUNT(*) FROM reflection_job_sources s WHERE s.job_id=j.id) AS source_count
      FROM reflection_jobs j ${input.statusOnly ? '' : 'LEFT JOIN reflections r ON r.id=j.id'} ${where}
      ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    return this.d.sensitive.copy({
      jobs: rows.map((row) => ({
        id: String(row.id),
        sessionId: String(row.session_id),
        created: Number(row.created),
        updated: Number(row.updated),
        scheduledAt: Number(row.scheduled_at),
        status: row.status as ReflectionJob['status'],
        reflectionSessionId: row.reflection_session_id === null ? undefined : String(row.reflection_session_id),
        error: row.error === null ? undefined : String(row.error),
        sourceCount: Number(row.source_count),
      })),
      records: rows
        .filter((row) => row.summary !== null)
        .map((row) => ({ id: String(row.id), jobId: String(row.id), summary: String(row.summary) })),
      total,
      limit,
      offset,
      pending: counts.reduce((sum, row) => sum + (row.status === 'pending' ? Number(row.count) : 0), 0),
      availability: this.environment ?? {
        available: false,
        reason: '尚未完成反思环境检查；Host 空闲时会自动检查，也可手动检查。',
      },
    });
  }
  list(sessionId?: string) {
    return this.d.db
      .prepare(`SELECT data FROM reflections ${sessionId ? 'WHERE session_id=?' : ''} ORDER BY rowid DESC LIMIT 100`)
      .all(...(sessionId ? [sessionId] : []))
      .map((row) => this.current(JSON.parse(String(row.data)) as ReflectionRecord));
  }
  get(id: string) {
    const row = this.d.db.prepare('SELECT data FROM reflections WHERE id=?').get(id);
    if (!row) throw new ReflectionError('反思记录不存在', 404);
    return this.current(JSON.parse(String(row.data)) as ReflectionRecord);
  }
  private current(record: ReflectionRecord) {
    const job = this.jobs.get(record.jobId);
    return this.d.sensitive.copy({
      ...record,
      status: job?.status ?? record.status,
      error: job?.error ?? record.error,
    });
  }
  private save(record: ReflectionRecord) {
    const safe = this.d.sensitive.copy({ ...record, updated: Date.now() });
    this.d.db
      .prepare('INSERT INTO reflections VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(safe.id, safe.sessionId, safe.project, JSON.stringify(safe));
    this.notify();
  }
  private notify() {
    try {
      this.d.changed();
    } catch {
      this.d.diagnostics.gap();
    }
  }
  wake() {
    if (this.closing) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.pump();
    }, 1);
    this.timer.unref();
  }
  private schedule() {
    if (this.closing) return;
    clearTimeout(this.timer);
    const due = this.jobs.nextScheduledAt() ?? Date.now() + 30000;
    this.timer = setTimeout(
      () => {
        void this.pump();
      },
      Math.max(100, Math.min(30000, due - Date.now())),
    );
    this.timer.unref();
  }
  private async pump() {
    if (this.pumping || this.closing) return;
    this.pumping = true;
    let finishPump!: () => void;
    this.pumpDone = new Promise<void>((resolve) => {
      finishPump = resolve;
    });
    let claimed: ReflectionJob | undefined;
    try {
      if (!this.d.canRun()) return;
      if (!this.jobs.hasDue() && this.environment) return;
      const available = await this.availability();
      if (this.closing) return;
      if (!available.available) {
        this.jobs.setUnavailable(available.reason ?? '反思环境检查未通过');
        return;
      }
      const job = this.jobs.pendingClaim(() => this.d.canRun());
      if (!job) return;
      claimed = job;
      this.abort = new AbortController();
      this.run = this.execute(job, this.abort.signal);
      await this.run;
    } catch {
      if (claimed?.runId) {
        try {
          this.jobs.finish(
            claimed.id,
            claimed.runId,
            this.abort?.signal.aborted ? 'interrupted' : 'failed',
            'Reflection 初始化或保存失败；已提交成果不会重放',
          );
        } catch {
          this.d.diagnostics.system('REFLECTION_STATE_WRITE_FAILED', 'error');
        }
      }
      this.d.diagnostics.system('REFLECTION_SCHEDULER_FAILED', 'error');
    } finally {
      this.pumping = false;
      finishPump();
      try {
        this.schedule();
      } catch {
        this.d.diagnostics.system('REFLECTION_SCHEDULER_FAILED', 'error');
      }
    }
  }
  async close() {
    this.closing = true;
    clearTimeout(this.timer);
    this.abort?.abort();
    this.environmentCheck?.controller.abort();
    await this.pumpDone;
    await this.run?.catch(() => {
      this.d.diagnostics.system('REFLECTION_RUN_FAILED', 'error');
    });
  }
  async authorizeEvidence(
    project: string | undefined,
    evidence: EvolutionEvidence[],
    actor: 'agent' | 'user' = 'agent',
  ) {
    const sources: MemorySource[] = [];
    const basis: MemorySource[] = [];
    for (const ref of evidence) {
      if (ref.sessionId) {
        const loaded = await this.d.read(ref.sessionId);
        if (!loaded || (actor === 'agent' && loaded.saved.record.cwd !== project))
          throw new ReflectionError('证据不在允许范围', 404, 'REFLECTION_EVIDENCE');
        if (ref.entryId) {
          if (!loaded.saved.session.entries.some((e) => e.id === ref.entryId))
            throw new ReflectionError('证据 Entry 不存在', 404);
          const source = { sessionId: ref.sessionId, entryId: ref.entryId, project: loaded.saved.record.cwd };
          sources.push(source);
          if (
            loaded.saved.record.purpose !== 'reflection' &&
            restore(loaded.saved.session)
              .getBranch()
              .some((e) => e.id === ref.entryId)
          )
            basis.push(source);
        }
      }
      if (ref.traceId) this.d.history.get({ actor, project }, ref.traceId);
      if (ref.memoryId) this.d.memory.assertReference({ actor, project }, ref.memoryId, ref.revision);
      if (ref.skillId) {
        const skill = this.d.skills.record(ref.skillId);
        if (actor === 'agent' && skill.project && skill.project !== project)
          throw new ReflectionError('Skill 不在允许范围', 404);
        if (
          ref.knowledgeRevision &&
          !(await this.d.skills.detail(ref.skillId)).knowledge.some((k) => k.id === ref.knowledgeRevision)
        )
          throw new ReflectionError('Skill Knowledge 修订不存在', 404);
      }
      if (ref.reflectionId && this.get(ref.reflectionId).project !== project && actor === 'agent')
        throw new ReflectionError('反思不在允许范围', 404);
    }
    return { sources, basis };
  }
  private async execute(job: ReflectionJob, signal: AbortSignal) {
    if (!job.runId || !job.reflectionSessionId) return;
    const runId = job.runId,
      sessionId = job.reflectionSessionId,
      traceId = randomUUID();
    const record: ReflectionRecord = {
      id: job.id,
      jobId: job.id,
      sessionId: job.sessionId,
      reflectionSessionId: sessionId,
      project: job.project,
      status: 'running',
      created: Date.now(),
      updated: Date.now(),
      summary: '',
      findings: [],
      uncertainties: [],
      evidence: job.sources.map((s) => ({
        sessionId: job.sessionId,
        entryId: s.markerEntryId,
        ...(s.traceId ? { traceId: s.traceId } : {}),
      })),
      changes: [],
    };
    this.save(record);
    let manager: SessionManager | undefined;
    let committed: Snapshot | undefined;
    let completed = false;
    let revoked = false;
    const calls = new Map<string, ToolCall>();
    const invocationEvidence = new Map<string, Awaited<ReturnType<ReflectionService['authorizeEvidence']>>>();
    const diagnosticIds = new Map<string, string>();
    const scopedDiagnosticId = (kind: string, id: unknown) => {
      const key = `${kind}:${z.string().min(1).max(256).parse(id)}`;
      if (!diagnosticIds.has(key)) diagnosticIds.set(key, randomUUID());
      return diagnosticIds.get(key)!;
    };
    const live = () => {
      signal.throwIfAborted();
      if (revoked) throw new ReflectionError('Reflection IPC 已撤销', 409, 'REFLECTION_STALE_RUN');
      const actual = this.jobs.get(job.id);
      if (actual?.status !== 'running' || actual.runId !== runId)
        throw new ReflectionError('Reflection 已结束', 409, 'REFLECTION_STALE_RUN');
    };
    const effect = (callId: string) =>
      this.d.db.prepare('SELECT result FROM reflection_effects WHERE run_id=? AND call_id=?').get(runId, callId);
    const commitEffect = (callId: string, value: unknown, change: ReflectionRecord['changes'][number]) => {
      live();
      this.d.db
        .prepare('INSERT INTO reflection_effects VALUES (?,?,?)')
        .run(runId, callId, JSON.stringify(result(value)));
      const current = this.get(record.id);
      const next = { ...current, changes: [...current.changes, change] };
      this.save(next);
    };
    const source = (callId: string): MemoryContext => {
      live();
      const entry = manager
        ?.getBranch()
        .findLast(
          (e) =>
            e.type === 'message' &&
            e.message.role === 'assistant' &&
            e.message.content.some((p) => p.type === 'toolCall' && p.id === callId),
        );
      if (!entry || !committed) throw new ReflectionError('反思来源尚未保存', 503);
      const evidence = invocationEvidence.get(callId);
      return {
        actor: 'agent',
        project: job.project,
        source: { sessionId, entryId: entry.id, project: job.project },
        evidenceSources: evidence?.sources,
        basisSources: evidence?.basis,
        onCommit: (rev) =>
          commitEffect(callId, rev, { kind: 'memory', id: rev.id, revision: rev.revision, summary: rev.reason }),
      };
    };
    function tool<T extends TSchema>(
      name: string,
      description: string,
      parameters: T,
      run: (args: Static<T>, callId: string) => unknown | Promise<unknown>,
    ): ToolDefinition<T> {
      return {
        name,
        label: name,
        description,
        parameters,
        executionMode: 'sequential',
        async execute(callId, args) {
          return result(await run(args, callId));
        },
      };
    }
    const memory = memoryTools(this.d.memory, job.project, async (id) => source(id)).map((t) => {
      if (!['memory_save', 'memory_revise', 'memory_retire'].includes(t.name)) return t;
      return {
        ...t,
        description: `${t.description} Supply evidence references for factual sources; current Project decisions require current non-Reflection Session evidence.`,
        parameters: Type.Object(
          {
            ...(t.parameters as TSchema & { properties: Record<string, TSchema> }).properties,
            evidence: Type.Optional(evidenceInput),
          },
          { additionalProperties: false },
        ),
      };
    });
    const tools: ToolDefinition[] = [
      ...memory,
      ...diagnosticTools(this.d.history, job.project),
      ...evolutionTools(this.d.evolution, async (id) => {
        const s = source(id);
        return { actor: 'agent', project: job.project, source: s.source, reflectionId: record.id };
      }).map((t) => ({
        ...t,
        async execute(id: string, args: unknown) {
          const ctx = source(id);
          const value = thisService.d.evolution.create(
            { actor: 'agent', project: job.project, source: ctx.source, reflectionId: record.id },
            evolutionInput.parse(args),
            (created) => commitEffect(id, created, { kind: 'suggestion', id: created.id, summary: created.title }),
          );
          return result(value);
        },
      })),
      tool(
        'history_sessions',
        'List native Sessions in the authorized project, without activating historical Agents.',
        Type.Object(
          {
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
            offset: Type.Optional(Type.Integer({ minimum: 0 })),
          },
          { additionalProperties: false },
        ),
        async (args) => {
          const all = (await this.d.records()).filter((r) => r.cwd === job.project);
          return { total: all.length, items: all.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 30)) };
        },
      ),
      tool(
        'history_entries',
        'Inspect native entry references and a protected preview, optionally for one historical branch. Use diagnostic_evidence for full paginated contents.',
        Type.Object(
          {
            sessionId: Type.String({ format: 'uuid' }),
            leafId: Type.Optional(Type.String({ maxLength: 128 })),
            offset: Type.Optional(Type.Integer({ minimum: 0 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          },
          { additionalProperties: false },
        ),
        async (args) => {
          const loaded = await this.d.read(args.sessionId);
          if (!loaded || loaded.saved.record.cwd !== job.project)
            throw new ReflectionError('Session 不在允许范围', 404);
          const m = restore(loaded.saved.session);
          if (args.leafId && !m.getEntry(args.leafId)) throw new ReflectionError('分支节点不存在', 404);
          const entries = args.leafId ? m.getBranch(args.leafId) : loaded.saved.session.entries;
          return {
            total: entries.length,
            leafId: m.getLeafId(),
            items: entries.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 30)).map((e) => ({
              id: e.id,
              parentId: e.parentId,
              type: e.type,
              preview: JSON.stringify(this.d.sensitive.copy(e)).slice(0, 800),
            })),
          };
        },
      ),
      tool(
        'reflection_search',
        'Read past Reflection records in the authorized project, including earlier uncertainty and knowledge changes.',
        Type.Object({ id: Type.Optional(Type.String({ format: 'uuid' })) }, { additionalProperties: false }),
        (args) => {
          if (args.id) {
            const r = this.get(args.id);
            if (r.project !== job.project) throw new ReflectionError('记录不存在', 404);
            return r;
          }
          return this.list().filter((r) => r.project === job.project);
        },
      ),
      tool(
        'skill_info',
        'Read scoped Skill descriptions and declared descriptive Knowledge. Does not load executable extensions or expose host filesystem paths.',
        Type.Object(
          { id: Type.Optional(Type.String({ format: 'uuid' })), path: Type.Optional(Type.String({ maxLength: 4096 })) },
          { additionalProperties: false },
        ),
        async (args) => {
          const all = this.d.skills.records().filter((s) => !s.project || s.project === job.project);
          if (!args.id)
            return all.map((s) => ({
              id: s.id,
              name: s.name,
              description: s.description,
              enabled: s.enabled,
              revision: s.revision,
            }));
          const s = all.find((s) => s.id === args.id);
          if (!s?.current) throw new ReflectionError('正式 Skill 不存在', 404);
          const version = this.d.skills.version(s.current);
          if (args.path && args.path !== version.skillFile && !version.knowledgeFiles.includes(args.path))
            throw new ReflectionError('仅允许 Skill 定义和独立知识文件', 403);
          const paths = args.path ? [args.path] : [version.skillFile, ...version.knowledgeFiles];
          return {
            id: s.id,
            name: s.name,
            revision: s.revision,
            version: version.id,
            knowledgeFiles: version.knowledgeFiles,
            files: await Promise.all(
              paths.map(async (p) => {
                const f = await this.d.skills.read(s.id, version.id, p);
                return { path: p, content: f.content };
              }),
            ),
          };
        },
      ),
      tool(
        'skill_knowledge_revise',
        'Revise only a declared independent descriptive Knowledge file. Formal SKILL.md, Tool, Hook and rules are protected.',
        Type.Object(
          {
            id: Type.String({ format: 'uuid' }),
            baseRevision: Type.Integer({ minimum: 1 }),
            path: Type.String({ maxLength: 4096 }),
            content: Type.String({ maxLength: 32000 }),
            reason: Type.String({ minLength: 1, maxLength: 4000 }),
            evidence: Type.Optional(evidenceInput),
          },
          { additionalProperties: false },
        ),
        async (args, id) => {
          const s = this.d.skills.record(args.id);
          if (s.project && s.project !== job.project) throw new ReflectionError('Skill 不在允许范围', 404);
          const ctx = source(id);
          const entry = await this.d.skills.setKnowledge(
            s.id,
            args.baseRevision,
            args.path,
            this.d.sensitive.text(args.content),
            {
              reason: this.d.sensitive.text(args.reason),
              sessionId,
              entryId: ctx.source!.entryId,
              reflectionId: record.id,
              evidence: invocationEvidence.get(id)?.sources,
            },
            (value) =>
              commitEffect(id, value, {
                kind: 'skill_knowledge',
                id: value.skillId,
                knowledgeRevision: value.id,
                file: value.file,
                version: value.version,
                summary: args.reason,
              }),
          );
          await this.d.refreshKnowledge();
          return entry;
        },
      ),
      tool(
        'reflection_save',
        reflectionOutputGuidance,
        Type.Object(
          {
            summary: Type.String({ minLength: 1, maxLength: 32000 }),
            findings: Type.Array(Type.String({ maxLength: 8000 }), { maxItems: 100 }),
            uncertainties: Type.Array(Type.String({ maxLength: 8000 }), { maxItems: 100 }),
            evidence: evidenceInput,
          },
          { additionalProperties: false },
        ),
        async (args, id) => {
          const input = recordInput.parse(args);
          Object.assign(record, input);
          this.d.db.exec('BEGIN IMMEDIATE');
          try {
            this.save(record);
            this.d.db
              .prepare('INSERT INTO reflection_effects VALUES (?,?,?)')
              .run(runId, id, JSON.stringify(result({ id: record.id })));
            this.d.db.exec('COMMIT');
          } catch (e) {
            this.d.db.exec('ROLLBACK');
            throw e;
          }
          return { id: record.id };
        },
      ),
    ];
    const thisService = this;
    const declarations = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
    const byName = new Map(tools.map((t) => [t.name, t]));
    const approvedModel = this.d.runtime.getModel(job.provider, job.model);
    const bridgeModel: Model<Api> = {
      id: 'reflection-host-approved',
      name: 'Authorized Reflection',
      provider: 'reflection-host',
      api: approvedModel?.api ?? 'openai-responses',
      baseUrl: '',
      reasoning: approvedModel?.reasoning ?? false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: approvedModel?.contextWindow ?? 128000,
      maxTokens: approvedModel?.maxTokens ?? 8192,
    };
    const controllers = new Map<string, AbortController>();
    const handle = async (operation: string, raw: unknown): Promise<unknown> => {
      if (operation === 'cancel') {
        revoked = true;
        for (const c of controllers.values()) c.abort();
        return { ok: true };
      }
      live();
      if (operation === 'model') {
        const input = z
          .object({
            modelId: z.literal('reflection-host-approved'),
            context: z.object({ messages: z.array(z.unknown()).max(2000) }).strict(),
          })
          .strict()
          .parse(raw);
        if (Buffer.byteLength(JSON.stringify(input.context)) > 4 * 1024 * 1024)
          throw new ReflectionError('模型上下文过大', 413);
        this.validateTranscript(input.context.messages, declarations, calls);
        while (!this.d.canRun()) {
          live();
          await delay(100, undefined, { signal });
        }
        if (!approvedModel) throw new ReflectionError('授权模型不可用', 503);
        const requestId = randomUUID(),
          controller = new AbortController();
        controllers.set(requestId, controller);
        const timeout = setTimeout(() => controller.abort(), this.d.modelTimeoutMs ?? 120000);
        timeout.unref();
        const combined = AbortSignal.any([signal, controller.signal]);
        let rejectAborted: (() => void) | undefined;
        try {
          const response = await Promise.race([
            this.d.runtime.completeSimple(
              approvedModel,
              this.d.sensitive.copy(input.context) as unknown as TranscriptContext,
              {
                signal: combined,
              },
            ),
            new Promise<never>((_, reject) => {
              rejectAborted = () => reject(new ReflectionError('模型请求取消或超时', 504));
              if (combined.aborted) reject(new ReflectionError('模型请求取消或超时', 504));
              else combined.addEventListener('abort', rejectAborted, { once: true });
            }),
          ]);
          live();
          const safe = this.d.sensitive.copy({
            ...response,
            api: bridgeModel.api,
            provider: bridgeModel.provider,
            model: bridgeModel.id,
          });
          for (const part of safe.content)
            if (part.type === 'toolCall') {
              if (calls.has(part.id)) throw new ReflectionError('模型重复 ToolCall ID');
              calls.set(part.id, part);
            }
          return safe;
        } finally {
          if (rejectAborted) combined.removeEventListener('abort', rejectAborted);
          clearTimeout(timeout);
          controllers.delete(requestId);
        }
      }
      if (operation === 'checkpoint') {
        const saved = raw as Snapshot;
        if (saved?.header?.id !== sessionId || saved.header.cwd !== job.project || !Array.isArray(saved.entries))
          throw new ReflectionError('检查点身份无效', 403);
        const ids = new Set<string>();
        for (const e of saved.entries) {
          if (ids.has(e.id) || (e.parentId !== null && !ids.has(e.parentId)))
            throw new ReflectionError('检查点树无效', 400);
          ids.add(e.id);
        }
        if (
          committed &&
          JSON.stringify(saved.entries.slice(0, committed.entries.length)) !== JSON.stringify(committed.entries)
        )
          throw new ReflectionError('检查点不能改写已保存历史', 403);
        for (const e of saved.entries)
          if (e.type === 'message' && e.message.role === 'assistant')
            for (const p of e.message.content)
              if (p.type === 'toolCall' && JSON.stringify(calls.get(p.id ?? '')) !== JSON.stringify(p))
                throw new ReflectionError('检查点包含未授权 ToolCall', 403);
        const restored = restore(saved);
        const name = `sessions/${sessionId}.enc`;
        if (committed)
          await this.d.store.write(`${name}.prev`, {
            record: {
              id: sessionId,
              cwd: job.project,
              project: job.project,
              purpose: 'reflection',
              provider: job.provider,
              model: job.model,
              title: '后台反思',
              updated: Date.now(),
            },
            session: committed,
          });
        await this.d.store.write(name, {
          record: {
            id: sessionId,
            cwd: job.project,
            project: job.project,
            purpose: 'reflection',
            provider: job.provider,
            model: job.model,
            title: '后台反思',
            updated: Date.now(),
          },
          session: saved,
        });
        live();
        this.d.db
          .prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated')
          .run(sessionId, Date.now());
        this.d.memory.reconcileSource(
          sessionId,
          restored.getLeafId(),
          restored.getBranch().map((e) => e.id),
        );
        manager = restored;
        committed = structuredClone(saved);
        return { saved: true };
      }
      if (operation === 'tool') {
        const input = z
          .object({ name: z.string(), toolCallId: z.string().min(1), args: z.unknown() })
          .strict()
          .parse(raw);
        const definition = byName.get(input.name),
          call = calls.get(input.toolCallId);
        if (
          !definition ||
          !call ||
          call.name !== input.name ||
          JSON.stringify(call.arguments) !== JSON.stringify(input.args)
        )
          throw new ReflectionError('ToolCall 不在本次授权内', 403);
        validateToolArguments(definition as Tool, call);
        const old = effect(call.id);
        if (old) return JSON.parse(String(old.result));
        const args = z.record(z.string(), z.unknown()).parse(input.args);
        const knowledge = args.knowledge as Record<string, unknown> | undefined;
        const refs = z
          .array(evolutionEvidence)
          .max(100)
          .parse(args.evidence ?? []);
        invocationEvidence.set(call.id, await this.authorizeEvidence(job.project, refs));

        if (
          knowledge?.kind === 'decision' &&
          knowledge?.scope === 'project' &&
          !invocationEvidence.get(call.id)?.basis.length
        )
          throw new ReflectionError('项目决定需要当前分支中的实际依据', 403);
        const actualArgs = { ...args };
        if (input.name.startsWith('memory_')) delete actualArgs.evidence;
        try {
          return this.d.sensitive.copy(
            await definition.execute(call.id, actualArgs, signal, undefined, undefined as never),
          );
        } finally {
          Object.assign(record, this.get(record.id));
        }
      }
      if (operation === 'diagnostic') {
        const data = z
          .object({
            method: z.enum(['trace', 'turn', 'call', 'event', 'gap', 'flush']),
            args: z.array(z.unknown()).max(3),
          })
          .strict()
          .parse(raw);
        const args = data.args;
        if (data.method === 'flush') {
          this.d.diagnostics.flush();
          return {};
        }
        if (data.method === 'gap') {
          this.d.diagnostics.gap();
          return {};
        }
        const trace = (data.method === 'trace' ? args[1] : data.method === 'event' ? args[2] : args[0]) as
          | DiagnosticTrace
          | undefined;
        if (trace && (trace.id !== traceId || trace.sessionId !== sessionId))
          throw new ReflectionError('诊断身份无效', 403);
        if (data.method === 'trace') this.d.diagnostics.trace(job.project, args[1] as DiagnosticTrace);
        else if (data.method === 'turn') {
          const turn = args[1] as DiagnosticTurn;
          this.d.diagnostics.turn(args[0] as DiagnosticTrace, { ...turn, id: scopedDiagnosticId('turn', turn?.id) });
        } else if (data.method === 'call') {
          const call = args[1] as DiagnosticCall;
          this.d.diagnostics.call(args[0] as DiagnosticTrace, { ...call, id: scopedDiagnosticId('call', call?.id) });
        } else if (data.method === 'event') {
          const e = args[1] as DiagnosticEvent;
          if (e.traceId && e.traceId !== traceId) throw new ReflectionError('诊断来源无效', 403);
          this.d.diagnostics.event(sessionId, { ...e, id: scopedDiagnosticId('event', e.id) }, trace);
        }
        return {};
      }
      if (operation === 'complete') {
        if (!committed) throw new ReflectionError('反思未保存检查点');
        if (!record.summary) {
          const last = manager?.getBranch().findLast((e) => e.type === 'message' && e.message.role === 'assistant');
          record.summary =
            last?.type === 'message' && last.message.role === 'assistant'
              ? last.message.content
                  .filter((p) => p.type === 'text')
                  .map((p) => p.text)
                  .join('\n')
              : '未形成额外结论';
        }
        this.save(record);
        completed = true;
        return { ok: true };
      }
      throw new ReflectionError('IPC 操作未授权', 403, 'REFLECTION_OPERATION_DENIED');
    };
    try {
      await this.executor.execute(
        {
          kind: 'start',
          runId,
          sessionId,
          traceId,
          project: job.project,
          model: bridgeModel,
          tools: declarations,
          prompt: `Review completed task evidence autonomously. Source Session ${job.sessionId}; stable references ${JSON.stringify(job.sources)}. You may inspect other authorized history and past reflections. Update descriptive knowledge or submit suggestions only when justified.\n${reflectionOutputGuidance}`,
        },
        handle,
        signal,
      );
      if (!completed) throw new ReflectionError('Worker 未完成保存');
      this.jobs.finish(job.id, runId, 'succeeded');
    } catch {
      const status = signal.aborted ? 'interrupted' : 'failed';
      const error = signal.aborted
        ? '反思已中断；已提交成果保留，不自动重放'
        : '反思未完成，请检查模型、沙箱或受控接口状态';
      record.error = error;
      try {
        this.save(record);
      } finally {
        this.jobs.finish(job.id, runId, status, error);
      }
      this.d.diagnostics.system('REFLECTION_RUN_FAILED', 'warn', sessionId, traceId);
    } finally {
      for (const c of controllers.values()) c.abort();
      this.d.changed();
    }
  }
  private validateTranscript(messages: unknown[], tools: Tool[], calls: Map<string, ToolCall>) {
    for (const raw of messages) {
      const m = z
        .object({
          role: z.enum(['system', 'user', 'assistant', 'toolResult']),
          content: z.unknown().optional(),
          toolsAdded: z.array(z.object({ name: z.string() }).passthrough()).optional(),
          toolsRemoved: z.array(z.object({ name: z.string() }).passthrough()).optional(),
          sections: z.record(z.string(), z.string().nullable()).optional(),
          toolCallId: z.string().optional(),
          toolName: z.string().optional(),
        })
        .passthrough()
        .parse(raw);
      if (m.role === 'system') {
        if (m.content !== undefined && typeof m.content !== 'string' && !Array.isArray(m.content))
          throw new ReflectionError('系统消息无效', 400);
        for (const t of m.toolsAdded ?? []) {
          const allowed = tools.find((a) => a.name === t.name);
          if (!allowed || JSON.stringify(allowed) !== JSON.stringify(t))
            throw new ReflectionError('模型 Tool 声明未授权', 403);
        }
        for (const t of m.toolsRemoved ?? [])
          if (!tools.some((a) => a.name === t.name)) throw new ReflectionError('Tool 变更未授权', 403);
        if (
          m.sections !== undefined &&
          (!m.sections ||
            typeof m.sections !== 'object' ||
            Object.values(m.sections).some((v) => v !== null && typeof v !== 'string'))
        )
          throw new ReflectionError('Prompt sections无效', 400);
      } else if (m.role === 'assistant') {
        if (!Array.isArray(m.content)) throw new ReflectionError('Assistant 消息无效', 400);
        for (const item of m.content) {
          const p = z.object({ type: z.string(), id: z.string().optional() }).passthrough().parse(item);
          if (p.type === 'toolCall' && JSON.stringify(calls.get(p.id ?? '')) !== JSON.stringify(item))
            throw new ReflectionError('未知 ToolCall', 403);
        }
      } else if (m.role === 'toolResult') {
        const call = calls.get(m.toolCallId ?? '');
        if (!call || call.name !== m.toolName || !Array.isArray(m.content))
          throw new ReflectionError('ToolResult 关联无效', 403);
      } else if (typeof m.content !== 'string' && !Array.isArray(m.content))
        throw new ReflectionError('User 消息无效', 400);
    }
  }
}
