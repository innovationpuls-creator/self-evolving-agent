import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export const DEBOUNCE_MS = 30_000;

export function openTaskStore(databasePath) {
	const db = new Database(databasePath, { timeout: 5_000 });
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = FULL");
	db.pragma("foreign_keys = ON");
	db.exec(`
		CREATE TABLE IF NOT EXISTS background_tasks (
			id TEXT PRIMARY KEY,
			kind TEXT NOT NULL,
			scope_key TEXT NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'interrupted')),
			payload_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			last_trigger_at INTEGER NOT NULL,
			scheduled_at INTEGER NOT NULL,
			trigger_count INTEGER NOT NULL DEFAULT 1,
			attempts INTEGER NOT NULL DEFAULT 0,
			started_at INTEGER,
			finished_at INTEGER,
			background_session_id TEXT,
			result_json TEXT,
			last_error TEXT
		) STRICT;
		CREATE UNIQUE INDEX IF NOT EXISTS background_tasks_one_pending_scope
			ON background_tasks(scope_key) WHERE status = 'pending';
		CREATE INDEX IF NOT EXISTS background_tasks_due
			ON background_tasks(status, scheduled_at);
	`);

	const findPending = db.prepare(`
		SELECT * FROM background_tasks
		WHERE scope_key = ? AND status = 'pending'
		LIMIT 1
	`);
	const insert = db.prepare(`
		INSERT INTO background_tasks (
			id, kind, scope_key, status, payload_json, created_at, updated_at,
			last_trigger_at, scheduled_at
		) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
	`);
	const updatePending = db.prepare(`
		UPDATE background_tasks
		SET kind = ?, payload_json = ?, updated_at = ?, last_trigger_at = ?,
			scheduled_at = ?, trigger_count = trigger_count + 1
		WHERE id = ? AND status = 'pending'
	`);
	const scheduleTransaction = db.transaction((input) => {
		const existing = findPending.get(input.scopeKey);
		const scheduledAt = input.now + input.delayMs;
		if (existing) {
			updatePending.run(
				input.kind,
				JSON.stringify(input.payload),
				input.now,
				input.now,
				scheduledAt,
				existing.id,
			);
			return { task: getTask(existing.id), disposition: "debounced" };
		}

		const id = randomUUID();
		insert.run(
			id,
			input.kind,
			input.scopeKey,
			JSON.stringify(input.payload),
			input.now,
			input.now,
			input.now,
			scheduledAt,
		);
		return { task: getTask(id), disposition: "inserted" };
	});

	function getTask(id) {
		const row = db.prepare("SELECT * FROM background_tasks WHERE id = ?").get(id);
		return row ? decodeTask(row) : undefined;
	}

	function decodeTask(row) {
		return { ...row, payload: JSON.parse(row.payload_json), result: row.result_json ? JSON.parse(row.result_json) : null };
	}

	function schedule(input) {
		return scheduleTransaction.immediate(input);
	}

	const claimTransaction = db.transaction((now) => {
		const row = db.prepare(`
			SELECT * FROM background_tasks
			WHERE status = 'pending' AND scheduled_at <= ?
			ORDER BY scheduled_at, created_at
			LIMIT 1
		`).get(now);
		if (!row) return null;

		const claimed = db.prepare(`
			UPDATE background_tasks
			SET status = 'running', attempts = attempts + 1, started_at = ?, updated_at = ?
			WHERE id = ? AND status = 'pending'
		`).run(now, now, row.id);
		if (claimed.changes !== 1) return null;
		return decodeTask(db.prepare("SELECT * FROM background_tasks WHERE id = ?").get(row.id));
	});

	function claimDue(now = Date.now()) {
		return claimTransaction.immediate(now);
	}

	const markInterrupted = db.prepare(`
		UPDATE background_tasks
		SET status = 'interrupted', updated_at = ?, finished_at = ?,
			last_error = 'Host restarted while the task was running; side-effect outcome is unknown'
		WHERE status = 'running'
	`);

	function recoverRunning(now = Date.now()) {
		return markInterrupted.run(now, now).changes;
	}

	const markSucceeded = db.prepare(`
		UPDATE background_tasks
		SET status = 'succeeded', updated_at = ?, finished_at = ?,
			background_session_id = ?, result_json = ?, last_error = NULL
		WHERE id = ? AND status = 'running'
	`);

	function finishSuccess(id, result, backgroundSessionId, now = Date.now()) {
		const changed = markSucceeded.run(now, now, backgroundSessionId, JSON.stringify(result), id).changes;
		if (changed !== 1) throw new Error(`Task ${id} is no longer running`);
	}

	const markFailed = db.prepare(`
		UPDATE background_tasks
		SET status = 'failed', updated_at = ?, finished_at = ?, last_error = ?
		WHERE id = ? AND status = 'running'
	`);

	function finishFailure(id, error, now = Date.now()) {
		markFailed.run(now, now, String(error), id);
	}

	function nextScheduledAt() {
		return db.prepare("SELECT MIN(scheduled_at) AS scheduled_at FROM background_tasks WHERE status = 'pending'").get().scheduled_at ?? null;
	}

	function listTasks() {
		return db.prepare("SELECT * FROM background_tasks ORDER BY created_at, id").all().map(decodeTask);
	}

	function close() {
		db.close();
	}

	return {
		db,
		schedule,
		claimDue,
		recoverRunning,
		finishSuccess,
		finishFailure,
		getTask,
		listTasks,
		nextScheduledAt,
		close,
	};
}
