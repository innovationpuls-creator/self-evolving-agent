import { mkdir, open } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Type, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { DEBOUNCE_MS, openTaskStore } from "./store.mjs";

const databasePath = path.resolve(process.env.TD08_DB_PATH ?? ".tmp/tasks.sqlite");
const dataRoot = path.resolve(process.env.TD08_DATA_ROOT ?? path.dirname(databasePath));
const workspace = path.join(dataRoot, "workspace");
const agentDir = path.join(dataRoot, "pi-agent");
const effectLedgerPath = path.join(dataRoot, "external-effects.jsonl");
await mkdir(workspace, { recursive: true });
await mkdir(agentDir, { recursive: true });

const taskStore = openTaskStore(databasePath);
const recoveredAtStartup = taskStore.recoverRunning();
const hostId = randomUUID();
const normalMarkers = [];
let normalBusy = false;
let schedulerTimer;
let schedulerPumping = false;
let stopping = false;
let normalSession;
let normalSettledCount = 0;

function logEvent(event, data = {}) {
	process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

function sendJson(response, statusCode, value) {
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(value));
}

async function readJson(request) {
	let size = 0;
	const chunks = [];
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 8_192) throw new Error("Request body exceeds 8192 bytes");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function createPiSession({ role, sessionId, onAgentSettled, action }) {
	const faux = fauxProvider({ provider: `td08-${role}`, api: "faux" });
	const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
	modelRuntime.registerNativeProvider(faux.provider);

	const extensionFactories = onAgentSettled
		? [{
			name: "td08-settled-task-trigger",
			factory(pi) {
				pi.on("agent_settled", (event, context) => {
					onAgentSettled({
						aborted: event.aborted,
						cwd: context.cwd,
						sourceSessionId: context.sessionManager.getSessionId(),
						sourceEntryId: context.sessionManager.getLeafId(),
					});
				});
			},
		}]
		: [];
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir,
		extensionFactories,
		noExtensions: !onAgentSettled,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: "You are a deterministic TD-08 experiment agent. Follow the user request and any scripted Faux tool call.",
	});
	await resourceLoader.reload();

	const sessionManager = SessionManager.inMemory(workspace, { id: sessionId });
	const customTools = action === "interrupt-probe" ? [defineTool({
		name: "simulate_external_effect",
		label: "Simulate external side effect",
		description: "Durably record a simulated external effect, then block until the Host is killed.",
		parameters: Type.Object({ effectId: Type.String() }),
		async execute(_toolCallId, params) {
			const file = await open(effectLedgerPath, "a", 0o600);
			try {
				await file.write(`${JSON.stringify({ taskId: sessionId, effectId: params.effectId, at: Date.now() })}\n`);
				await file.sync();
			} finally {
				await file.close();
			}
			logEvent("external-effect-recorded", { taskId: sessionId, effectId: params.effectId });
			return new Promise(() => {});
		},
	})] : [];

	const { session, extensionsResult } = await createAgentSession({
		cwd: workspace,
		agentDir: role === "background" ? path.join(agentDir, "background") : agentDir,
		model: faux.getModel(),
		modelRuntime,
		resourceLoader,
		settingsManager: SettingsManager.create(workspace, role === "background" ? path.join(agentDir, "background") : agentDir),
		sessionManager,
		customTools,
		tools: customTools.length ? ["simulate_external_effect"] : [],
	});
	return { session, sessionManager, faux, modelRuntime, extensionsResult };
}

function wakeScheduler() {
	if (schedulerTimer) clearTimeout(schedulerTimer);
	schedulerTimer = undefined;
	void pumpScheduler();
}

async function executeBackgroundTask(task) {
	const beforeCount = taskStore.listTasks().length;
	const backgroundSessionId = `background-${task.id}`;
	const background = await createPiSession({
		role: "background",
		sessionId: backgroundSessionId,
		action: task.payload.action,
	});
	let backgroundSettledCount = 0;
	background.session.subscribe((event) => {
		if (event.type === "agent_settled") backgroundSettledCount += 1;
	});

	const backgroundMarker = `background-only:${task.id}`;
	const prompt = [
		backgroundMarker,
		`Run ${task.kind} for ${task.payload.scopeKey}.`,
		`Source session ${task.payload.sourceSessionId ?? "n/a"}; source entry ${task.payload.sourceEntryId ?? "n/a"}.`,
	].join("\n");
	background.faux.setResponses(task.payload.action === "interrupt-probe"
		? [fauxAssistantMessage([
			fauxToolCall("simulate_external_effect", { effectId: task.id }),
		], { stopReason: "toolUse" })]
		: [fauxAssistantMessage(`completed:${backgroundMarker}`)]);
	await background.session.prompt(prompt);

	const normalEntriesText = JSON.stringify(normalSession.sessionManager.getEntries());
	const backgroundEntriesText = JSON.stringify(background.sessionManager.getEntries());
	const result = {
		backgroundSettledCount,
		backgroundMarker,
		backgroundContainsNoNormalPrompt: normalMarkers.every((marker) => !backgroundEntriesText.includes(marker)),
		normalContainsNoBackgroundPrompt: !normalEntriesText.includes(backgroundMarker),
		sessionManagersAreDistinct: normalSession.sessionManager !== background.sessionManager,
		sessionIdsAreDistinct: normalSession.sessionManager.getSessionId() !== background.sessionManager.getSessionId(),
		normalSessionId: normalSession.sessionManager.getSessionId(),
		backgroundSessionId: background.sessionManager.getSessionId(),
		taskCountBeforeBackgroundSettle: beforeCount,
		taskCountAfterBackgroundSettle: taskStore.listTasks().length,
		assistantText: background.session.getLastAssistantText(),
	};
	taskStore.finishSuccess(task.id, result, result.backgroundSessionId);
	logEvent("task-succeeded", { taskId: task.id, ...result });
	background.session.dispose();
}

