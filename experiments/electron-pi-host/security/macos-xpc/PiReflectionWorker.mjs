import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Type } from "typebox";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export async function runPiReflection(request) {
	const history = request.history;
	if (!Array.isArray(history) || history.length < 1 || history.length > 50
		|| history.some((item) => typeof item?.id !== "string" || typeof item?.text !== "string" || item.text.length > 2000)) {
		throw new Error("Reflection history payload is outside the bounded fixture schema");
	}
	const historySnapshot = history.map(({ id, text }) => ({ id, text }));
	const historyIds = new Set(historySnapshot.map((item) => item.id));
	const workspace = path.join(os.tmpdir(), `td12-pi-reflection-${process.pid}-${randomUUID()}`);
	const agentDir = path.join(workspace, "agent");
	await mkdir(agentDir, { recursive: true });

	const modelID = request.mode === "pi-unauthorized-model" ? "host-admin-model" : "reflection-host-approved";
	const bridgeModel = {
		id: modelID,
		name: "Reflection Host Model Bridge",
		api: "host-xpc-bridge",
		provider: "reflection-host-bridge",
		baseUrl: "xpc://approved-host-model",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 1024,
	};
	const pending = new Map();
	const modelCalls = [];
	let abortObserved = false;
	const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
	input.on("line", (line) => {
		let message;
		try { message = JSON.parse(line); } catch { return; }
		if (message.kind !== "model_response") return;
		const waiter = pending.get(message.requestID);
		if (!waiter) return;
		pending.delete(message.requestID);
		waiter.resolve(message);
	});
	function requestHostModel(model, context, signal) {
		const requestID = randomUUID();
		modelCalls.push({ requestID, modelID: model.id });
		return new Promise((resolve, reject) => {
			let settled = false;
			const cleanup = () => signal?.removeEventListener("abort", onAbort);
			const onAbort = () => {
				if (settled) return;
				settled = true;
				abortObserved = true;
				process.stdout.write(`${JSON.stringify({ kind: "model_cancel", requestID })}\n`);
				pending.delete(requestID);
				cleanup();
				reject(new Error("model_request_aborted"));
			};
			pending.set(requestID, { resolve: (response) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (!response.ok) reject(new Error(response.error ?? "host_model_request_failed"));
				else resolve(response);
			} });
			if (signal?.aborted) return onAbort();
			signal?.addEventListener("abort", onAbort, { once: true });
			process.stdout.write(`${JSON.stringify({
				kind: "model_request",
				requestID,
				modelID: model.id,
				contextJSON: JSON.stringify({ messages: context.messages }),
			})}\n`);
		});
	}
	const bridgeProvider = {
		id: bridgeModel.provider,
		name: "Reflection Host Model Bridge",
		auth: { apiKey: { name: "Host managed model", async resolve() { return { auth: {} }; } } },
		getModels() { return [bridgeModel]; },
		stream(_model, context, options) { return this.streamSimple(_model, context, options); },
		streamSimple(model, context, options) {
			const stream = createAssistantMessageEventStream();
			void (async () => {
				try {
					const response = await requestHostModel(model, context, options?.signal);
					const message = JSON.parse(response.assistantMessageJSON ?? "null");
					if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
						throw new Error("host_model_response_invalid");
					}
					stream.end({ ...message, api: model.api, provider: model.provider, model: model.id });
				} catch (error) {
					const aborted = options?.signal?.aborted === true;
					const message = {
						role: "assistant",
						api: model.api,
						provider: model.provider,
						model: model.id,
						content: [],
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
						stopReason: aborted ? "aborted" : "error",
						errorMessage: error instanceof Error ? error.message : String(error),
						timestamp: Date.now(),
					};
					stream.push({ type: "error", reason: message.stopReason, error: message });
					stream.end(message);
				}
			})();
			return stream;
		},
	};
	const modelRuntime = await ModelRuntime.create({
		authPath: path.join(agentDir, "auth.json"),
		modelsPath: null,
		allowModelNetwork: false,
	});
	modelRuntime.registerNativeProvider(bridgeProvider);
	const settingsManager = SettingsManager.inMemory({ quietStartup: true });
	const resourceLoader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: "You are a bounded Reflection test agent. Use only the supplied simulated history and the two explicit tools.",
	});
	await resourceLoader.reload();

	let readHistoryResult = [];
	let knowledgeUpdate;
	const customTools = [
		{
			name: "read_simulated_history",
			label: "Read simulated history",
			description: "Return only the simulated history snapshot supplied by the host.",
			parameters: Type.Object({}),
			async execute() {
				readHistoryResult = historySnapshot;
				return { content: [{ type: "text", text: JSON.stringify(readHistoryResult) }] };
			},
		},
		{
			name: "submit_knowledge_update",
			label: "Submit knowledge update",
			description: "Submit one small, source-linked candidate update for host validation.",
			parameters: Type.Object({
				topic: Type.String(),
				summary: Type.String(),
				source_ids: Type.Array(Type.String()),
			}),
			async execute(_id, params) {
				const valid = params.topic === "reflection"
					&& typeof params.summary === "string"
					&& params.summary.trim().length > 0
					&& params.summary.length <= 240
					&& Array.isArray(params.source_ids)
					&& params.source_ids.length > 0
					&& params.source_ids.length <= 8
					&& params.source_ids.every((id) => historyIds.has(id));
				if (!valid) throw new Error("Knowledge update failed the worker schema check");
				knowledgeUpdate = {
					topic: params.topic,
					summary: params.summary.trim(),
					sourceIDs: params.source_ids,
				};
				return {
					content: [{ type: "text", text: "Candidate accepted for host validation." }],
					details: { acceptedByWorker: true },
				};
			},
		},
	];

	const { session } = await createAgentSession({
		cwd: workspace,
		agentDir,
		model: bridgeModel,
		modelRuntime,
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.inMemory(workspace),
		tools: ["read_simulated_history", "submit_knowledge_update"],
		customTools,
	});
	const toolNames = session.getActiveToolNames();
	const toolEvents = [];
	const assistantErrors = [];
	const unsubscribe = session.subscribe((event) => {
		if (event.type.startsWith("tool_execution_")) {
			toolEvents.push(`${event.type}:${event.toolName ?? event.name ?? "unknown"}`);
		}
		if (event.type === "message_end" && event.message?.role === "assistant"
			&& event.message.stopReason === "error" && typeof event.message.errorMessage === "string") {
			assistantErrors.push(event.message.errorMessage);
		}
	});

	let error;
	const prompt = session.prompt("Read the simulated history, then submit one concise knowledge update tied to a source ID.");
	if (request.mode === "pi-cancel") setTimeout(() => { void session.abort(); }, 20);
	try {
		await prompt;
	} catch (caught) {
		error = caught instanceof Error ? caught.message : String(caught);
	} finally {
		input.close();
		process.stdin.pause();
		unsubscribe();
		session.dispose();
		await rm(workspace, { recursive: true, force: true });
	}
	const modelError = error ?? assistantErrors.at(-1);

	return {
		ok: request.mode === "pi-unauthorized-model"
			? modelError?.includes("model_not_authorized") === true
			: request.mode === "pi-error"
				? modelError?.includes("mock_upstream_unavailable") === true
				: request.mode === "pi-cancel"
					? abortObserved
					: !error && Boolean(knowledgeUpdate) && readHistoryResult.length === historySnapshot.length,
		workerPID: process.pid,
		nodeVersion: process.version,
		modelProvider: bridgeProvider.id,
		processEnvironmentKeys: Object.keys(process.env).sort(),
		modelCalls: modelCalls.map(({ requestID, modelID: requestedModel }) => `${requestedModel}:${requestID}`),
		modelError,
		abortObserved,
		toolNames,
		toolEvents,
		readHistoryResult,
		knowledgeUpdate,
		loadedSkills: resourceLoader.getSkills().skills.length,
		loadedExtensions: resourceLoader.getExtensions().extensions.length,
		error,
	};
}
