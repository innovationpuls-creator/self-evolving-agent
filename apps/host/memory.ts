import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { SensitiveData } from './storage.js';

export const memoryContent = z
  .object({
    title: z.string().trim().min(1).max(240),
    content: z.string().trim().min(1).max(32000),
    kind: z.enum(['fact', 'experience', 'decision', 'hypothesis']),
    scope: z.enum(['global', 'project']),
  })
  .strict();
export type MemoryContent = z.infer<typeof memoryContent>;
export const memoryReason = z.string().trim().min(1).max(4000);
const sourceSchema = z
  .object({ sessionId: z.string().uuid(), entryId: z.string().min(1).max(128), project: z.string() })
  .strict();
export type MemorySource = z.infer<typeof sourceSchema>;
const projectKey = (project?: string) => (project ? createHash('sha256').update(project).digest('hex') : null);
const revisionSchema = memoryContent
  .extend({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    previousRevision: z.number().int().positive().nullable(),
    project: z.string().nullable(),
    status: z.enum(['current', 'withdrawn', 'deleted']),
    operation: z.enum(['create', 'revise', 'confirm', 'retire', 'scope', 'delete', 'branch']),
    reason: memoryReason,
    actor: z.enum(['agent', 'user', 'system']),
    created: z.number(),
    sources: z.array(sourceSchema),
    basis: z.array(sourceSchema),
  })
  .strict();
export type MemoryRevision = z.infer<typeof revisionSchema>;
export interface MemoryContext {
  project?: string;
  actor: 'agent' | 'user';
  source?: MemorySource;
}
export interface MemoryView extends MemoryRevision {
  isCurrent: boolean;
  usable: boolean;
  unavailable: boolean;
}
export class MemoryError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = 'MEMORY_CONFLICT',
  ) {
    super(message);
  }
}

