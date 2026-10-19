import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { SensitiveData } from '../storage/storage.js';

const identifier = z.string().min(1).max(128);
export const evolutionEvidence = z
  .object({
    sessionId: z.string().uuid().optional(),
    entryId: identifier.optional(),
    traceId: z.string().uuid().optional(),
    memoryId: z.string().uuid().optional(),
    revision: z.number().int().positive().optional(),
    skillId: z.string().uuid().optional(),
    knowledgeRevision: identifier.optional(),
    reflectionId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => value.sessionId || value.traceId || value.memoryId || value.skillId || value.reflectionId, {
    message: '证据需要来源标识',
  })
  .refine((value) => !value.entryId || value.sessionId, { message: 'Entry 需要 Session' })
  .refine((value) => !value.revision || value.memoryId, { message: 'Memory 修订需要 Memory' })
  .refine((value) => !value.knowledgeRevision || value.skillId, { message: 'Knowledge 修订需要 Skill' });
export type EvolutionEvidence = z.infer<typeof evolutionEvidence>;
export const evolutionInput = z
  .object({
    title: z.string().trim().min(1).max(240),
    goal: z.string().trim().min(1).max(8000),
    reason: z.string().trim().min(1).max(8000),
    value: z.string().trim().min(1).max(8000),
    uncertainty: z.string().trim().min(1).max(8000),
    action: z.string().trim().min(1).max(8000),
    evidence: z.array(evolutionEvidence).max(100),
    priority: z.enum(['normal', 'high']),
    attentionReason: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();
export type EvolutionInput = z.infer<typeof evolutionInput>;
const sourceSchema = z
  .object({ sessionId: z.string().uuid(), entryId: identifier, project: z.string().min(1).max(4096) })
  .strict();
export interface EvolutionContext {
  actor: 'agent' | 'user';
  project?: string;
  source?: z.infer<typeof sourceSchema>;
  reflectionId?: string;
}
export const evolutionStatus = z.enum(['pending', 'adopted', 'ignored', 'archived']);
const suggestionSchema = evolutionInput
  .extend({
    id: z.string().uuid(),
    project: z.string().nullable(),
    actor: z.enum(['agent', 'user']),
    source: sourceSchema.optional(),
    reflectionId: z.string().uuid().optional(),
    status: evolutionStatus,
    revision: z.number().int().positive(),
    created: z.number(),
    updated: z.number(),
    discussionSessionId: z.string().uuid().optional(),
    discussionError: z.string().max(4000).optional(),
  })
  .strict();
export type EvolutionSuggestion = z.infer<typeof suggestionSchema>;
export const evolutionQuery = z
  .object({
    status: evolutionStatus.optional(),
    project: z.string().min(1).max(4096).optional(),
    sessionId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export interface EvolutionCatalog {
  items: EvolutionSuggestion[];
  total: number;
  highPriorityPending: number;
}
export const evolutionSelection = z
  .array(z.object({ id: z.string().uuid(), baseRevision: z.number().int().positive() }).strict())
  .min(1)
  .max(100)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, { message: '建议不能重复选择' });
export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = 'EVOLUTION_CONFLICT',
  ) {
    super(message);
  }
}
export type EnsureDiscussion = (sessionId: string, suggestion: EvolutionSuggestion) => Promise<void>;
export type AuthorizeSuggestion = (ctx: EvolutionContext, input: EvolutionInput) => Promise<void>;

/** Suggestions own decisions; a discussion never implies development authorization. */
export class EvolutionService {
  private adoptions = new Map<string, Promise<EvolutionSuggestion>>();
  constructor(
    private db: DatabaseSync,
    private sensitive: SensitiveData,
    private changed: () => void,
  ) {}
  init() {
    this.transaction(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS product_migrations (name TEXT PRIMARY KEY, version INTEGER NOT NULL)');
      const migration = this.db.prepare('SELECT version FROM product_migrations WHERE name=?').get('evolution');
      if (migration && Number(migration.version) !== 1)
        throw new EvolutionError('不支持的建议数据版本', 503, 'EVOLUTION_SCHEMA');
      if (!migration)
        this.db.exec(`
          CREATE TABLE evolution_suggestions (
            id TEXT PRIMARY KEY, project TEXT, status TEXT NOT NULL,
            created INTEGER NOT NULL, updated INTEGER NOT NULL,
            data TEXT NOT NULL CHECK(json_valid(data))
          );
          CREATE INDEX evolution_suggestion_status ON evolution_suggestions(status,created DESC);
          CREATE INDEX evolution_suggestion_project ON evolution_suggestions(project,created DESC);
          INSERT INTO product_migrations VALUES ('evolution',1);
        `);
    });
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private context(ctx: EvolutionContext) {
    if (ctx.actor === 'agent' && !ctx.project) throw new EvolutionError('活动缺少项目授权', 403, 'EVOLUTION_SCOPE');
    if (ctx.source) {
      sourceSchema.parse(ctx.source);
      if (!ctx.project || ctx.source.project !== ctx.project)
        throw new EvolutionError('来源不属于当前项目', 403, 'EVOLUTION_SCOPE');
    }
    if (ctx.reflectionId) z.string().uuid().parse(ctx.reflectionId);
  }
  private protect(value: EvolutionSuggestion) {
    try {
      return suggestionSchema.parse(this.sensitive.copy(value));
    } catch {
      throw new EvolutionError('建议信息保护未完成', 503, 'EVOLUTION_PROTECTION_FAILED');
    }
  }
  private write(value: EvolutionSuggestion) {
    const safe = this.protect(value);
    this.db
      .prepare(`INSERT INTO evolution_suggestions VALUES (?,?,?,?,?,?) ON CONFLICT(id)
        DO UPDATE SET project=excluded.project,status=excluded.status,updated=excluded.updated,data=excluded.data`)
      .run(safe.id, safe.project, safe.status, safe.created, safe.updated, JSON.stringify(safe));
    return safe;
  }
  get(ctx: EvolutionContext, id: string): EvolutionSuggestion {
    this.context(ctx);
    z.string().uuid().parse(id);
    const row = this.db.prepare('SELECT data FROM evolution_suggestions WHERE id=?').get(id);
    if (!row) throw new EvolutionError('建议不存在', 404, 'EVOLUTION_NOT_FOUND');
    const value = suggestionSchema.parse(JSON.parse(String(row.data)));
    if (ctx.actor === 'agent' && value.project !== ctx.project)
      throw new EvolutionError('建议不存在', 404, 'EVOLUTION_NOT_FOUND');
    return this.protect(value);
  }
  create(ctx: EvolutionContext, input: EvolutionInput, onCommit?: (value: EvolutionSuggestion) => void) {
    this.context(ctx);
    const parsed = evolutionInput.parse(input),
      now = Date.now();
    const value = this.transaction(() => {
      const saved = this.write({
        ...parsed,
        id: randomUUID(),
        actor: ctx.actor,
        project: ctx.project ?? null,
        ...(ctx.source ? { source: ctx.source } : {}),
        ...(ctx.reflectionId ? { reflectionId: ctx.reflectionId } : {}),
        status: 'pending',
        revision: 1,
        created: now,
        updated: now,
      });
      onCommit?.(saved);
      return saved;
    });
    this.changed();
    return value;
  }
  list(ctx: EvolutionContext = { actor: 'user' }, input: unknown = {}): EvolutionCatalog {
    this.context(ctx);
    const query = evolutionQuery.parse(input);
    if (ctx.actor === 'agent' && query.project && query.project !== ctx.project)
      throw new EvolutionError('项目超出活动授权', 403, 'EVOLUTION_SCOPE');
    const project = ctx.actor === 'agent' ? ctx.project : query.project;
    const clauses: string[] = [],
      args: string[] = [];
    if (project) {
      clauses.push('project=?');
      args.push(project);
    }
    if (query.sessionId) {
      clauses.push(`(json_extract(data,'$.source.sessionId')=? OR EXISTS
        (SELECT 1 FROM json_each(data,'$.evidence') WHERE json_extract(value,'$.sessionId')=?))`);
      args.push(query.sessionId, query.sessionId);
    }
    const where = () => (clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '');
    const highPriorityPending = Number(
      this.db
        .prepare(`SELECT count(*) AS total FROM evolution_suggestions${where()}
          ${clauses.length ? 'AND' : 'WHERE'} status='pending' AND json_extract(data,'$.priority')='high'`)
        .get(...args)?.total ?? 0,
    );
    if (query.status) {
      clauses.push('status=?');
      args.push(query.status);
    }
    const total = Number(
      this.db.prepare(`SELECT count(*) AS total FROM evolution_suggestions${where()}`).get(...args)?.total ?? 0,
    );
    const values = this.db
      .prepare(`SELECT data FROM evolution_suggestions${where()} ORDER BY created DESC,id DESC LIMIT ? OFFSET ?`)
      .all(...args, query.limit, query.offset)
      .map((row) => this.protect(suggestionSchema.parse(JSON.parse(String(row.data)))));
    return {
      items: values,
      total,
      highPriorityPending,
    };
  }
  manage(input: Array<{ id: string; baseRevision: number }>, status: 'ignored' | 'archived') {
    const selection = evolutionSelection.parse(input);
    z.enum(['ignored', 'archived']).parse(status);
    const values = this.transaction(() => {
      const current = selection.map(({ id, baseRevision }) => {
        const value = this.get({ actor: 'user' }, id);
        if (value.revision !== baseRevision) throw new EvolutionError('建议已被修改，请刷新后重新选择');
        if (this.adoptions.has(id)) throw new EvolutionError('建议正在进入讨论，请稍后管理');
        return value;
      });
      return current.map((value) =>
        value.status === status
          ? value
          : this.write({ ...value, status, revision: value.revision + 1, updated: Date.now() }),
      );
    });
    this.changed();
    return { items: values };
  }
  async adopt(id: string, baseRevision: number, ensureDiscussion: EnsureDiscussion): Promise<EvolutionSuggestion> {
    z.string().uuid().parse(id);
    z.number().int().positive().parse(baseRevision);
    const running = this.adoptions.get(id);
    if (running) return running;
    const reserved = this.transaction(() => {
      const value = this.get({ actor: 'user' }, id);
      if (value.status === 'adopted') return value;
      if (value.revision !== baseRevision) throw new EvolutionError('建议已被修改，请刷新后再采纳');
      if (value.status !== 'pending') throw new EvolutionError('只有待处理建议可以采纳');
      return value.discussionSessionId ? value : this.write({ ...value, discussionSessionId: randomUUID() });
    });
    if (reserved.status === 'adopted') return reserved;
    const sessionId = reserved.discussionSessionId;
    if (!sessionId) throw new EvolutionError('讨论会话标识缺失', 503, 'EVOLUTION_DISCUSSION_FAILED');
    const task = Promise.resolve()
      .then(async () => {
        await ensureDiscussion(sessionId, reserved);
        const saved = this.transaction(() => {
          const current = this.get({ actor: 'user' }, id);
          if (current.status === 'adopted' && current.discussionSessionId === sessionId) return current;
          if (current.status !== 'pending' || current.discussionSessionId !== sessionId)
            throw new EvolutionError('建议状态已变化，请检查已有讨论会话');
          return this.write({
            ...current,
            status: 'adopted',
            revision: current.revision + 1,
            updated: Date.now(),
            discussionError: undefined,
          });
        });
        this.changed();
        return saved;
      })
      .catch((error: unknown) => {
        let message = '讨论会话准备未完成，请重试采纳';
        if (error instanceof Error) message += `：${this.sensitive.text(error.message).slice(0, 1000)}`;
        const current = this.get({ actor: 'user' }, id);
        if (current.status === 'pending' && current.discussionSessionId === sessionId) {
          this.transaction(() => this.write({ ...current, discussionError: message, updated: Date.now() }));
          this.changed();
        }
        throw new EvolutionError(message, 503, 'EVOLUTION_DISCUSSION_FAILED');
      })
      .finally(() => this.adoptions.delete(id));
    this.adoptions.set(id, task);
    return task;
  }
}
