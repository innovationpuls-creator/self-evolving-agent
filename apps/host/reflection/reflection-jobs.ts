import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type ReflectionJobStatus = 'pending' | 'running' | 'waiting_user' | 'succeeded' | 'failed' | 'interrupted';
export type ReflectionSourceStatus = 'ended' | 'stopped' | 'failed';

export interface ReflectionSource {
  markerEntryId: string;
  settledAt: number;
  traceId?: string;
  status: ReflectionSourceStatus;
}

export interface ReflectionJob {
  id: string;
  sessionId: string;
  project: string;
  provider: string;
  model: string;
  scheduledAt: number;
  created: number;
  updated: number;
  runId: string | null;
  reflectionSessionId?: string;
  status: ReflectionJobStatus;
  error?: string;
  sources: ReflectionSource[];
}

export interface ReflectionRegistration extends ReflectionSource {
  sessionId: string;
  project: string;
  provider: string;
  model: string;
  /** Native Pi branch entries, including this settled marker. */
  ancestorIds: string[];
}

interface ReflectionJobsOptions {
  now?: () => number;
  delayMs?: number;
}

/** Durable task facts only. The Host owns timers, foreground priority and execution. */
export class ReflectionJobs {
  private now: () => number;
  private delayMs: number;

  constructor(
    private db: DatabaseSync,
    private changed: () => void,
    options: ReflectionJobsOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.delayMs = options.delayMs ?? 30_000;
    if (!Number.isFinite(this.delayMs) || this.delayMs < 0) throw new Error('Reflection delay must be nonnegative');
  }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private notify() {
    try {
      this.changed();
    } catch {
      // A failed invalidation notification cannot roll back committed task facts.
    }
  }

