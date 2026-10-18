import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
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
import {
	createSafeExport,
	exportSessionSnapshot,
	readEncryptedSnapshot,
	restoreSessionSnapshot,
	writeEncryptedSnapshot,
} from "./store.mjs";

const MOCK_CREDENTIAL = "mock_sk_pi_session_LeakProbe_42_not_a_real_credential";
const EXPECTED_TOOL_ARGS = Object.freeze({
	accountId: "demo-account-001",
	apiToken: MOCK_CREDENTIAL,
	operation: "read_balance",
	amount: 0,
});

const [mode, snapshotPath, safeExportPath] = process.argv.slice(2);
if (!mode || !snapshotPath) throw new Error("Usage: worker.mjs <prepare|recover> <snapshot-path> [safe-export-path]");
const key = await readKeyFromStdin();
if (mode === "prepare") {
	if (!safeExportPath) throw new Error("prepare mode requires a safe export path");
	await prepareCrashCheckpoint(snapshotPath, safeExportPath, key);
} else if (mode === "recover") {
	await recoverAndContinue(snapshotPath, key);
} else {
	throw new Error(`Unknown worker mode: ${mode}`);
}

async function prepareCrashCheckpoint(encryptedPath, safePath, encryptionKey) {
	const cwd = process.cwd();
	const manager = makeBranchedCompactedManager(cwd);
	const chosenLeafId = manager.getLeafId();
	const firstRun = await runToolCallingTurn(manager, cwd, [
		fauxAssistantMessage(fauxToolCall("mock_vault", EXPECTED_TOOL_ARGS, { id: "initial-mock-call" }), { stopReason: "toolUse" }),
		fauxAssistantMessage("Initial simulated operation completed."),
	]);
	assert.deepEqual(firstRun.toolCalls, [EXPECTED_TOOL_ARGS], "Pi must pass the original tool arguments to execute()");
	assert.deepEqual(findToolCallArguments(manager.getEntries(), "initial-mock-call"), EXPECTED_TOOL_ARGS, "Pi must retain the original tool call in session history");

	// Move back to the selected branch head. Later append-only entries remain available as history.
	manager.branch(chosenLeafId);
	const snapshot = exportSessionSnapshot(manager);
	assert.equal(snapshot.leafId, chosenLeafId);
	assert.ok(snapshot.entries.some((entry) => entry.type === "custom" && entry.customType === "persistence-experiment"));
	assert.ok(snapshot.entries.some((entry) => entry.type === "compaction" && entry.summary === "compacted history sentinel"));
	assert.ok(snapshot.entries.some((entry) => JSON.stringify(entry).includes(MOCK_CREDENTIAL)), "The unredacted snapshot must retain the original tool call");

	// This proves the public import path preserves entries but reconstructs its leaf as the last append.
	const defaultImported = SessionManager.inMemory(cwd, { id: snapshot.header.id }, [snapshot.header, ...snapshot.entries]);
	assert.notEqual(defaultImported.getLeafId(), snapshot.leafId, "Fixture must exercise a non-last selected leaf");
	assert.deepEqual(defaultImported.getEntries(), snapshot.entries);

	const snapshotBeforeExport = JSON.stringify(snapshot);
	const liveEntriesBeforeExport = JSON.stringify(manager.getEntries());
	const safeExport = createSafeExport(snapshot, [MOCK_CREDENTIAL]);
	assert.ok(!JSON.stringify(safeExport).includes(MOCK_CREDENTIAL), "Plaintext export must redact the simulated credential");
	const safeToolCall = safeExport.session.entries
		.flatMap((entry) => entry.type === "message" && entry.message.role === "assistant" ? entry.message.content : [])
		.find((content) => content.type === "toolCall" && content.name === "mock_vault");
	assert.equal(safeToolCall?.arguments.apiToken, "[REDACTED]");
	assert.equal(safeToolCall?.arguments.operation, EXPECTED_TOOL_ARGS.operation);
	assert.deepEqual(findToolCallArguments(safeExport.session.entries, "initial-mock-call"), {
		...EXPECTED_TOOL_ARGS,
		apiToken: "[REDACTED]",
	}, "Safe export must redact only the exported Tool credential value");
	const safeCompaction = safeExport.session.entries.find((entry) => entry.type === "compaction");
	assert.equal(safeCompaction?.tokensBefore, 64, "Redaction must preserve non-secret token counters");
	const safeSystemMessage = safeExport.session.entries.find((entry) => entry.type === "message" && entry.message.role === "system")?.message;
	assert.deepEqual(safeSystemMessage?.toolsAdded?.[0]?.parameters?.properties?.apiToken, { type: "string" }, "Redaction must preserve the Tool parameter schema");
	assert.equal(JSON.stringify(snapshot), snapshotBeforeExport, "Safe export must not mutate resumable session data");
	assert.equal(JSON.stringify(manager.getEntries()), liveEntriesBeforeExport, "Export redaction must not mutate live Pi Tool arguments");
	await writeEncryptedSnapshot(encryptedPath, snapshot, encryptionKey);
	const encryptedBytes = await readFile(encryptedPath);
	assert.ok(!encryptedBytes.includes(Buffer.from(MOCK_CREDENTIAL)), "Encrypted persistence must not expose the simulated credential as plaintext");
	await mkdir(dirname(safePath), { recursive: true, mode: 0o700 });
	await writeFile(safePath, `${JSON.stringify(safeExport, null, 2)}\n`, { mode: 0o600 });
	assert.equal(firstRun.sessionManager.getLeafId(), chosenLeafId, "The initial tool execution must not have been altered by export redaction");
	firstRun.session.dispose();

	process.stdout.write("READY_FOR_SIGKILL\n");
	setInterval(() => {}, 1_000);
}

