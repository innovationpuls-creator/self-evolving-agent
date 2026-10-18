import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { setTimeout as sleep } from "node:timers/promises";
import { DEBOUNCE_MS, openTaskStore } from "./store.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runRoot = await mkdtemp(path.join(tmpdir(), "td08-pi-background-"));
const databasePath = path.join(runRoot, "tasks.sqlite");
const dataRoot = path.join(runRoot, "host-data");
const effectsPath = path.join(dataRoot, "external-effects.jsonl");
const liveHosts = [];

function parseRow(row) {
	if (!row) return null;
	return {
		...row,
		payload: JSON.parse(row.payload_json),
		result: row.result_json ? JSON.parse(row.result_json) : null,
	};
}

function readDatabase(callback) {
	const database = new Database(databasePath, { readonly: true, timeout: 5_000 });
	try {
		return callback(database);
	} finally {
		database.close();
	}
}

function readTasks() {
	return readDatabase((database) => database.prepare("SELECT * FROM background_tasks ORDER BY created_at, id").all().map(parseRow));
}

function readTask(taskId) {
	return readDatabase((database) => parseRow(database.prepare("SELECT * FROM background_tasks WHERE id = ?").get(taskId)));
}

async function readEffects() {
	try {
		return (await readFile(effectsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
}

function startHost() {
	const child = spawn(process.execPath, ["src/host.mjs"], {
		cwd: packageRoot,
		env: {
			...process.env,
			TD08_DB_PATH: databasePath,
			TD08_DATA_ROOT: dataRoot,
			TD08_PORT: "0",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	const host = { child, events: [], stderr: "", ready: null };
	let resolveReady;
	let rejectReady;
	host.ready = new Promise((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const lines = createInterface({ input: child.stdout });
	lines.on("line", (line) => {
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			host.events.push({ event: "unparsed-output", line });
			return;
		}
		host.events.push(event);
		if (event.event === "host-ready") resolveReady({ ...event, origin: `http://127.0.0.1:${event.port}` });
	});
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => { host.stderr += chunk; });
	host.exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
	child.once("error", rejectReady);
	child.once("exit", (code, signal) => {
		if (!host.readyInfo) rejectReady(new Error(`Pi Host exited before ready (${code}, ${signal}): ${host.stderr}`));
	});
	const originalThen = host.ready.then.bind(host.ready);
	host.ready = originalThen((info) => {
		host.readyInfo = info;
		return info;
	});
	liveHosts.push(host);
	return host;
}

async function waitReady(host) {
	return withTimeout(host.ready, 20_000, `Pi Host startup: ${host.stderr}`);
}

function withTimeout(promise, timeoutMs, description) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), timeoutMs);
		promise.then(
			(value) => { clearTimeout(timer); resolve(value); },
			(error) => { clearTimeout(timer); reject(error); },
		);
	});
}

async function killHost(host) {
	if (host.child.exitCode !== null || host.child.signalCode !== null) return await host.exit;
	host.child.kill("SIGKILL");
	const result = await withTimeout(host.exit, 10_000, `Host ${host.child.pid} exit after SIGKILL`);
	assert.equal(result.signal, "SIGKILL");
	return result;
}

async function runClient(origin, prompts) {
	const child = spawn(process.execPath, ["src/client.mjs", origin, ...prompts], {
		cwd: packageRoot,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	const exit = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
	assert.equal(exit.code, 0, `Client failed (${exit.signal}): ${stderr}`);
	return { exit, stdout: stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
}

async function getJson(origin, pathname, init) {
	const response = await fetch(`${origin}${pathname}`, init);
	const body = await response.json();
	assert.equal(response.ok, true, `${response.status}: ${body.error ?? "request failed"}`);
	return body;
}

async function waitFor(predicate, timeoutMs, description) {
	const stopAt = Date.now() + timeoutMs;
	while (Date.now() < stopAt) {
		const value = await predicate();
		if (value) return value;
		await sleep(100);
	}
	throw new Error(`Timed out waiting for ${description}`);
}

function verifyTriggerWhileRunning() {
	const store = openTaskStore(path.join(runRoot, "inflight-dedupe.sqlite"));
	try {
		const scopeKey = "reflection:inflight-dedupe-probe";
		const now = Date.now();
		const initial = store.schedule({
			kind: "reflection",
			scopeKey,
			payload: { generation: 1 },
			now,
			delayMs: 0,
		});
		const claimed = store.claimDue(now);
		assert.equal(claimed.id, initial.task.id);
		assert.equal(claimed.status, "running");

		const firstFollowup = store.schedule({
			kind: "reflection",
			scopeKey,
			payload: { generation: 2 },
			now: now + 1,
			delayMs: DEBOUNCE_MS,
		});
		const coalescedFollowup = store.schedule({
			kind: "reflection",
			scopeKey,
			payload: { generation: 3 },
			now: now + 2,
			delayMs: DEBOUNCE_MS,
		});
		assert.equal(firstFollowup.disposition, "inserted");
		assert.equal(coalescedFollowup.disposition, "debounced");
		assert.notEqual(coalescedFollowup.task.id, initial.task.id);
		assert.equal(coalescedFollowup.task.trigger_count, 2);
		assert.equal(coalescedFollowup.task.payload.generation, 3);
		assert.equal(coalescedFollowup.task.scheduled_at, now + 2 + DEBOUNCE_MS);
		assert.equal(store.listTasks().length, 2);
		assert.equal(store.recoverRunning(now + 3), 1);
		assert.equal(store.getTask(initial.task.id).status, "interrupted");
		assert.equal(store.getTask(coalescedFollowup.task.id).status, "pending");
		return true;
	} finally {
		store.close();
	}
}

async function run() {
	const checks = { settlementDuringRunningQueuesFollowup: verifyTriggerWhileRunning() };
	const packageVersion = async (name) => JSON.parse(await readFile(path.join(packageRoot, "node_modules", name, "package.json"), "utf8")).version;

	const hostBeforeRestart = startHost();
	const readyBeforeRestart = await waitReady(hostBeforeRestart);
	const firstClient = await runClient(readyBeforeRestart.origin, [
		"normal-before-restart-one",
		"normal-before-restart-two",
	]);
	assert.equal(firstClient.stdout.length, 2);
	const firstHealth = await getJson(readyBeforeRestart.origin, "/health");
	assert.equal(firstHealth.pid, readyBeforeRestart.pid, "Client exit must not stop the Host");
	const firstTask = readTasks()[0];
	assert.ok(firstTask, "agent_settled must register a durable task");
	assert.equal(firstTask.status, "pending");
	assert.equal(firstTask.trigger_count, 2, "Same-project settlements must deduplicate");
	assert.equal(firstTask.scheduled_at - firstTask.last_trigger_at, DEBOUNCE_MS);
	assert.ok(Date.now() < firstTask.scheduled_at, "The first Host must still hold the task pending before debounce expires");
	const initialTaskSourceSessionId = firstTask.payload.sourceSessionId;
	const initialScheduledAt = firstTask.scheduled_at;
	checks.agentSettledRegisteredTask = true;
	checks.sqliteSavedTaskAndScheduledAt = true;
	checks.thirtySecondDebounceAndDeduplication = true;
	checks.clientExitLeftHostAlive = true;

	const pendingKill = await killHost(hostBeforeRestart);
	assert.equal(pendingKill.signal, "SIGKILL");
	const hostAfterRestart = startHost();
	const readyAfterRestart = await waitReady(hostAfterRestart);
	let restoredTask = readTask(firstTask.id);
	assert.equal(restoredTask.status, "pending", "Restart must preserve a due-later task");
	assert.equal(restoredTask.scheduled_at, initialScheduledAt, "Restart must preserve the persisted due time");
	assert.ok(Date.now() < restoredTask.scheduled_at, "Restart must restore the still-future due time");
	assert.equal(readyAfterRestart.recoveredInterruptedTasks, 0);

	const postRestartClient = await runClient(readyAfterRestart.origin, ["normal-after-restart-marker"]);
	assert.equal(postRestartClient.exit.code, 0);
	const healthAfterClientExit = await getJson(readyAfterRestart.origin, "/health");
	assert.equal(healthAfterClientExit.pid, readyAfterRestart.pid);
	assert.equal(healthAfterClientExit.tasks.length, 1);
	const latestTask = readTask(firstTask.id);
	assert.equal(latestTask.status, "pending");
	assert.equal(latestTask.trigger_count, 3);
	assert.equal(latestTask.payload.sourceSessionId, healthAfterClientExit.normalSessionId);
	assert.notEqual(latestTask.payload.sourceSessionId, initialTaskSourceSessionId, "Restarted normal Session must have a new identity");
	assert.equal(latestTask.scheduled_at - latestTask.last_trigger_at, DEBOUNCE_MS);
	checks.restartRecoveredPendingTask = true;
	checks.debounceUpdatedFromPostRestartSettlement = true;
	checks.clientExitAfterRestartLeftHostAlive = true;

	const preDueSnapshot = readTask(firstTask.id);
	assert.ok(Date.now() < preDueSnapshot.scheduled_at, "The experiment should observe the 30-second wait before due time");
	await sleep(1_000);
	assert.equal(readTask(firstTask.id).status, "pending", "Task must not run before its scheduled time");
	const completed = await waitFor(() => {
		const task = readTask(firstTask.id);
		return task?.status === "succeeded" ? task : null;
	}, Math.max(15_000, preDueSnapshot.scheduled_at - Date.now() + 15_000), "debounced background task to complete");
	assert.ok(completed.started_at >= completed.scheduled_at, "The worker must not claim before scheduled_at");
	const isolated = completed.result;
	assert.equal(isolated.sessionManagersAreDistinct, true);
	assert.equal(isolated.sessionIdsAreDistinct, true);
	assert.equal(isolated.backgroundSettledCount, 1);
	assert.equal(isolated.backgroundContainsNoNormalPrompt, true);
	assert.equal(isolated.normalContainsNoBackgroundPrompt, true);
	assert.equal(isolated.taskCountAfterBackgroundSettle, isolated.taskCountBeforeBackgroundSettle);
	checks.scheduledTaskExecutedAfterDueTime = true;
	checks.independentPiSessionAndManager = true;
	checks.normalAndBackgroundHistoryIsolated = true;
	checks.reflectionSettlementDidNotRequeue = true;

	const interruptResponse = await getJson(readyAfterRestart.origin, "/test/interrupt", { method: "POST" });
	const interruptedId = interruptResponse.taskId;
	const runningTask = await waitFor(async () => {
		const task = readTask(interruptedId);
		const effects = await readEffects();
		return task?.status === "running" && task.attempts === 1 && effects.some((effect) => effect.effectId === interruptedId)
			? { task, effects }
			: null;
	}, 15_000, "running task after its durable simulated side effect");
	assert.equal(runningTask.effects.filter((effect) => effect.effectId === interruptedId).length, 1);
	const runningKill = await killHost(hostAfterRestart);
	assert.equal(runningKill.signal, "SIGKILL");

	const hostAfterInterruptedRestart = startHost();
	const readyAfterInterruptedRestart = await waitReady(hostAfterInterruptedRestart);
	let interruptedTask = readTask(interruptedId);
	assert.equal(readyAfterInterruptedRestart.recoveredInterruptedTasks, 1);
	assert.equal(interruptedTask.status, "interrupted");
	assert.equal(interruptedTask.attempts, 1);
	await sleep(1_000);
	interruptedTask = readTask(interruptedId);
	const durableEffects = await readEffects();
	assert.equal(interruptedTask.status, "interrupted", "Startup must not blindly replay an uncertain task");
	assert.equal(interruptedTask.attempts, 1);
	assert.equal(durableEffects.filter((effect) => effect.effectId === interruptedId).length, 1);
	checks.sigkillDuringPendingTaskRecovered = pendingKill.signal === "SIGKILL";
	checks.sigkillAfterSideEffectMarkedInterrupted = runningKill.signal === "SIGKILL" && interruptedTask.status === "interrupted";
	checks.interruptedExternalEffectWasNotReplayed = durableEffects.filter((effect) => effect.effectId === interruptedId).length === 1;
	checks.sqliteIntegrityAfterForcedStops = readDatabase((database) => database.pragma("integrity_check")[0].integrity_check) === "ok";

	const sqliteVersion = readDatabase((database) => database.prepare("SELECT sqlite_version() AS version").get().version);
	const report = {
		outcome: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
		environment: {
			platform: process.platform,
			arch: process.arch,
		node: process.versions.node,
			piCodingAgent: await packageVersion("@earendil-works/pi-coding-agent"),
			piAi: await packageVersion("@earendil-works/pi-ai"),
			betterSqlite3: await packageVersion("better-sqlite3"),
			sqlite: sqliteVersion,
			provider: "Pi Faux Provider; allowModelNetwork=false",
		},
		testSignals: { pendingHost: pendingKill.signal, inFlightHost: runningKill.signal },
		task: {
			id: completed.id,
			triggerCount: completed.trigger_count,
			debounceMs: DEBOUNCE_MS,
			scheduledAt: completed.scheduled_at,
			startedAt: completed.started_at,
			startLatenessMs: completed.started_at - completed.scheduled_at,
			firstSourceSessionId: initialTaskSourceSessionId,
			recoveredSourceSessionId: completed.payload.sourceSessionId,
		},
		interruptedTask: {
			id: interruptedTask.id,
			status: interruptedTask.status,
			attempts: interruptedTask.attempts,
			externalEffectCountAfterRestart: durableEffects.filter((effect) => effect.effectId === interruptedId).length,
		},
		checks,
	};
	assert.equal(report.outcome, "PASS", JSON.stringify(report, null, 2));
	await mkdir(path.join(packageRoot, "results"), { recursive: true });
	await writeFile(path.join(packageRoot, "results", "last-run.json"), `${JSON.stringify(report, null, 2)}\n`);
	return report;
}

try {
	const report = await run();
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
	for (const host of liveHosts) {
		if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill("SIGKILL");
	}
	await Promise.all(liveHosts.map((host) => host.exit));
	await rm(runRoot, { recursive: true, force: true });
}