/** SQLite owns knowledge. Source projections contain only references into Pi snapshots. */
export class MemoryService {
  private sources = new Map<string, Set<string>>();
  private changing = new Set<string>();
  private unresolved = new Set<string>();
  private closed = false;
  constructor(
    private db: DatabaseSync,
    private sensitive: SensitiveData,
    private changed: () => void,
  ) {}
  init() {
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    this.transaction(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS product_migrations (name TEXT PRIMARY KEY, version INTEGER NOT NULL)');
      const version = this.db.prepare('SELECT version FROM product_migrations WHERE name=?').get('memory');
      if (version && Number(version.version) !== 1)
        throw new MemoryError('不支持的 Memory 数据版本', 503, 'MEMORY_SCHEMA');
      if (!version)
        this.db.exec(`
        CREATE TABLE memory_revisions (
          seq INTEGER PRIMARY KEY, memory_id TEXT NOT NULL, revision INTEGER NOT NULL,
          data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(memory_id, revision)
        );
        CREATE TABLE memories (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, seq INTEGER NOT NULL REFERENCES memory_revisions(seq));
        CREATE VIRTUAL TABLE memory_fts USING fts5(title, content, tokenize='trigram');
        CREATE INDEX memory_revision_owner ON memory_revisions(memory_id, revision DESC);
        INSERT INTO product_migrations VALUES ('memory',1);
      `);
    });
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private accessible(rev: MemoryRevision, ctx: MemoryContext) {
    return rev.scope === 'global' || rev.project === projectKey(ctx.project);
  }
  private assertOpen() {
    if (this.closed) throw new MemoryError('Memory 已停止', 503, 'MEMORY_CLOSED');
  }
  private head(id: string, ctx: MemoryContext) {
    this.assertOpen();
    const row = this.db
      .prepare('SELECT r.data FROM memories m JOIN memory_revisions r ON r.seq=m.seq WHERE m.id=?')
      .get(id);
    if (!row) throw new MemoryError('记忆不存在', 404, 'MEMORY_NOT_FOUND');
    const rev = revisionSchema.parse(JSON.parse(String(row.data)));
    if (!this.accessible(rev, ctx)) throw new MemoryError('记忆不存在', 404, 'MEMORY_NOT_FOUND');
    return rev;
  }
  private unavailable(rev: MemoryRevision) {
    return (
      rev.status === 'current' &&
      rev.basis.some(
        (s) =>
          this.changing.has(s.sessionId) ||
          this.unresolved.has(s.sessionId) ||
          !this.sources.get(s.sessionId)?.has(s.entryId),
      )
    );
  }
  private view(rev: MemoryRevision, ctx: MemoryContext, isCurrent: boolean): MemoryView {
    const unavailable = this.unavailable(rev);
    // Promoting a conclusion does not disclose its old project's evidence.
    return {
      ...rev,
      title: this.sensitive.text(rev.title),
      content: this.sensitive.text(rev.content),
      reason: this.sensitive.text(rev.reason),
      sources: rev.sources.filter((s) => s.project === projectKey(ctx.project)),
      basis: rev.basis.filter((s) => s.project === projectKey(ctx.project)),
      isCurrent,
      usable: isCurrent && rev.status === 'current' && !unavailable,
      unavailable,
    };
  }
  private checkSource(ctx: MemoryContext) {
    if (
      ctx.source &&
      (this.changing.has(ctx.source.sessionId) ||
        this.unresolved.has(ctx.source.sessionId) ||
        !this.sources.get(ctx.source.sessionId)?.has(ctx.source.entryId))
    ) {
      throw new MemoryError('来源会话正在切换或尚未恢复，请稍后重试', 503, 'MEMORY_SOURCE_UNAVAILABLE');
    }
  }
  private insert(rev: MemoryRevision) {
    // Protection precedes both table and FTS persistence, including revision reasons.
    const safe = revisionSchema.parse({
      ...rev,
      title: this.sensitive.text(rev.title),
      content: this.sensitive.text(rev.content),
      reason: this.sensitive.text(rev.reason),
    });
    const result = this.db
      .prepare('INSERT INTO memory_revisions(memory_id,revision,data) VALUES (?,?,?)')
      .run(safe.id, safe.revision, JSON.stringify(safe));
    this.db
      .prepare('INSERT INTO memory_fts(rowid,title,content) VALUES (?,?,?)')
      .run(result.lastInsertRowid, safe.title, safe.content);
    this.db
      .prepare(`INSERT INTO memories VALUES (?,?,?) ON CONFLICT(id)
      DO UPDATE SET revision=excluded.revision,seq=excluded.seq`)
      .run(safe.id, safe.revision, result.lastInsertRowid);
    return safe;
  }
  create(ctx: MemoryContext, input: MemoryContent, reason: string) {
    this.assertOpen();
    input = memoryContent.parse(input);
    reason = memoryReason.parse(reason);
    if (input.scope === 'project' && !ctx.project) throw new MemoryError('请选择项目', 400, 'MEMORY_PROJECT_REQUIRED');
    const rev = this.transaction(() => {
      this.checkSource(ctx);
      const sources = ctx.source ? [{ ...ctx.source, project: projectKey(ctx.source.project) ?? '' }] : [];
      return this.insert({
        ...input,
        id: randomUUID(),
        revision: 1,
        previousRevision: null,
        project: input.scope === 'project' ? projectKey(ctx.project) : null,
        status: 'current',
        operation: 'create',
        reason,
        actor: ctx.actor,
        created: Date.now(),
        sources,
        basis: input.kind === 'decision' && input.scope === 'project' ? sources : [],
      });
    });
    this.changed();
    return this.view(rev, ctx, true);
  }
  revise(
    ctx: MemoryContext,
    id: string,
    input: {
      baseRevision: number;
      reason: string;
      content?: MemoryContent;
      confirm?: boolean;
      retire?: boolean;
      remove?: boolean;
    },
  ) {
    this.assertOpen();
    const reason = memoryReason.parse(input.reason);
    const content = input.content ? memoryContent.parse(input.content) : undefined;
    const rev = this.transaction(() => {
      const old = this.head(id, ctx);
      if (old.revision !== input.baseRevision) throw new MemoryError('记忆已被修改，请重新读取；本地草稿仍可保留');
      this.checkSource(ctx);
      if (this.unavailable(old) && !input.remove)
        throw new MemoryError('记忆来源尚未恢复，请稍后重试', 503, 'MEMORY_SOURCE_UNAVAILABLE');
      if (old.status === 'deleted') throw new MemoryError('记忆已删除', 410, 'MEMORY_DELETED');
      const next = content ?? old;
      if (next.scope === 'project' && !ctx.project) throw new MemoryError('请选择项目', 400, 'MEMORY_PROJECT_REQUIRED');
      if (input.confirm && !content) throw new MemoryError('重新确认时需提交当前认识', 400, 'MEMORY_INPUT');
      const sources = [...old.sources],
        source = ctx.source ? { ...ctx.source, project: projectKey(ctx.source.project) ?? '' } : undefined;
      if (source && !sources.some((s) => s.sessionId === source.sessionId && s.entryId === source.entryId))
        sources.push(source);
      const scopeChanged =
        next.scope !== old.scope || (next.scope === 'project' && old.project !== projectKey(ctx.project));
      return this.insert({
        ...old,
        ...next,
        id,
        revision: old.revision + 1,
        previousRevision: old.revision,
        project: next.scope === 'project' ? projectKey(ctx.project) : null,
        status: input.remove ? 'deleted' : input.retire ? 'withdrawn' : input.confirm ? 'current' : old.status,
        operation: input.remove
          ? 'delete'
          : input.retire
            ? 'retire'
            : input.confirm
              ? 'confirm'
              : scopeChanged
                ? 'scope'
                : 'revise',
        reason,
        actor: ctx.actor,
        created: Date.now(),
        sources,
        basis:
          next.kind !== 'decision' || next.scope !== 'project'
            ? []
            : input.confirm || scopeChanged || old.kind !== 'decision'
              ? source
                ? [source]
                : []
              : [
                  ...old.basis,
                  ...(source && !old.basis.some((s) => s.sessionId === source.sessionId && s.entryId === source.entryId)
                    ? [source]
                    : []),
                ],
      });
    });
    this.changed();
    return this.view(rev, ctx, true);
  }
  get(ctx: MemoryContext, id: string, includeHistory = false) {
    const current = this.head(id, ctx);
    if (!includeHistory && (current.status !== 'current' || this.unavailable(current))) {
      throw new MemoryError('此记忆已失效或来源尚未恢复，请显式查询历史', 409, 'MEMORY_NOT_CURRENT');
    }
    const history = includeHistory
      ? this.db
          .prepare('SELECT data FROM memory_revisions WHERE memory_id=? ORDER BY revision DESC')
          .all(id)
          .map((row) => revisionSchema.parse(JSON.parse(String(row.data))))
          .filter((rev) => this.accessible(rev, ctx))
          .map((rev) => this.view(rev, ctx, rev.revision === current.revision))
      : [];
    return { current: this.view(current, ctx, true), history };
  }
  search(
    ctx: MemoryContext,
    options: {
      query?: string;
      includeHistory?: boolean;
      scope?: 'global' | 'project';
      limit?: number;
      offset?: number;
    } = {},
  ) {
    this.assertOpen();
    const query = this.sensitive.text(options.query?.trim() ?? ''),
      params: Array<string | number> = [],
      where: string[] = [];
    if (query) {
      if ([...query].length >= 3) {
        where.push('r.seq IN (SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?)');
        params.push(`"${query.replaceAll('"', '""')}"`);
      } else {
        where.push(
          `(json_extract(r.data,'$.title') LIKE ? ESCAPE '\\' OR json_extract(r.data,'$.content') LIKE ? ESCAPE '\\')`,
        );
        const literal = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
        params.push(literal, literal);
      }
    }
    where.push(`(json_extract(r.data,'$.scope')='global' OR json_extract(r.data,'$.project')=?)`);
    params.push(projectKey(ctx.project) ?? '');
    where.push(`(json_extract(h.data,'$.scope')='global' OR json_extract(h.data,'$.project')=?)`);
    params.push(projectKey(ctx.project) ?? '');
    if (options.scope) {
      where.push(`json_extract(r.data,'$.scope')=?`);
      params.push(options.scope);
    }
    if (!options.includeHistory) where.push(`r.seq=m.seq AND json_extract(r.data,'$.status')='current'`);
    const rows = this.db
      .prepare(`SELECT r.seq,r.data,m.seq AS head FROM memory_revisions r
      JOIN memories m ON m.id=r.memory_id JOIN memory_revisions h ON h.seq=m.seq
      WHERE ${where.join(' AND ')} ORDER BY r.seq DESC`)
      .all(...params);
    let unavailable = 0;
    const items = rows.flatMap((row) => {
      const rev = revisionSchema.parse(JSON.parse(String(row.data)));
      const item = this.view(rev, ctx, Number(row.seq) === Number(row.head));
      if (!options.includeHistory && item.unavailable) {
        unavailable++;
        return [];
      }
      return [item];
    });
    const offset = Math.max(0, options.offset ?? 0),
      limit = Math.min(100, Math.max(1, options.limit ?? 30));
    return { items: items.slice(offset, offset + limit), total: items.length, unavailable };
  }
  beginTransition(sessionId: string) {
    this.changing.add(sessionId);
    this.changed();
  }
  sourceFailed(sessionId: string) {
    this.unresolved.add(sessionId);
    this.changed();
  }
  /** Only after the authoritative encrypted snapshot completes; no Pi callback is awaited here. */
  reconcileSource(sessionId: string, leafId: string | null, entryIds: string[], finishTransition = false) {
    const entries = new Set(entryIds);
    let altered = false;
    this.transaction(() => {
      const rows = this.db.prepare('SELECT r.data FROM memories m JOIN memory_revisions r ON r.seq=m.seq').all();
      for (const row of rows) {
        const old = revisionSchema.parse(JSON.parse(String(row.data)));
        const missing = old.basis.filter((s) => s.sessionId === sessionId && !entries.has(s.entryId));
        if (old.status !== 'current' || !missing.length) continue;
        this.insert({
          ...old,
          revision: old.revision + 1,
          previousRevision: old.revision,
          status: 'withdrawn',
          operation: 'branch',
          actor: 'system',
          created: Date.now(),
          reason: `来源会话 ${sessionId} 已回档；原依据 ${missing.map((s) => s.entryId).join(', ')} 不在当前分支，当前节点 ${leafId ?? 'root'}。`,
        });
        altered = true;
      }
    });
    this.sources.set(sessionId, entries);
    this.unresolved.delete(sessionId);
    if (finishTransition) this.changing.delete(sessionId);
    if (altered || finishTransition) this.changed();
  }
  close() {
    this.closed = true;
  }
}
