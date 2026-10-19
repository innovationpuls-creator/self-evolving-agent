import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import type { AgentSessionEvent, SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent';
import type { Usage } from '@earendil-works/pi-ai';
import type { SensitiveData, Snapshot } from '../storage/storage.js';

export const traceMarker = 'diagnostic_trace_v1';
export const diagnosticStatus = z.enum(['running', 'ended', 'stopped', 'failed', 'interrupted']);
export const diagnosticQuery = z
  .object({
    sessionId: z.string().uuid().optional(),
    traceId: z.string().uuid().optional(),
    entryId: z.string().min(1).max(128).optional(),
    branchLeafId: z.string().min(1).max(128).optional(),
    from: z.coerce.number().finite().nonnegative().optional(),
    to: z.coerce.number().finite().nonnegative().optional(),
    toolName: z.string().min(1).max(256).optional(),
    status: diagnosticStatus.optional(),
    hasError: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export const diagnosticPage = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export const evidenceQuery = z
  .object({
    sessionId: z.string().uuid(),
    entryId: z.string().min(1).max(128),
    toolCallId: z.string().min(1).max(256).optional(),
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(32768).default(8192),
  })
  .strict();
export interface DiagnosticContext {
  actor: 'user' | 'agent';
  project?: string;
}
export interface DiagnosticTrace {
  id: string;
  sessionId: string;
  started: number;
  ended: number | null;
  status: z.infer<typeof diagnosticStatus>;
  startLeafId: string | null;
  endLeafId: string | null;
  userEntryId: string | null;
  toolCount: number;
  errorCount: number;
  incomplete: boolean;
  data: Record<string, unknown>;
}
export interface DiagnosticTurn {
  id: string;
  ordinal: number;
  started: number | null;
  ended: number | null;
  assistantEntryId: string | null;
  model: string | null;
  provider: string | null;
  stopReason: string | null;
  usage: Record<string, unknown> | null;
  data: Record<string, unknown>;
}
export interface DiagnosticCall {
  id: string;
  toolCallId: string;
  parentToolCallId: string | null;
  toolName: string;
  sequence: number;
  started: number | null;
  ended: number | null;
  status: 'running' | 'ok' | 'error' | 'unfinished';
  durationMs: number | null;
  outputBytes: number | null;
  assistantEntryId: string | null;
  resultEntryId: string | null;
  data: Record<string, unknown>;
}
export interface DiagnosticEvent {
  id: string;
  traceId: string | null;
  kind: string;
  at: number;
  entryId: string | null;
  data: Record<string, unknown>;
}
export interface DiagnosticResources {
  loaded: Array<{ skillId?: string; version?: string; digest?: string; knowledgeRevision?: string; path: string }>;
  tools: Map<string, { skillId: string; version: string; digest: string }>;
}
export class DiagnosticError extends Error {
  constructor(
    message: string,
    readonly status = 503,
    readonly code = 'DIAGNOSTIC_UNAVAILABLE',
  ) {
    super(message);
  }
}
export const diagnosticProject = (path: string) => createHash('sha256').update(path).digest('hex');
const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
function diagnosticPath(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
/** Pi normalizes missing usage to zero; presence and billed cost cannot be inferred. */
export function diagnosticUsage(usage?: Usage): Record<string, unknown> | null {
  if (!usage) return null;
  return {
    source: 'pi_normalized',
    providerReported: 'unknown',
    input: finite(usage.input),
    output: finite(usage.output),
    cacheRead: finite(usage.cacheRead),
    cacheWrite: finite(usage.cacheWrite),
    reasoning: finite(usage.reasoning),
    totalTokens: finite(usage.totalTokens),
    cost: {
      source: 'pi_catalog_calculation',
      billed: null,
      total: finite(usage.cost?.total),
      availability: usage.cost?.total > 0 ? 'catalog_estimate' : 'unknown',
    },
  };
}
function contentBytes(content: unknown): number | null {
  if (!Array.isArray(content)) return null;
  let size = 0;
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') size += Buffer.byteLength(block.text);
    else if (block?.type === 'image' && typeof block.data === 'string') size += Buffer.byteLength(block.data);
  }
  return size;
}
type Write = { trace?: DiagnosticTrace; run: () => void };

/** A bounded metadata index; authoritative content remains exclusively in encrypted Pi snapshots. */
export class DiagnosticService {
  readonly health = { available: false, dropped: 0 };
  private pending: Write[] = [];
  private timer?: ReturnType<typeof setImmediate>;
  private notification?: ReturnType<typeof setTimeout>;
  private closed = false;
  constructor(
    private db: DatabaseSync,
    private sensitive: SensitiveData,
    private changed: () => void,
  ) {}
  init() {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      this.db.exec('CREATE TABLE IF NOT EXISTS product_migrations (name TEXT PRIMARY KEY, version INTEGER NOT NULL)');
      const version = this.db.prepare('SELECT version FROM product_migrations WHERE name=?').get('diagnostic');
      if (version && version.version !== 1) throw new Error('unsupported');
      if (!version)
        this.db.exec(`
        CREATE TABLE diagnostic_traces(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,project TEXT NOT NULL,started INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE INDEX diagnostic_trace_session ON diagnostic_traces(session_id,started DESC);
        CREATE INDEX diagnostic_trace_project ON diagnostic_traces(project,started DESC);
        CREATE INDEX diagnostic_trace_status ON diagnostic_traces(status,started DESC);
        CREATE TABLE diagnostic_turns(id TEXT PRIMARY KEY,trace_id TEXT NOT NULL,entry_id TEXT,data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE INDEX diagnostic_turn_trace ON diagnostic_turns(trace_id);
        CREATE INDEX diagnostic_turn_entry ON diagnostic_turns(entry_id);
        CREATE TABLE diagnostic_calls(id TEXT PRIMARY KEY,trace_id TEXT NOT NULL,tool_name TEXT NOT NULL,assistant_entry TEXT,result_entry TEXT,data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE INDEX diagnostic_call_trace ON diagnostic_calls(trace_id);
        CREATE INDEX diagnostic_call_name ON diagnostic_calls(tool_name,trace_id);
        CREATE INDEX diagnostic_call_result ON diagnostic_calls(result_entry);
        CREATE TABLE diagnostic_events(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,trace_id TEXT,entry_id TEXT,at INTEGER NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE INDEX diagnostic_event_trace ON diagnostic_events(trace_id,at);
        CREATE INDEX diagnostic_event_session ON diagnostic_events(session_id,at);
        CREATE INDEX diagnostic_event_entry ON diagnostic_events(entry_id);
        CREATE TABLE host_system_logs(seq INTEGER PRIMARY KEY,at INTEGER NOT NULL,level TEXT NOT NULL,code TEXT NOT NULL,session_id TEXT,trace_id TEXT,call_id TEXT);
        CREATE INDEX host_system_time ON host_system_logs(at);
        INSERT INTO product_migrations VALUES('diagnostic',1);
      `);
      this.db.exec('COMMIT');
      this.health.available = true;
      this.prune();
    } catch {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      this.health.available = false;
    }
  }
  private notify() {
    if (this.closed || this.notification) return;
    this.notification = setTimeout(() => {
      this.notification = undefined;
      try {
        this.changed();
      } catch {
        this.health.dropped++;
      }
    }, 150);
    this.notification.unref();
  }
  gap(trace?: DiagnosticTrace) {
    this.health.dropped++;
    if (trace) {
      trace.incomplete = true;
      trace.data.gaps = Number(trace.data.gaps ?? 0) + 1;
    }
    this.notify();
  }
  private enqueue(run: () => void, trace?: DiagnosticTrace) {
    if (this.closed || !this.health.available || this.pending.length >= 1000) {
      this.gap(trace);
      return;
    }
    this.pending.push({ run, trace });
    if (!this.timer)
      this.timer = setImmediate(() => {
        this.timer = undefined;
        this.flush();
      });
    this.notify();
  }
  flush() {
    if (!this.pending.length) return;
    if (this.timer) {
      clearImmediate(this.timer);
      this.timer = undefined;
    }
    let timeout = 0;
    try {
      timeout = Number(this.db.prepare('PRAGMA busy_timeout').get()?.timeout ?? 0);
      this.db.exec('PRAGMA busy_timeout=0');
      try {
        while (this.pending.length) {
          const batch = this.pending.splice(0, 100);
          try {
            this.db.exec('BEGIN IMMEDIATE');
            for (const write of batch) write.run();
            this.db.exec('COMMIT');
          } catch {
            try {
              this.db.exec('ROLLBACK');
            } catch {}
            for (const write of batch) this.gap(write.trace);
          }
        }
      } finally {
        try {
          this.db.exec(`PRAGMA busy_timeout=${timeout}`);
        } catch {}
      }
    } catch {
      for (const write of this.pending.splice(0)) this.gap(write.trace);
    }
  }
  private metadata(value: unknown) {
    const safe = JSON.stringify(this.sensitive.copy(value));
    if (Buffer.byteLength(safe) > 65536) throw new Error('metadata_limit');
    return safe;
  }
  trace(project: string, trace: DiagnosticTrace) {
    try {
      const safe = this.metadata(trace);
      const { id, sessionId, started, status } = trace;
      this.enqueue(
        () =>
          this.db
            .prepare(`INSERT INTO diagnostic_traces VALUES(?,?,?,?,?,?) ON CONFLICT(id)
        DO UPDATE SET status=excluded.status,data=excluded.data`)
            .run(id, sessionId, diagnosticProject(project), started, status, safe),
        trace,
      );
    } catch {
      this.gap(trace);
    }
  }
  turn(trace: DiagnosticTrace, turn: DiagnosticTurn) {
    try {
      const safe = this.metadata(turn);
      const { id, assistantEntryId } = turn;
      this.enqueue(
        () =>
          this.db
            .prepare(
              'INSERT INTO diagnostic_turns VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET entry_id=excluded.entry_id,data=excluded.data',
            )
            .run(id, trace.id, assistantEntryId, safe),
        trace,
      );
    } catch {
      this.gap(trace);
    }
  }
  call(trace: DiagnosticTrace, call: DiagnosticCall) {
    try {
      const safe = this.metadata(call),
        name = this.sensitive.text(call.toolName);
      const { id, assistantEntryId, resultEntryId } = call;
      this.enqueue(
        () =>
          this.db
            .prepare(`INSERT INTO diagnostic_calls VALUES(?,?,?,?,?,?) ON CONFLICT(id)
        DO UPDATE SET assistant_entry=excluded.assistant_entry,result_entry=excluded.result_entry,data=excluded.data`)
            .run(id, trace.id, name, assistantEntryId, resultEntryId, safe),
        trace,
      );
    } catch {
      this.gap(trace);
    }
  }
  event(sessionId: string, event: DiagnosticEvent, trace?: DiagnosticTrace) {
    try {
      const safe = this.metadata(event);
      this.enqueue(
        () =>
          this.db
            .prepare('INSERT OR REPLACE INTO diagnostic_events VALUES(?,?,?,?,?,?)')
            .run(event.id, sessionId, event.traceId, event.entryId, event.at, safe),
        trace,
      );
    } catch {
      this.gap(trace);
    }
  }
  system(code: string, level: 'info' | 'warn' | 'error', sessionId?: string, traceId?: string, callId?: string) {
    // Callers supply fixed codes, never Error objects, request headers or free text.
    if (!/^[A-Z_]{1,80}$/.test(code) || [sessionId, traceId, callId].some((s) => s && s.length > 256)) return;
    try {
      const refs = this.sensitive.copy([sessionId ?? null, traceId ?? null, callId ?? null]);
      if (Buffer.byteLength(JSON.stringify({ level, code, refs })) > 2048) {
        this.gap();
        return;
      }
      this.enqueue(() => {
        this.db
          .prepare('INSERT INTO host_system_logs(at,level,code,session_id,trace_id,call_id) VALUES(?,?,?,?,?,?)')
          .run(Date.now(), level, code, ...refs);
        this.prune();
      });
    } catch {
      this.gap();
    }
  }
  private prune() {
    this.db
      .prepare(
        'DELETE FROM host_system_logs WHERE at < ? OR seq NOT IN (SELECT seq FROM host_system_logs ORDER BY seq DESC LIMIT 5000)',
      )
      .run(Date.now() - 30 * 86400000);
  }
  private assertAvailable() {
    this.flush();
    if (!this.health.available || this.closed) throw new DiagnosticError('运行诊断暂不可用');
  }
  private scope(ctx: DiagnosticContext): [string, SQLInputValue[]] {
    if (ctx.actor === 'agent') {
      if (!ctx.project) throw new DiagnosticError('诊断不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
      return [' AND t.project=?', [diagnosticProject(ctx.project)]];
    }
    return ['', []];
  }
  search(ctx: DiagnosticContext, input: unknown, branchEntries?: string[]) {
    this.assertAvailable();
    const q = diagnosticQuery.parse(input),
      [scope, params] = this.scope(ctx);
    let where = `1=1${scope}`;
    const add = (sql: string, value: SQLInputValue) => {
      where += ` AND ${sql}`;
      params.push(value);
    };
    if (q.sessionId) add('t.session_id=?', q.sessionId);
    if (q.traceId) add('t.id=?', q.traceId);
    if (q.from !== undefined) add('t.started>=?', q.from);
    if (q.to !== undefined) add('t.started<?', q.to);
    if (q.status) add('t.status=?', q.status);
    if (q.hasError) where += ` AND json_extract(t.data,'$.errorCount')${q.hasError === 'true' ? '>0' : '=0'}`;
    if (q.toolName) add('EXISTS(SELECT 1 FROM diagnostic_calls c WHERE c.trace_id=t.id AND c.tool_name=?)', q.toolName);
    if (q.entryId) {
      where += ` AND (json_extract(t.data,'$.userEntryId')=? OR json_extract(t.data,'$.startLeafId')=? OR json_extract(t.data,'$.endLeafId')=?
        OR EXISTS(SELECT 1 FROM diagnostic_calls c WHERE c.trace_id=t.id AND (c.assistant_entry=? OR c.result_entry=?))
        OR EXISTS(SELECT 1 FROM diagnostic_events e WHERE e.trace_id=t.id AND e.entry_id=?)
        OR EXISTS(SELECT 1 FROM diagnostic_turns u WHERE u.trace_id=t.id AND u.entry_id=?))`;
      params.push(...Array<SQLInputValue>(7).fill(q.entryId));
    }
    if (q.branchLeafId) {
      if (!q.sessionId || !branchEntries)
        throw new DiagnosticError('分支筛选需要有效的 Session 和叶节点', 400, 'DIAGNOSTIC_BRANCH_REQUIRED');
      add("json_extract(t.data,'$.userEntryId') IN (SELECT value FROM json_each(?))", JSON.stringify(branchEntries));
    }
    try {
      const total = Number(
        this.db.prepare(`SELECT count(*) n FROM diagnostic_traces t WHERE ${where}`).get(...params)?.n ?? 0,
      );
      const rows = this.db
        .prepare(
          `SELECT t.data FROM diagnostic_traces t WHERE ${where} ORDER BY t.started DESC,t.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, q.limit, q.offset);
      return this.sensitive.copy({
        items: rows.map((row) => JSON.parse(String(row.data)) as DiagnosticTrace),
        total,
        health: { ...this.health },
      });
    } catch {
      throw new DiagnosticError('诊断查询未完成');
    }
  }
  get(ctx: DiagnosticContext, id: string, input: unknown = {}) {
    this.assertAvailable();
    const page = diagnosticPage.parse(input),
      [scope, params] = this.scope(ctx);
    const row = this.db.prepare(`SELECT t.data FROM diagnostic_traces t WHERE t.id=?${scope}`).get(id, ...params);
    if (!row) throw new DiagnosticError('诊断不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
    const read = <T>(table: string) => ({
      items: this.db
        .prepare(`SELECT data FROM ${table} WHERE trace_id=? ORDER BY rowid LIMIT ? OFFSET ?`)
        .all(id, page.limit, page.offset)
        .map((r) => JSON.parse(String(r.data)) as T),
      total: Number(this.db.prepare(`SELECT count(*) n FROM ${table} WHERE trace_id=?`).get(id)?.n ?? 0),
    });
    const turns = read<DiagnosticTurn>('diagnostic_turns'),
      calls = read<DiagnosticCall>('diagnostic_calls'),
      events = read<DiagnosticEvent>('diagnostic_events');
    const sameToolOccurrences = this.db
      .prepare(
        'SELECT tool_name name,count(*) count FROM diagnostic_calls WHERE trace_id=? GROUP BY tool_name ORDER BY count(*) DESC LIMIT 200',
      )
      .all(id);
    const systemLogs = this.db
      .prepare(
        'SELECT at,level,code,session_id sessionId,trace_id traceId,call_id callId FROM host_system_logs WHERE trace_id=? ORDER BY seq DESC LIMIT ? OFFSET ?',
      )
      .all(id, page.limit, page.offset);
    return this.sensitive.copy({
      systemLogs,
      trace: JSON.parse(String(row.data)) as DiagnosticTrace,
      turns: turns.items,
      calls: calls.items,
      events: events.items,
      sameToolOccurrences,
      totals: { turns: turns.total, calls: calls.total, events: events.total },
      health: { ...this.health },
    });
  }
  sessionEvents(ctx: DiagnosticContext, sessionId: string, project: string) {
    this.assertAvailable();
    if (ctx.actor === 'agent' && ctx.project !== project)
      throw new DiagnosticError('诊断不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
    return this.sensitive.copy(
      this.db
        .prepare(
          'SELECT data FROM diagnostic_events WHERE session_id=? AND trace_id IS NULL ORDER BY at DESC LIMIT 100',
        )
        .all(sessionId)
        .map((r) => JSON.parse(String(r.data)) as DiagnosticEvent),
    );
  }
  checkpointUnavailable(sessionId: string) {
    if (!this.health.available) return;
    try {
      this.flush();
      const rows = this.db.prepare('SELECT project,data FROM diagnostic_traces WHERE session_id=?').all(sessionId);
      for (const row of rows) {
        const trace = JSON.parse(String(row.data)) as DiagnosticTrace;
        trace.incomplete = true;
        trace.data.evidenceUnavailable = true;
        if (trace.status === 'running') {
          trace.status = 'interrupted';
          trace.ended = null;
        }
        const safe = this.metadata(trace);
        this.enqueue(
          () =>
            this.db
              .prepare('UPDATE diagnostic_traces SET status=?,data=? WHERE id=?')
              .run(trace.status, safe, trace.id),
          trace,
        );
      }
      this.flush();
    } catch {
      this.gap();
    }
  }
  /** Reconcile from the complete native tree; never manufacture pre-feature traces. */
  reconcile(sessionId: string, project: string, saved: Snapshot, previous: boolean) {
    if (!this.health.available) return;
    this.flush();
    try {
      const entries = new Map(saved.entries.map((e) => [e.id, e]));
      const ends = new Map<string, SessionEntry>();
      const observedTraces = new Set<string>();
      for (const e of saved.entries)
        if (e.type === 'custom' && e.customType === traceMarker) {
          const data = e.data as { phase?: string; traceId?: string } | undefined;
          if (data?.phase === 'end' && data.traceId) ends.set(data.traceId, e);
        }
      for (const start of saved.entries) {
        if (start.type !== 'custom' || start.customType !== traceMarker) continue;
        const m = z
          .object({ version: z.literal(1), phase: z.literal('start'), traceId: z.string().uuid(), at: z.number() })
          .safeParse(start.data);
        if (!m.success) continue;
        observedTraces.add(m.data.traceId);
        const old = this.db.prepare('SELECT data FROM diagnostic_traces WHERE id=?').get(m.data.traceId);
        const end = ends.get(m.data.traceId);
        const endData =
          end?.type === 'custom'
            ? z
                .object({
                  version: z.literal(1),
                  phase: z.literal('end'),
                  traceId: z.string().uuid(),
                  at: z.number(),
                  status: diagnosticStatus,
                  gaps: z.number().optional(),
                })
                .safeParse(end.data)
            : undefined;
        const trace: DiagnosticTrace = old
          ? JSON.parse(String(old.data))
          : {
              id: m.data.traceId,
              sessionId,
              started: m.data.at,
              ended: null,
              status: 'running',
              startLeafId: start.id,
              endLeafId: null,
              userEntryId: null,
              toolCount: 0,
              errorCount: 0,
              incomplete: true,
              data: { recovered: true },
            };
        if (trace.sessionId !== sessionId) continue;
        if (trace.status === 'running') {
          trace.incomplete = true;
          trace.status = endData?.success ? endData.data.status : 'interrupted';
          trace.ended = endData?.success ? endData.data.at : null;
          trace.endLeafId = end?.id ?? null;
        }
        if (!end || previous || !old || (endData?.success && endData.data.gaps)) trace.incomplete = true;
        const path: SessionEntry[] = [];
        let cursor = end ?? entries.get(saved.leafId ?? '');
        while (cursor && cursor.id !== start.id) {
          path.push(cursor);
          cursor = entries.get(cursor.parentId ?? '');
        }
        if (cursor?.id === start.id) {
          path.reverse();
          trace.userEntryId ??= path.find((e) => e.type === 'message' && e.message.role === 'user')?.id ?? null;
        }
        this.trace(project, trace);
        if (cursor?.id === start.id) this.recoverNative(trace, path, project);
      }
      this.flush();
      for (const row of this.db.prepare('SELECT data FROM diagnostic_traces WHERE session_id=?').all(sessionId)) {
        const trace = JSON.parse(String(row.data)) as DiagnosticTrace;
        if (observedTraces.has(trace.id)) continue;
        trace.incomplete = true;
        trace.data.evidenceUnavailable = true;
        if (trace.status === 'running') {
          trace.status = 'interrupted';
          trace.ended = null;
        }
        this.trace(project, trace);
      }
      this.flush();
      this.db
        .prepare(
          "UPDATE diagnostic_calls SET data=json_set(data,'$.status','unfinished') WHERE json_extract(data,'$.status')='running' AND trace_id IN (SELECT id FROM diagnostic_traces WHERE session_id=? AND status<>'running')",
        )
        .run(sessionId);
      if (previous) this.system('CHECKPOINT_PREVIOUS', 'warn', sessionId);
    } catch {
      this.gap();
    }
  }
  private recoverNative(trace: DiagnosticTrace, entries: SessionEntry[], project: string) {
    let ordinal = 0,
      sequence = 0;
    const turns = this.db
      .prepare('SELECT data FROM diagnostic_turns WHERE trace_id=?')
      .all(trace.id)
      .map((r) => JSON.parse(String(r.data)) as DiagnosticTurn);
    const calls = this.db
      .prepare('SELECT data FROM diagnostic_calls WHERE trace_id=?')
      .all(trace.id)
      .map((r) => JSON.parse(String(r.data)) as DiagnosticCall);
    const assistant = new Map<string, string>();
    for (const e of entries) {
      if (
        e.type === 'compaction' &&
        !this.db.prepare('SELECT id FROM diagnostic_events WHERE trace_id=? AND entry_id=?').get(trace.id, e.id)
      ) {
        this.event(
          trace.sessionId,
          {
            id: randomUUID(),
            traceId: trace.id,
            kind: 'compaction_recovered',
            at: Date.parse(e.timestamp),
            entryId: e.id,
            data: { recovered: true, tokensBefore: e.tokensBefore, firstKeptEntryId: e.firstKeptEntryId },
          },
          trace,
        );
      }
      if (e.type !== 'message') continue;
      if (e.message.role === 'assistant') {
        const m = e.message;
        ordinal++;
        const known = turns.find((t) => t.assistantEntryId === e.id || (!t.assistantEntryId && t.ordinal === ordinal));
        this.turn(
          trace,
          known
            ? {
                ...known,
                assistantEntryId: e.id,
                model: known.model ?? m.model,
                provider: known.provider ?? m.provider,
                stopReason: known.stopReason ?? m.stopReason,
                usage: known.usage ?? diagnosticUsage(m.usage),
              }
            : {
                id: randomUUID(),
                ordinal,
                started: null,
                ended: null,
                assistantEntryId: e.id,
                provider: m.provider,
                model: m.model,
                stopReason: m.stopReason,
                usage: diagnosticUsage(m.usage),
                data: { recovered: true, durationMs: finite(m.durationMs) },
              },
        );
        for (const part of m.content) if (part.type === 'toolCall') assistant.set(part.id, e.id);
      }
      if (e.message.role === 'toolResult') {
        const m = e.message;
        const known = calls.find(
          (c) =>
            c.toolCallId === m.toolCallId &&
            (c.resultEntryId === e.id ||
              (!c.resultEntryId && (!c.assistantEntryId || c.assistantEntryId === assistant.get(m.toolCallId)))),
        );
        sequence++;
        this.call(trace, {
          ...(known ?? {}),
          id: known?.id ?? randomUUID(),
          toolCallId: m.toolCallId,
          parentToolCallId: null,
          toolName: m.toolName,
          sequence: known?.sequence ?? sequence,
          started: known?.started ?? null,
          ended: known?.ended ?? null,
          status: m.isError ? 'error' : 'ok',
          durationMs: known?.durationMs ?? finite(m.durationMs),
          outputBytes: contentBytes(m.content),
          assistantEntryId: assistant.get(m.toolCallId) ?? null,
          resultEntryId: e.id,
          data: {
            ...known?.data,
            recovered: !known || known.status === 'running',
            resultAvailability: 'reference_requires_lookup',
            outputMeasure: 'content_text_utf8_and_image_base64_bytes',
          },
        });
        for (const child of m.nestedCalls?.calls ?? []) {
          const existing = calls.find(
            (c) =>
              c.toolCallId === child.id &&
              (c.resultEntryId === e.id ||
                (!c.resultEntryId && (!c.assistantEntryId || c.assistantEntryId === assistant.get(m.toolCallId)))),
          );
          sequence++;
          this.call(trace, {
            id: existing?.id ?? randomUUID(),
            toolCallId: child.id,
            parentToolCallId: existing?.parentToolCallId ?? null,
            toolName: child.name,
            sequence: existing?.sequence ?? sequence,
            started: existing?.started ?? null,
            ended: existing?.ended ?? null,
            status: existing?.status === 'ok' || existing?.status === 'error' ? existing.status : child.status,
            durationMs: existing?.durationMs ?? finite(child.durationMs),
            outputBytes: existing?.outputBytes ?? null,
            assistantEntryId: assistant.get(m.toolCallId) ?? null,
            resultEntryId: e.id,
            data: {
              ...existing?.data,
              recovered: !existing || existing.status === 'running',
              summaryParentToolCallId: m.toolCallId,
              parentAvailability: existing?.parentToolCallId
                ? 'observed_native_event'
                : 'not_recorded_in_native_summary',
              resultAvailability: 'not_persisted_native',
              nestedSummaryComplete: m.nestedCalls?.complete,
            },
          });
        }
      }
    }
    this.flush();
    trace.toolCount = Math.max(
      trace.toolCount,
      Number(this.db.prepare('SELECT count(*) n FROM diagnostic_calls WHERE trace_id=?').get(trace.id)?.n ?? 0),
    );
    const nativeErrors = entries.filter(
      (e) => e.type === 'message' && e.message.role === 'assistant' && e.message.stopReason === 'error',
    ).length;
    const callErrors = Number(
      this.db
        .prepare("SELECT count(*) n FROM diagnostic_calls WHERE trace_id=? AND json_extract(data,'$.status')='error'")
        .get(trace.id)?.n ?? 0,
    );
    trace.errorCount = Math.max(trace.errorCount, nativeErrors + callErrors);
    this.trace(project, trace);
  }
  close() {
    this.flush();
    this.closed = true;
    if (this.notification) clearTimeout(this.notification);
  }
}

/** One active prompt's observation state. It never retains prompt/result objects. */
export class DiagnosticRecorder {
  private trace?: DiagnosticTrace;
  private turn?: DiagnosticTurn;
  private calls = new Map<string, DiagnosticCall>();
  private callSequence = 0;
  private turnSequence = 0;
  private seenLeaf: string | null;
  private resources: DiagnosticResources = { loaded: [], tools: new Map() };
  private settledAborted = false;
  private compaction?: { started: number; beforeLeaf: string | null };
  constructor(
    private service: Pick<DiagnosticService, 'gap' | 'trace' | 'turn' | 'call' | 'event' | 'flush'>,
    private sessionId: string,
    private project: string,
    private manager: SessionManager,
  ) {
    this.seenLeaf = manager.getLeafId();
  }
  get traceId() {
    return this.trace?.id;
  }
  private guard(fn: () => void) {
    try {
      fn();
    } catch {
      this.service.gap(this.trace);
    }
  }
  start(id: string = randomUUID()) {
    this.guard(() => {
      const at = Date.now();
      const trace: DiagnosticTrace = {
        id,
        sessionId: this.sessionId,
        started: at,
        ended: null,
        status: 'running',
        startLeafId: null,
        endLeafId: null,
        userEntryId: null,
        toolCount: 0,
        errorCount: 0,
        incomplete: false,
        data: {},
      };
      this.trace = trace;
      this.settledAborted = false;
      this.callSequence = 0;
      this.turnSequence = 0;
      this.calls.clear();
      trace.startLeafId = this.manager.appendCustomEntry(traceMarker, { version: 1, phase: 'start', traceId: id, at });
      this.seenLeaf = trace.startLeafId;
      this.service.trace(this.project, trace);
    });
  }
  loaded(resources: DiagnosticResources) {
    this.guard(() => {
      this.resources = {
        loaded: resources.loaded.slice(0, 1000).map((r) => ({ ...r, path: diagnosticPath(r.path) })),
        tools: new Map([...resources.tools].slice(0, 1000)),
      };
      this.event('resources_loaded', {
        skills: resources.loaded.slice(0, 1000).map(({ path: _path, ...ref }) => ref),
        count: resources.loaded.length,
      });
      if (resources.loaded.length > 1000 || resources.tools.size > 1000) this.service.gap(this.trace);
    });
  }
  private event(kind: string, data: Record<string, unknown>, entryId: string | null = null) {
    this.service.event(
      this.sessionId,
      { id: randomUUID(), traceId: this.trace?.id ?? null, kind, at: Date.now(), entryId, data },
      this.trace,
    );
  }
  observe(event: AgentSessionEvent) {
    if (event.type === 'message_update' || event.type === 'tool_execution_update') return;
    this.guard(() => {
      const trace = this.trace;
      if (event.type === 'compaction_start')
        this.compaction = { started: Date.now(), beforeLeaf: this.manager.getLeafId() };
      if (event.type === 'compaction_end') {
        this.sync();
        this.event(
          'compaction',
          {
            reason: event.reason,
            aborted: event.aborted,
            willRetry: event.willRetry,
            started: this.compaction?.started ?? null,
            beforeLeafId: this.compaction?.beforeLeaf ?? null,
            tokensBefore: finite(event.result?.tokensBefore),
            estimatedTokensAfter: finite(event.result?.estimatedTokensAfter),
            usage: diagnosticUsage(event.result?.usage),
            failed: Boolean(event.errorMessage),
          },
          this.manager.getLeafEntry()?.type === 'compaction' ? this.manager.getLeafId() : null,
        );
        if (trace && event.errorMessage) trace.errorCount++;
        this.compaction = undefined;
      }
      if (!trace) return;
      if (event.type === 'turn_start')
        this.turn = {
          id: randomUUID(),
          ordinal: ++this.turnSequence,
          started: Date.now(),
          ended: null,
          assistantEntryId: null,
          model: null,
          provider: null,
          stopReason: null,
          usage: null,
          data: { indexSource: 'observed_native_turn' },
        };
      if (event.type === 'tool_execution_start') {
        if (this.calls.size >= 1000) {
          this.service.gap(trace);
          return;
        }
        const call: DiagnosticCall = {
          id: randomUUID(),
          toolCallId: event.toolCallId,
          parentToolCallId: event.parentToolCallId ?? null,
          toolName: event.toolName.slice(0, 256),
          sequence: ++this.callSequence,
          started: Date.now(),
          ended: null,
          status: 'running',
          durationMs: null,
          outputBytes: null,
          assistantEntryId: this.turn?.assistantEntryId ?? null,
          resultEntryId: null,
          data: {
            turnOrdinal: this.turn?.ordinal ?? null,
            skill: this.resources.tools.get(event.toolName) ?? null,
            resultAvailability: event.parentToolCallId ? 'not_persisted_native' : 'pending',
          },
        };
        if (event.toolName === 'read' && event.args && typeof event.args.path === 'string') {
          const path = diagnosticPath(resolve(this.project, event.args.path));
          const matched = this.resources.loaded.find((r) => path === r.path);
          if (matched) {
            const { path: _path, ...ref } = matched;
            call.data.skillRead = { ...ref, observation: 'read_requested' };
          }
        }
        this.calls.set(event.toolCallId, call);
        trace.toolCount++;
        this.service.call(trace, call);
      }
      if (event.type === 'tool_execution_end') {
        const call = this.calls.get(event.toolCallId);
        if (!call) {
          this.service.gap(trace);
          return;
        }
        call.ended = Date.now();
        call.status = event.isError ? 'error' : 'ok';
        call.durationMs = finite(event.durationMs);
        call.outputBytes = contentBytes(event.result?.content);
        call.data.outputMeasure = 'content_text_utf8_and_image_base64_bytes';
        if (event.isError) trace.errorCount++;
        if (call.data.skillRead)
          call.data.skillRead = {
            ...(call.data.skillRead as Record<string, unknown>),
            observation: event.isError ? 'read_failed' : 'observed_read',
          };
        if (call.toolName.startsWith('memory_') && !event.isError) call.data.memory = memoryReferences(event.result);
        this.service.call(trace, call);
      }
      if (event.type === 'message_end') queueMicrotask(() => this.sync());
      if (event.type === 'turn_end') {
        this.sync();
        if (this.turn) {
          this.turn.ended = Date.now();
          this.service.turn(trace, this.turn);
          this.turn = undefined;
        }
      }
      if (event.type === 'entry_appended') this.sync();
      if (event.type === 'auto_retry_start')
        this.event('retry_start', { attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs });
      if (event.type === 'auto_retry_end') this.event('retry_end', { attempt: event.attempt, success: event.success });
      if (event.type === 'summarization_retry_scheduled')
        this.event('summarization_retry', {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
        });
      if (event.type === 'agent_settled') {
        this.settledAborted = event.aborted;
        this.event('settled', { aborted: event.aborted });
      }
      this.service.trace(this.project, trace);
    });
  }
  sync() {
    this.guard(() => {
      const trace = this.trace,
        leaf = this.manager.getLeafId();
      if (!trace || leaf === this.seenLeaf) return;
      const entries: SessionEntry[] = [];
      let entry = this.manager.getLeafEntry();
      while (entry && entry.id !== this.seenLeaf) {
        entries.push(entry);
        entry = this.manager.getEntry(entry.parentId ?? '');
      }
      if (!entry && this.seenLeaf) {
        this.service.gap(trace);
        this.seenLeaf = leaf;
        return;
      }
      this.seenLeaf = leaf;
      for (const e of entries.reverse()) {
        if (e.type !== 'message') continue;
        const m = e.message;
        if (m.role === 'user') trace.userEntryId ??= e.id;
        if (m.role === 'assistant' && this.turn) {
          this.turn.assistantEntryId = e.id;
          this.turn.model = m.model;
          this.turn.provider = m.provider;
          this.turn.stopReason = m.stopReason;
          this.turn.usage = diagnosticUsage(m.usage);
          this.turn.data.durationMs = finite(m.durationMs);
          if (m.stopReason === 'error') trace.errorCount++;
          for (const block of m.content)
            if (block.type === 'toolCall') {
              const call = this.calls.get(block.id);
              if (call) call.assistantEntryId = e.id;
            }
          this.service.turn(trace, this.turn);
        }
        if (m.role === 'toolResult') {
          const call = this.calls.get(m.toolCallId);
          if (call) {
            call.resultEntryId = e.id;
            call.data.resultAvailability = 'reference_requires_lookup';
            call.assistantEntryId ??= this.turn?.assistantEntryId ?? null;
            this.service.call(trace, call);
          }
          for (const nested of m.nestedCalls?.calls ?? []) {
            const child = this.calls.get(nested.id);
            if (child) {
              child.resultEntryId = e.id;
              child.assistantEntryId = call?.assistantEntryId ?? null;
              child.data.nestedSummaryComplete = m.nestedCalls?.complete;
              this.service.call(trace, child);
              this.calls.delete(nested.id);
            }
          }
          if (m.nestedCalls && !m.nestedCalls.complete) this.event('nested_summary_incomplete', {}, e.id);
          if (call) this.calls.delete(m.toolCallId);
        }
      }
      this.service.trace(this.project, trace);
    });
  }
  finish(status: DiagnosticTrace['status']) {
    this.guard(() => {
      this.sync();
      const trace = this.trace;
      if (!trace) return;
      if (status === 'ended' && this.settledAborted) status = 'stopped';
      trace.status = status;
      trace.ended = Date.now();
      for (const call of this.calls.values()) {
        call.status = call.status === 'running' ? 'unfinished' : call.status;
        this.service.call(trace, call);
      }
      if (this.turn) {
        this.turn.ended = trace.ended;
        this.service.turn(trace, this.turn);
      }
      this.service.flush();
      trace.endLeafId = this.manager.appendCustomEntry(traceMarker, {
        version: 1,
        phase: 'end',
        traceId: trace.id,
        at: trace.ended,
        status,
        gaps: Number(trace.data.gaps ?? 0),
      });
      this.service.trace(this.project, trace);
      this.service.flush();
    });
    this.trace = undefined;
    this.turn = undefined;
    this.calls.clear();
    this.resources = { loaded: [], tools: new Map() };
  }
}

/** Extract only typed identity/provenance fields from the native Memory result. */
function memoryReferences(result: unknown) {
  const refs: Array<{ id: string; revision: number; sources: Array<{ sessionId: string; entryId: string }> }> = [];
  try {
    const r = result as { content?: Array<{ type: string; text?: string }> };
    const text = r.content?.find((b) => b.type === 'text')?.text;
    if (!text || text.length > 4 * 1024 * 1024) return { references: refs, complete: false };
    const data = JSON.parse(text);
    const values = Array.isArray(data.items) ? data.items : data.current ? [data.current] : [data];
    let remaining = 100,
      complete = values.length <= 100;
    for (const value of values.slice(0, 100))
      if (z.string().uuid().safeParse(value.id).success && Number.isSafeInteger(value.revision)) {
        const sourceCount = Array.isArray(value.sources) ? value.sources.length : 0;
        if (sourceCount > remaining) complete = false;
        refs.push({
          id: value.id,
          revision: value.revision,
          sources: (Array.isArray(value.sources) ? value.sources : [])
            .slice(0, remaining)
            .filter(
              (s: { sessionId?: unknown; entryId?: unknown }) =>
                z.string().uuid().safeParse(s.sessionId).success &&
                typeof s.entryId === 'string' &&
                s.entryId.length <= 128,
            )
            .map((s: { sessionId: string; entryId: string }) => ({ sessionId: s.sessionId, entryId: s.entryId })),
        });
        remaining -= refs.at(-1)?.sources.length ?? 0;
      }
    return { references: refs, complete };
  } catch {
    return { references: refs, complete: false };
  }
}