async function recoverAndContinue(encryptedPath, encryptionKey) {
	const snapshot = await readEncryptedSnapshot(encryptedPath, encryptionKey);
	const manager = restoreSessionSnapshot(snapshot);
	assert.equal(manager.getSessionId(), snapshot.header.id);
	assert.deepEqual(manager.getHeader(), snapshot.header, "Session header must round-trip unchanged");
	assert.equal(manager.getLeafId(), snapshot.leafId, "Host leafId restoration must select the saved branch");
	assert.deepEqual(manager.getEntries(), snapshot.entries, "Every Pi session entry must round-trip unchanged");
	const customEntry = manager.getEntries().find((entry) => entry.type === "custom" && entry.customType === "persistence-experiment");
	assert.deepEqual(customEntry?.data, { nested: { revision: 1, marker: "custom entry sentinel" } });
	const compactionEntry = manager.getEntries().find((entry) => entry.type === "compaction" && entry.summary === "compacted history sentinel");
	assert.deepEqual(compactionEntry?.details, { source: "prototype", marker: "compaction details sentinel" });
	assert.ok(manager.getEntries().some((entry) => JSON.stringify(entry).includes(MOCK_CREDENTIAL)), "Decryption must restore the original tool call arguments");
	assert.deepEqual(findToolCallArguments(manager.getEntries(), "initial-mock-call"), EXPECTED_TOOL_ARGS, "Restored history must keep original Tool call arguments");
	const abandoned = findMessageEntry(manager, "abandoned branch sentinel");
	const alternative = findMessageEntry(manager, "second historical branch sentinel");
	assert.ok(manager.getBranch(abandoned.id).some((entry) => JSON.stringify(entry).includes("root branch sentinel")));
	assert.ok(manager.getBranch(alternative.id).some((entry) => JSON.stringify(entry).includes("active pre-compaction sentinel")));
	manager.branch(alternative.id);
	assert.equal(manager.getLeafId(), alternative.id, "Restored abandoned branches must remain navigable");
	manager.branch(snapshot.leafId);
	assert.equal(manager.getLeafId(), snapshot.leafId);
	const restoredBranch = manager.getBranch().map((entry) => entry.id);
	assert.ok(restoredBranch.includes(snapshot.leafId));
	assert.ok(JSON.stringify(manager.buildSessionContext()).includes("compacted history sentinel"));
	const tamperedPath = `${encryptedPath}.tampered`;
	const tamperedEnvelope = JSON.parse(await readFile(encryptedPath, "utf8"));
	const damagedCiphertext = Buffer.from(tamperedEnvelope.ciphertext, "base64");
	damagedCiphertext[0] ^= 1;
	tamperedEnvelope.ciphertext = damagedCiphertext.toString("base64");
	await writeFile(tamperedPath, JSON.stringify(tamperedEnvelope), { mode: 0o600 });
	await assert.rejects(readEncryptedSnapshot(tamperedPath, encryptionKey), undefined, "AES-GCM must reject modified ciphertext");
	await rm(tamperedPath, { force: true });
	await assert.rejects(readEncryptedSnapshot(encryptedPath, randomBytes(32)), undefined, "AES-GCM must reject the wrong key");

	const continued = await runToolCallingTurn(manager, process.cwd(), [
		fauxAssistantMessage(fauxToolCall("mock_vault", EXPECTED_TOOL_ARGS, { id: "recovered-mock-call" }), { stopReason: "toolUse" }),
		fauxAssistantMessage("Recovered session continued successfully."),
	]);
	assert.deepEqual(continued.toolCalls, [EXPECTED_TOOL_ARGS], "Restored Pi AgentSession must execute the exact original tool parameters");
	assert.deepEqual(findToolCallArguments(manager.getEntries(), "recovered-mock-call"), EXPECTED_TOOL_ARGS, "New Tool call arguments must remain unchanged in restored history");
	assert.match(JSON.stringify(manager.getEntries()), /Recovered session continued successfully\./);
	continued.session.dispose();

	process.stdout.write(`${JSON.stringify({
		phase: "recovered",
		checks: {
			allEntriesRoundTrip: true,
			historyBranchRestored: true,
			compactionRestored: true,
			customEntryRestored: true,
			ciphertextAuthenticationRejectsTampering: true,
			toolArgumentsUnchanged: true,
			continuedAfterCrash: true,
		},
		entryCount: snapshot.entries.length,
		recoveredLeafId: manager.getLeafId(),
	})}\n`);
}