async function pumpScheduler() {
	if (schedulerPumping || stopping) return;
	schedulerPumping = true;
	try {
		while (!stopping) {
			const task = taskStore.claimDue(Date.now());
			if (!task) break;
			logEvent("task-claimed", { taskId: task.id, attempt: task.attempts, scheduledAt: task.scheduled_at });
			try {
				await executeBackgroundTask(task);
			} catch (error) {
				taskStore.finishFailure(task.id, error instanceof Error ? error.message : String(error));
				logEvent("task-failed", { taskId: task.id, error: String(error) });
			}
		}
	} finally {
		schedulerPumping = false;
		const nextAt = taskStore.nextScheduledAt();
		if (!stopping && nextAt !== null) {
			schedulerTimer = setTimeout(() => {
				schedulerTimer = undefined;
				void pumpScheduler();
			}, Math.max(0, nextAt - Date.now()));
		}
	}
}

async function startHttpServer() {
	const server = createServer((request, response) => {
		void (async () => {
			if (request.method === "GET" && request.url === "/health") {
				sendJson(response, 200, {
					hostId,
					pid: process.pid,
					normalSessionId: normalSession.sessionManager.getSessionId(),
					normalSettledCount,
					tasks: taskStore.listTasks().map(({ id, status, scheduled_at, trigger_count, attempts }) => ({ id, status, scheduled_at, trigger_count, attempts })),
				});
				return;
			}

			if (request.method === "POST" && request.url === "/settle") {
				if (normalBusy) {
					sendJson(response, 409, { error: "Normal Pi Session is busy" });
					return;
				}
				const body = await readJson(request);
				if (typeof body.prompt !== "string" || body.prompt.length < 1 || body.prompt.length > 1_000) {
					sendJson(response, 400, { error: "prompt must be a 1-1000 character string" });
					return;
				}
				normalBusy = true;
				normalMarkers.push(body.prompt);
				normalSession.faux.setResponses([fauxAssistantMessage(`accepted:${body.prompt}`)]);
				try {
					await normalSession.session.prompt(body.prompt);
					sendJson(response, 200, {
						settled: true,
						pid: process.pid,
					sessionId: normalSession.sessionManager.getSessionId(),
						leafId: normalSession.sessionManager.getLeafId(),
					});
				} finally {
					normalBusy = false;
				}
				return;
			}

			if (request.method === "POST" && request.url === "/test/interrupt") {
				const now = Date.now();
				const queued = taskStore.schedule({
					kind: "interrupt-probe",
					scopeKey: `interrupt-probe:${randomUUID()}`,
					payload: { action: "interrupt-probe", scopeKey: "test/interruption" },
					now,
				delayMs: 0,
			});
				wakeScheduler();
				sendJson(response, 200, { taskId: queued.task.id, scheduledAt: queued.task.scheduled_at });
				return;
			}

			sendJson(response, 404, { error: "Not found" });
		})().catch((error) => {
			if (!response.headersSent) sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
			else response.destroy(error);
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(Number(process.env.TD08_PORT ?? 0), "127.0.0.1", resolve);
	});
	return server;
}

const trigger = ({ aborted, cwd, sourceSessionId, sourceEntryId }) => {
	const now = Date.now();
	const queued = taskStore.schedule({
		kind: "reflection",
		scopeKey: `reflection:${path.resolve(cwd)}`,
		payload: {
			scopeKey: `reflection:${path.resolve(cwd)}`,
			sourceSessionId,
			sourceEntryId,
			aborted,
		},
		now,
		delayMs: DEBOUNCE_MS,
	});
	logEvent("agent-settled-task-registered", {
		disposition: queued.disposition,
		taskId: queued.task.id,
		sourceSessionId,
		sourceEntryId,
		scheduledAt: queued.task.scheduled_at,
	});
	wakeScheduler();
};

normalSession = await createPiSession({ role: "normal", sessionId: `normal-${randomUUID()}`, onAgentSettled: trigger });
normalSession.session.subscribe((event) => {
	if (event.type === "agent_settled") normalSettledCount += 1;
});
const server = await startHttpServer();
const address = server.address();
logEvent("host-ready", {
	hostId,
	pid: process.pid,
	port: address.port,
	node: process.versions.node,
	piSdk: "1.3.0",
	recoveredInterruptedTasks: recoveredAtStartup,
	normalSessionId: normalSession.sessionManager.getSessionId(),
});
wakeScheduler();

async function shutdown() {
	if (stopping) return;
	stopping = true;
	if (schedulerTimer) clearTimeout(schedulerTimer);
	server.close();
	normalSession.session.dispose();
	taskStore.close();
	process.exit(0);
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