  init(): number {
    this.db.exec('PRAGMA foreign_keys=ON');
    const recovered = this.transaction(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS product_migrations (name TEXT PRIMARY KEY, version INTEGER NOT NULL)');
      const version = this.db.prepare('SELECT version FROM product_migrations WHERE name=?').get('reflection_jobs');
      if (version && Number(version.version) !== 1) throw new Error('Unsupported Reflection jobs schema');
      if (!version)
        this.db.exec(`
          CREATE TABLE reflection_jobs (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, project TEXT NOT NULL,
            provider TEXT NOT NULL, model TEXT NOT NULL,
            scheduled_at INTEGER NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
            run_id TEXT, reflection_session_id TEXT,
            status TEXT NOT NULL CHECK(status IN ('pending','running','waiting_user','succeeded','failed','interrupted')),
            last_marker_entry_id TEXT NOT NULL, error TEXT
          ) STRICT;
          CREATE INDEX reflection_job_due ON reflection_jobs(status,scheduled_at,created);
          CREATE INDEX reflection_job_session ON reflection_jobs(session_id,status);
          CREATE TABLE reflection_job_sources (
            seq INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES reflection_jobs(id),
            session_id TEXT NOT NULL, marker_entry_id TEXT NOT NULL,
            settled_at INTEGER NOT NULL, trace_id TEXT,
            status TEXT NOT NULL CHECK(status IN ('ended','stopped','failed')),
            UNIQUE(session_id,marker_entry_id)
          ) STRICT;
          CREATE INDEX reflection_job_source_owner ON reflection_job_sources(job_id,seq);
          INSERT INTO product_migrations VALUES('reflection_jobs',1);
        `);
      this.db.exec(`CREATE INDEX IF NOT EXISTS reflection_job_catalog ON reflection_jobs(created DESC,id DESC);
        CREATE INDEX IF NOT EXISTS reflection_job_session_catalog ON reflection_jobs(session_id,created DESC,id DESC);`);
      return Number(
        this.db
          .prepare("UPDATE reflection_jobs SET status='interrupted',updated=?,error=? WHERE status='running'")
          .run(this.now(), 'Host restarted during Reflection; committed effects are not replayed').changes,
      );
    });
    if (recovered) this.notify();
    return recovered;
  }

  register(input: ReflectionRegistration): ReflectionJob {
    if (!Number.isSafeInteger(input.settledAt) || input.settledAt < 0)
      throw new Error('Reflection settledAt must be a nonnegative timestamp');
    let inserted = false;
    const job = this.transaction(() => {
      const duplicate = this.db
        .prepare('SELECT job_id FROM reflection_job_sources WHERE session_id=? AND marker_entry_id=?')
        .get(input.sessionId, input.markerEntryId);
      if (duplicate) return this.required(String(duplicate.job_id));

      const ancestors = new Set(input.ancestorIds);
      const pending = this.db
        .prepare(
          "SELECT id,last_marker_entry_id,status FROM reflection_jobs WHERE session_id=? AND status IN ('pending','waiting_user') ORDER BY created DESC,id",
        )
        .all(input.sessionId)
        .find((row) => ancestors.has(String(row.last_marker_entry_id)));
      const id = pending ? String(pending.id) : randomUUID();
      const now = this.now();
      if (pending)
        this.db
          .prepare(
            'UPDATE reflection_jobs SET project=?,provider=?,model=?,scheduled_at=?,updated=?,last_marker_entry_id=? WHERE id=?',
          )
          .run(
            input.project,
            input.provider,
            input.model,
            input.settledAt + this.delayMs,
            now,
            input.markerEntryId,
            id,
          );
      else
        this.db
          .prepare(
            "INSERT INTO reflection_jobs(id,session_id,project,provider,model,scheduled_at,created,updated,status,last_marker_entry_id) VALUES(?,?,?,?,?,?,?,?,'pending',?)",
          )
          .run(
            id,
            input.sessionId,
            input.project,
            input.provider,
            input.model,
            input.settledAt + this.delayMs,
            now,
            now,
            input.markerEntryId,
          );
      this.db
        .prepare(
          'INSERT INTO reflection_job_sources(job_id,session_id,marker_entry_id,settled_at,trace_id,status) VALUES(?,?,?,?,?,?)',
        )
        .run(id, input.sessionId, input.markerEntryId, input.settledAt, input.traceId ?? null, input.status);
      inserted = true;
      return this.required(id);
    });
    if (inserted) this.notify();
    return job;
  }

  get(id: string): ReflectionJob | undefined {
    const row = this.db.prepare('SELECT * FROM reflection_jobs WHERE id=?').get(id);
    if (!row) return undefined;
    const sources = this.db
      .prepare(
        'SELECT marker_entry_id,settled_at,trace_id,status FROM reflection_job_sources WHERE job_id=? ORDER BY seq',
      )
      .all(id)
      .map(
        (source): ReflectionSource => ({
          markerEntryId: String(source.marker_entry_id),
          settledAt: Number(source.settled_at),
          ...(source.trace_id === null ? {} : { traceId: String(source.trace_id) }),
          status: source.status as ReflectionSourceStatus,
        }),
      );
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      project: String(row.project),
      provider: String(row.provider),
      model: String(row.model),
      scheduledAt: Number(row.scheduled_at),
      created: Number(row.created),
      updated: Number(row.updated),
      runId: row.run_id === null ? null : String(row.run_id),
      ...(row.reflection_session_id === null ? {} : { reflectionSessionId: String(row.reflection_session_id) }),
      status: row.status as ReflectionJobStatus,
      ...(row.error === null ? {} : { error: String(row.error) }),
      sources,
    };
  }

  private required(id: string): ReflectionJob {
    const job = this.get(id);
    if (!job) throw new Error('Reflection job source references a missing task');
    return job;
  }

  list(filter: { sessionId?: string; status?: ReflectionJobStatus } = {}): ReflectionJob[] {
    return this.db
      .prepare(
        'SELECT id FROM reflection_jobs WHERE (? IS NULL OR session_id=?) AND (? IS NULL OR status=?) ORDER BY created,id',
      )
      .all(filter.sessionId ?? null, filter.sessionId ?? null, filter.status ?? null, filter.status ?? null)
      .map((row) => this.required(String(row.id)));
  }

  hasDue() {
    return !!this.db
      .prepare("SELECT 1 FROM reflection_jobs WHERE status='pending' AND scheduled_at<=? LIMIT 1")
      .get(this.now());
  }

  nextScheduledAt() {
    const row = this.db.prepare("SELECT MIN(scheduled_at) AS due FROM reflection_jobs WHERE status='pending'").get();
    return row?.due === null || row?.due === undefined ? undefined : Number(row.due);
  }

  expedite(sessionId: string): number {
    const now = this.now();
    const changed = Number(
      this.db
        .prepare(
          "UPDATE reflection_jobs SET scheduled_at=?,updated=? WHERE session_id=? AND status IN ('pending','waiting_user') AND scheduled_at>?",
        )
        .run(now, now, sessionId, now).changes,
    );
    if (changed) this.notify();
    return changed;
  }

  /** Claims at most one task; canRun must be synchronous and must not mutate the database. */
  pendingClaim(canRun: (sessionId: string) => boolean): ReflectionJob | undefined {
    const claimed = this.transaction(() => {
      if (this.db.prepare("SELECT id FROM reflection_jobs WHERE status='running' LIMIT 1").get()) return undefined;
      const now = this.now();
      const due = this.db
        .prepare(
          "SELECT id,session_id FROM reflection_jobs WHERE status='pending' AND scheduled_at<=? ORDER BY scheduled_at,created,id",
        )
        .all(now)
        .find((row) => canRun(String(row.session_id)));
      if (!due) return undefined;
      const id = String(due.id);
      const changed = this.db
        .prepare(
          "UPDATE reflection_jobs SET status='running',run_id=?,reflection_session_id=?,updated=?,error=NULL WHERE id=? AND status='pending'",
        )
        .run(randomUUID(), randomUUID(), now, id).changes;
      return changed === 1 ? this.required(id) : undefined;
    });
    if (claimed) this.notify();
    return claimed;
  }

  finish(
    id: string,
    runId: string,
    status: 'succeeded' | 'failed' | 'interrupted' | 'waiting_user',
    error?: string,
  ): boolean {
    const changed =
      this.db
        .prepare("UPDATE reflection_jobs SET status=?,error=?,updated=? WHERE id=? AND run_id=? AND status='running'")
        .run(status, error ?? null, this.now(), id, runId).changes === 1;
    if (changed) this.notify();
    return changed;
  }

  setUnavailable(error: string): number {
    const changed = Number(
      this.db
        .prepare("UPDATE reflection_jobs SET status='waiting_user',error=?,updated=? WHERE status='pending'")
        .run(error, this.now()).changes,
    );
    if (changed) this.notify();
    return changed;
  }

  recheck(): number {
    const changed = Number(
      this.db
        .prepare("UPDATE reflection_jobs SET status='pending',error=NULL,updated=? WHERE status='waiting_user'")
        .run(this.now()).changes,
    );
    if (changed) this.notify();
    return changed;
  }
}
