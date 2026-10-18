import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const request = JSON.parse(Buffer.from(process.argv[2], "base64").toString("utf8"));
const historyIds = new Set(request.history.map((item) => item.id));
const toolEvents = [];
let readHistoryResult = [];
let knowledgeUpdate;

async function denied(operation) {
	try {
		await operation();
		return false;
	} catch {
		return true;
	}
}

const security = {
	credentialReadDenied: await denied(() => readFile(request.fakeCredentialPath, "utf8")),
	formalSkillReadDenied: await denied(() => readFile(request.fakeSkillPath, "utf8")),
	hostKnowledgeWriteDenied: await denied(() => writeFile(request.hostKnowledgePath, "reflection-child-write\n")),
	networkDenied: await denied(async () => {
		const response = await fetch(request.networkProbeURL, { signal: AbortSignal.timeout(1200) });
		await response.arrayBuffer();
	}),
	childNodeStarted: false,
	childCredentialReadDenied: false,
	childKnowledgeWriteDenied: false,
	childNetworkDenied: false,
};

const childProbeCode = `
const fs = require("node:fs");
(async () => {
  let credentialReadDenied = false;
  let knowledgeWriteDenied = false;
  let networkDenied = false;
  try { fs.readFileSync(process.env.TD12_FAKE_CREDENTIAL, "utf8"); } catch { credentialReadDenied = true; }
  try { fs.writeFileSync(process.env.TD12_HOST_KNOWLEDGE, "child-write\\n"); } catch { knowledgeWriteDenied = true; }
  try {
    const response = await fetch(process.env.TD12_NETWORK_URL, { signal: AbortSignal.timeout(1200) });
    await response.arrayBuffer();
  } catch { networkDenied = true; }
  process.stdout.write(JSON.stringify({ credentialReadDenied, knowledgeWriteDenied, networkDenied }));
})().catch(() => process.exit(2));
`;
const child = spawnSync(process.execPath, ["-e", childProbeCode], {
	encoding: "utf8",
	timeout: 5000,
	env: {
		...process.env,
		ELECTRON_RUN_AS_NODE: "1",
		TD12_FAKE_CREDENTIAL: request.fakeCredentialPath,
		TD12_HOST_KNOWLEDGE: request.hostKnowledgePath,
		TD12_NETWORK_URL: request.networkProbeURL,
	},
});
if (child.status === 0) {
	security.childNodeStarted = true;
	const childSecurity = JSON.parse(child.stdout);
	security.childCredentialReadDenied = childSecurity.credentialReadDenied;
	security.childKnowledgeWriteDenied = childSecurity.knowledgeWriteDenied;
	security.childNetworkDenied = childSecurity.networkDenied;
}

const faux = fauxProvider({ provider: "faux", api: "faux" });
const model = faux.getModel();
const modelRuntime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
modelRuntime.registerNativeProvider(faux.provider);
const workspace = path.join(os.tmpdir(), `pi-reflection-${process.pid}`);
const agentDir = path.join(workspace, "agent");
await mkdir(agentDir, { recursive: true });
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
	systemPrompt: "You are a Reflection research agent. Use only the supplied history and the two explicit tools.",
});
await resourceLoader.reload();

const customTools = [
	{
		name: "read_simulated_history",
		label: "Read simulated history",
		description: "Return the history snapshot provided by the trusted host over XPC.",
		parameters: Type.Object({}),
		async execute() {
			readHistoryResult = request.history;
			return {
				content: [{ type: "text", text: JSON.stringify(readHistoryResult) }],
				details: { source: "host-xpc-payload" },
			};
		},
	},
	{
		name: "submit_knowledge_update",
		label: "Submit knowledge update",
		description: "Submit a small, source-linked knowledge update for host validation.",
		parameters: Type.Object({
			topic: Type.String(),
			summary: Type.String(),
			source_ids: Type.Array(Type.String()),
		}),
		async execute(_id, params) {
			const valid = params.topic === "reflection"
				&& params.summary.trim().length > 0
				&& params.summary.length <= 240
				&& params.source_ids.length > 0
				&& params.source_ids.every((id) => historyIds.has(id));
			if (!valid) throw new Error("Knowledge update failed the worker schema check");
			knowledgeUpdate = {
				topic: params.topic,
				summary: params.summary,
				sourceIDs: params.source_ids,
			};
			return {
				content: [{ type: "text", text: "Knowledge update queued for host validation." }],
				details: { acceptedByWorker: true },
			};
		},
	},
];

const { session } = await createAgentSession({
	cwd: workspace,
	agentDir,
	model,
	modelRuntime,
	settingsManager,
	resourceLoader,
	sessionManager: SessionManager.inMemory(workspace),
	tools: ["read_simulated_history", "submit_knowledge_update"],
	customTools,
});
const activeToolNames = session.getActiveToolNames();
const unsubscribe = session.subscribe((event) => {
	if (!event.type.startsWith("tool_execution_")) return;
	toolEvents.push(`${event.type}:${event.toolName ?? event.name ?? "unknown"}`);
});

faux.setResponses([
	fauxAssistantMessage([fauxToolCall("read_simulated_history", {})], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("submit_knowledge_update", {
		topic: "reflection",
		summary: "The simulated history records a preference for concise, source-linked learning notes.",
		source_ids: [request.history[0]?.id].filter(Boolean),
	})], { stopReason: "toolUse" }),
	fauxAssistantMessage("Prepared a source-linked knowledge update for host validation."),
]);

let error;
try {
	await session.prompt("Read the simulated history, then submit one concise knowledge update tied to a source ID.");
} catch (caught) {
	error = caught instanceof Error ? caught.message : String(caught);
} finally {
	unsubscribe();
	session.dispose();
}
await rm(workspace, { recursive: true, force: true });

const result = {
	success: !error && Boolean(knowledgeUpdate) && readHistoryResult.length === request.history.length,
	servicePID: Number(process.env.TD12_XPC_SERVICE_PID ?? 0),
	workerPID: process.pid,
	nodeVersion: process.versions.node,
	electronVersion: process.versions.electron,
	toolNames: activeToolNames,
	toolEvents,
	readHistoryResult,
	knowledgeUpdate,
	security,
	error,
	loadedSkills: resourceLoader.getSkills().skills.length,
	loadedExtensions: resourceLoader.getExtensions().extensions.length,
};
process.stdout.write(`${JSON.stringify(result)}\n`);