function findMessageEntry(manager, sentinel) {
	const entry = manager.getEntries().find((candidate) => candidate.type === "message" && JSON.stringify(candidate.message).includes(sentinel));
	assert.ok(entry, `Missing historical message sentinel: ${sentinel}`);
	return entry;
}

function findToolCallArguments(entries, toolCallId) {
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const toolCall = entry.message.content.find((content) => content.type === "toolCall" && content.id === toolCallId);
		if (toolCall) return toolCall.arguments;
	}
	assert.fail(`Tool call ${toolCallId} was not found in session entries`);
}

function makeBranchedCompactedManager(cwd) {
	const manager = SessionManager.inMemory(cwd, { id: "pi-persistence-prototype" });
	const rootId = manager.appendMessage(userMessage("root branch sentinel"));
	manager.appendMessage(fauxAssistantMessage("abandoned branch sentinel"));
	manager.branch(rootId);
	const keptId = manager.appendMessage(userMessage("active pre-compaction sentinel"));
	manager.appendMessage(fauxAssistantMessage("kept response sentinel"));
	manager.appendCustomEntry("persistence-experiment", { nested: { revision: 1, marker: "custom entry sentinel" } });
	const compactionId = manager.appendCompaction("compacted history sentinel", keptId, 64, { source: "prototype", marker: "compaction details sentinel" }, true);
	manager.branch(keptId);
	manager.appendMessage(fauxAssistantMessage("second historical branch sentinel"));
	manager.branch(compactionId);
	return manager;
}

async function runToolCallingTurn(sessionManager, cwd, responses) {
	const faux = fauxProvider({ models: [{ id: "mock-session-model", contextWindow: 8192, maxTokens: 512 }] });
	faux.setResponses(responses);
	const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: `${cwd}/mock-agent-config`,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: "You are an SDK persistence test agent. Call the requested tool exactly once.",
	});
	await resourceLoader.reload();
	const toolCalls = [];
	const mockVault = defineTool({
		name: "mock_vault",
		label: "Mock Vault",
		description: "Records a simulated credential operation for the persistence experiment.",
		parameters: Type.Object({
			accountId: Type.String(),
			apiToken: Type.String(),
			operation: Type.String(),
			amount: Type.Number(),
		}),
		async execute(_toolCallId, params) {
			toolCalls.push(structuredClone(params));
			return { content: [{ type: "text", text: "simulated operation accepted" }], details: { accepted: true } };
		},
	});
	const { session } = await createAgentSession({
		cwd,
		agentDir: `${cwd}/mock-agent-config`,
		model: faux.getModel(),
		modelRuntime,
		resourceLoader,
		settingsManager,
		sessionManager,
		customTools: [mockVault],
		tools: ["mock_vault"],
	});
	await session.prompt("Use mock_vault with the supplied simulated credential and return the result.");
	return { session, sessionManager, toolCalls };
}

function userMessage(content) {
	return { role: "user", content, timestamp: Date.now() };
}

async function readKeyFromStdin() {
	let input = "";
	for await (const chunk of process.stdin) {
		input += chunk.toString("utf8");
		if (input.includes("\n")) break;
	}
	const firstLine = input.split(/\r?\n/, 1)[0];
	const parsed = Buffer.from(firstLine, "base64");
	assert.equal(parsed.byteLength, 32, "Test driver must provide the ephemeral mock key store key");
	return parsed;
}
