import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const here = dirname(fileURLToPath(import.meta.url));
const packagePaths = {
	v1: join(here, "fixtures", "package-v1"),
	v2: join(here, "fixtures", "package-v2"),
	bad: join(here, "fixtures", "package-bad"),
};
const resultsPath = join(here, "results", "td11-last-run.json");
const alpha = "td09_skill_alpha";
const beta = "td09_skill_beta";
const gateway = "td09_skill_gateway";
const admin = "td09_skill_admin";
const workspace = await mkdtemp(join(tmpdir(), "td11-pi-session-"));
const rigs = new Set();
const checks = {};
const harness = {
	alphaCalls: [],
	alphaResults: [],
	extensionLoads: [],
	extensionReadEvidence: [],
	agentStartHooks: [],
	toolCallHooks: [],
	gates: new Map(),
};
globalThis.__td09Harness = harness;
process.env.TD09_CANARY_PATH = join(workspace, "trusted-fixture-canary.txt");

let mainRig;
let peerRig;
let candidateRig;
let host;

async function main() {
try {
	await writeFile(process.env.TD09_CANARY_PATH, "TD11 trusted fixture only\n", { mode: 0o600 });
	const mainSeed = makeBranchedManager(workspace, "td11-original-session");
	mainRig = await createRig(packagePaths.v1, workspace, "main", mainSeed.manager);
	mainRig.branchIds = mainSeed;
	mainRig.session.setActiveToolsByName([alpha, "read"]);
	const peerSeed = makeBranchedManager(workspace, "td11-peer-session");
	peerRig = await createRig(packagePaths.v1, workspace, "peer", peerSeed.manager);
	peerRig.branchIds = peerSeed;
	peerRig.session.setActiveToolsByName([alpha, "read"]);
	candidateRig = await createRig(
		packagePaths.v2,
		workspace,
		"candidate",
		SessionManager.inMemory(workspace, { id: "td11-candidate-session" }),
	);
	candidateRig.session.setActiveToolsByName([alpha, "read"]);

	assert.notEqual(candidateRig.session.sessionManager, mainRig.session.sessionManager);
	assert.equal(candidateRig.loader.getExtensions().errors.length, 0);
	await runPrompt(candidateRig, "Stage V2 candidate", toolPlan(alpha, { value: "td11-candidate" }, "td11-candidate-call"));
	assert.equal(alphaResult("td11-candidate")?.version, "v2");
	assert.ok(harness.agentStartHooks.includes("v2"));
	assert.ok(harness.toolCallHooks.some((entry) => entry.version === "v2" && entry.name === alpha));
	checks.candidateVersionLoadsAndExecutesInIndependentSession = true;

	host = new ContinuityHost(mainRig, "v1", packagePaths.v1);
	const peerBeforeUpdate = captureState(peerRig, peerSeed);
	const gate = createGate();
	harness.gates.set("v1", gate);
	const oldPrompt = host.submit(
		"TD11 old V1 call in flight",
		toolPlan(alpha, { value: "td11-old-in-flight" }, "td11-old-call"),
	);
	await withTimeout(gate.startedPromise, 10_000, "The V1 Tool did not reach its in-flight gate");

	const switchStarted = deferred();
	const switchPromise = host.updateTo(packagePaths.v2, "v2", {
		onBarrier: () => switchStarted.resolve(),
	});
	await switchStarted.promise;
	const queuedOne = host.submit("TD11 queued user message one", [fauxAssistantMessage("queued answer one")]);
	const queuedTwo = host.submit("TD11 queued user message two", [fauxAssistantMessage("queued answer two")]);
	assert.equal(host.queuedCount, 2);
	gate.release();
	const [oldOutcome, switchOutcome] = await Promise.all([oldPrompt, switchPromise]);
	await Promise.all([queuedOne, queuedTwo]);
	assert.equal(oldOutcome.alphaVersion, "v1", "The in-flight V1 Tool must finish on its original runtime");
	assert.equal(switchOutcome.success, true, switchOutcome.error);
	assert.equal(switchOutcome.historyPreserved, true);
	assert.equal(switchOutcome.runtimeStatePreserved, true);
	assert.equal(switchOutcome.nativeReloadExpandedActiveToolSet, true);
	checks.inFlightOldToolFinishesBeforeSameSessionReload = true;
	checks.sameSessionHistoryBranchAndCompactionSurviveReload = true;
	checks.modelThinkingAndActiveToolStateSurviveReload = true;
	checks.hostRestoresToolSelectionAfterNativeReloadExpansion = true;
	assert.equal(countUsers(mainRig.session.sessionManager, "TD11 queued user message one"), 1);
	assert.equal(countUsers(mainRig.session.sessionManager, "TD11 queued user message two"), 1);
	assert.equal(host.dispatchLog.filter((item) => item === "TD11 queued user message one").length, 1);
	assert.equal(host.dispatchLog.filter((item) => item === "TD11 queued user message two").length, 1);
	assert.ok(
		host.dispatchLog.indexOf("TD11 queued user message one") < host.dispatchLog.indexOf("TD11 queued user message two"),
		"Messages waiting for the version switch must retain FIFO order",
	);
	checks.messagesQueuedDuringUpdateAreDeliveredExactlyOnce = true;
	checks.messagesQueuedDuringUpdateRetainArrivalOrder = true;
	assert.equal(mainRig.session.getToolDefinition(alpha)?.description.includes("from v2"), true);
	assert.equal(mainRig.session.getAllTools().filter((tool) => tool.name === alpha).length, 1);
	await host.submit("TD11 post-update V2 Tool call", toolPlan(alpha, { value: "td11-post-update" }, "td11-post-update-call"));
	assert.equal(alphaResult("td11-post-update")?.version, "v2");
	checks.sameAgentSessionUsesNewVersionOnLaterToolCalls = true;

	assert.equal(peerRig.session.getToolDefinition(alpha)?.description.includes("from v1"), true);
	assert.deepEqual(captureState(peerRig, peerSeed), peerBeforeUpdate);
	await runPrompt(peerRig, "TD11 peer session remains V1", toolPlan(alpha, { value: "td11-peer-v1" }, "td11-peer-call"));
	assert.equal(alphaResult("td11-peer-v1")?.version, "v1");
	checks.updatingOneSessionLeavesParallelSessionOnItsVersion = true;

	const beforeFailedUpdate = captureState(mainRig, mainSeed);
	const rollbackBarrier = deferred();
	const rollbackPause = deferred();
	const rollbackPauseReached = deferred();
	const failedUpdate = host.updateTo(packagePaths.bad, "bad", {
		onBarrier: () => rollbackBarrier.resolve(),
		beforeApply: async () => {
			rollbackPauseReached.resolve();
			await rollbackPause.promise;
		},
	});
	await rollbackBarrier.promise;
	await rollbackPauseReached.promise;
	const queuedDuringFailure = host.submit(
		"TD11 queued message during failed update",
		[fauxAssistantMessage("message continued after rollback")],
	);
	rollbackPause.resolve();
	const rollbackOutcome = await failedUpdate;
	await queuedDuringFailure;
	assert.equal(rollbackOutcome.success, false, "The deliberate bad Extension must be rejected");
	assert.equal(rollbackOutcome.restored, true, rollbackOutcome.error);
	assert.equal(host.activeVersion, "v2");
	assert.equal(mainRig.session.getToolDefinition(alpha)?.description.includes("from v2"), true);
	assert.equal(countUsers(mainRig.session.sessionManager, "TD11 queued message during failed update"), 1);
	assert.equal(host.dispatchLog.filter((item) => item === "TD11 queued message during failed update").length, 1);
	assertStatePrefixPreserved(beforeFailedUpdate, captureState(mainRig, mainSeed), mainSeed);
	checks.failedUpdateRestoresOldPackageAndContinuesOriginalSession = true;
	checks.rollbackRestoresPreviouslyActiveToolSelection = true;
	checks.messageQueuedDuringFailureContinuesOnceAfterRollback = true;
	await host.submit("TD11 V2 Tool call after rollback", toolPlan(alpha, { value: "td11-after-rollback" }, "td11-after-rollback-call"));
	assert.equal(alphaResult("td11-after-rollback")?.version, "v2");
	checks.sameSessionContinuesToolCallingAfterRollback = true;

	const result = {
		result: "PASS",
		verifiedAt: new Date().toISOString(),
		environment: {
			platform: process.platform,
			architecture: process.arch,
			node: process.version,
			piCodingAgent: "1.3.0",
			piAi: "1.3.0",
		},
		checks,
		evidence: {
			originalSessionId: mainRig.session.sessionManager.getSessionId(),
			peerSessionId: peerRig.session.sessionManager.getSessionId(),
			candidateSessionId: candidateRig.session.sessionManager.getSessionId(),
			versionAfterIdleReload: host.activeVersion,
			queuedMessagesDispatched: host.dispatchLog.filter((item) => item.startsWith("TD11 queued")).length,
			compactionEntriesAfterRollback: mainRig.session.sessionManager.getEntries().filter((entry) => entry.type === "compaction").length,
			branchLeafAfterRollback: mainRig.session.sessionManager.getLeafId(),
		},
		securityBoundary: {
			loadedFixtureCode: "handwritten local trusted fixtures only",
			loadedUntrustedGeneratedCode: false,
			osSandboxImplementedOrTested: false,
		},
	};
	await mkdir(dirname(resultsPath), { recursive: true });
	await writeFile(resultsPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
	if (host) await host.close().catch(() => {});
	await Promise.allSettled([...rigs].map(disposeRig));
	await rm(workspace, { recursive: true, force: true });
}
}

class ContinuityHost {
	constructor(rig, version, packagePath) {
		this.rig = rig;
		this.activeVersion = version;
		this.activePackagePath = packagePath;
		this.isSwitching = false;
		this.busy = false;
		this.busyDone = null;
		this.queue = [];
		this.draining = false;
		this.dispatchLog = [];
	}
	get queuedCount() {
		return this.queue.length;
	}
	submit(text, responses) {
		const item = { text, responses };
		if (this.isSwitching || this.busy || this.draining) {
			return new Promise((resolve, reject) => this.queue.push({ ...item, resolve, reject }));
		}
		return this.dispatch(item);
	}
	async dispatch(item) {
		assert.equal(this.busy, false, "Host serializes prompts for one AgentSession");
		this.busy = true;
		const done = deferred();
		this.busyDone = done;
		this.dispatchLog.push(item.text);
		try {
			await runPrompt(this.rig, item.text, item.responses);
			return { text: item.text, alphaVersion: alphaVersionFromPlan(item.responses) };
		} finally {
			this.busy = false;
			done.resolve();
			if (this.busyDone === done) this.busyDone = null;
		}
	}
	async waitForCurrent() {
		await this.rig.session.waitForIdle();
		const current = this.busyDone;
		if (current) await current.promise;
	}
	async updateTo(packagePath, version, { onBarrier, beforeApply } = {}) {
		assert.equal(this.isSwitching, false);
		this.isSwitching = true;
		onBarrier?.();
		const previousPath = this.activePackagePath;
		const previousVersion = this.activeVersion;
		let before;
		let outcome;
		let nativeReloadExpandedActiveToolSet = false;
		try {
			await this.waitForCurrent();
			before = captureState(this.rig, this.rig.branchIds);
			await beforeApply?.();
			await this.applyPackage(packagePath);
			const errors = extensionErrors(this.rig.loader);
			if (errors.length > 0) throw new Error(errors.join("; "));
			if (!this.rig.session.getToolDefinition(alpha)) throw new Error("Candidate failed to register Alpha Tool");
			const toolsImmediatelyAfterReload = this.rig.session.getActiveToolNames();
			nativeReloadExpandedActiveToolSet = toolsImmediatelyAfterReload.some((name) => !before.activeTools.includes(name));
			this.rig.session.setActiveToolsByName(before.activeTools);
			assertContinuity(before, this.rig, this.rig.branchIds, { expectSameTools: true });
			assert.match(this.rig.session.getToolDefinition(alpha).description, new RegExp(`from ${version}`));
			this.activePackagePath = packagePath;
			this.activeVersion = version;
			outcome = {
				success: true,
				historyPreserved: true,
				runtimeStatePreserved: true,
				nativeReloadExpandedActiveToolSet,
			};
		} catch (error) {
			const afterFailure = captureState(this.rig, this.rig.branchIds);
			if (before) assertCoreContinuity(before, this.rig, this.rig.branchIds);
			await this.applyPackage(previousPath);
			this.rig.session.setActiveToolsByName(before?.activeTools ?? afterFailure.activeTools);
			const restoreErrors = extensionErrors(this.rig.loader);
			if (restoreErrors.length > 0) throw new Error(`Rollback failed: ${restoreErrors.join("; ")}`);
			assertContinuity(before ?? afterFailure, this.rig, this.rig.branchIds, { expectSameTools: true });
			this.activePackagePath = previousPath;
			this.activeVersion = previousVersion;
			outcome = {
				success: false,
				restored: true,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			await this.finishSwitchAndDrain();
		}
		return outcome;
	}
	async applyPackage(packagePath) {
		this.rig.settingsManager.setPackages([{ source: packagePath }]);
		await this.rig.settingsManager.flush();
		await this.rig.session.reload();
	}
	async finishSwitchAndDrain() {
		this.draining = true;
		try {
			while (this.queue.length > 0) {
				const item = this.queue.shift();
				try {
					item.resolve(await this.dispatch(item));
				} catch (error) {
					item.reject(error);
				}
			}
		} finally {
			this.draining = false;
			this.isSwitching = false;
		}
	}
	async close() {
		await this.rig.session.waitForIdle();
	}
}

async function createRig(packagePath, cwd, name, sessionManager) {
	const agentDir = join(cwd, `agent-${name}`);
	const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
	settingsManager.setPackages([{ source: packagePath }]);
	await settingsManager.flush();
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt: "You are a deterministic trusted fixture agent. Follow the requested tool call exactly.",
	});
	await loader.reload();
	const faux = fauxProvider({ models: [{ id: "td11-faux-model", contextWindow: 8192, maxTokens: 512 }] });
	const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: faux.getModel(),
		modelRuntime,
		resourceLoader: loader,
		settingsManager,
		sessionManager,
		thinkingLevel: "low",
		tools: ["read", alpha, beta, gateway, admin],
	});
	const rig = { cwd, agentDir, faux, loader, modelRuntime, settingsManager, session };
	rigs.add(rig);
	return rig;
}

async function disposeRig(rig) {
	try {
		rig.session.dispose();
	} catch {
		// The deliberate broken fixture may leave its extension runner invalidated.
	}
}

async function runPrompt(rig, text, responses) {
	rig.faux.setResponses(responses);
	await rig.session.prompt(text);
	assert.equal(rig.faux.getPendingResponseCount(), 0, "Every Faux Provider response must be consumed");
	assert.equal(rig.session.isIdle, true);
}

function toolPlan(toolName, args, callId) {
	return [
		fauxAssistantMessage(fauxToolCall(toolName, args, { id: callId }), { stopReason: "toolUse" }),
		fauxAssistantMessage(`Finished ${args.value}.`),
	];
}

function alphaVersionFromPlan(responses) {
	const call = responses.flatMap((message) => message.content ?? []).find((part) => part.type === "toolCall" && part.name === alpha);
	if (!call) return undefined;
	return harness.alphaResults.findLast((result) => result.value === call.arguments.value)?.version;
}

function alphaResult(value) {
	return harness.alphaResults.findLast((result) => result.value === value);
}

function makeBranchedManager(cwd, id) {
	const manager = SessionManager.inMemory(cwd, { id });
	const rootId = manager.appendMessage(userMessage("TD11 preserved root branch"));
	const alternateLeafId = manager.appendMessage(fauxAssistantMessage("TD11 preserved alternate branch"));
	manager.branch(rootId);
	const keptId = manager.appendMessage(userMessage("TD11 active branch before compaction"));
	manager.appendMessage(fauxAssistantMessage("TD11 active pre-compaction answer"));
	manager.appendCustomEntry("td11-continuity", { marker: "preserve custom state" });
	const compactionId = manager.appendCompaction(
		"TD11 preserved compaction summary",
		keptId,
		48,
		{ source: "td11", marker: "compaction details preserved" },
		true,
	);
	manager.branch(keptId);
	manager.appendMessage(fauxAssistantMessage("TD11 second historical branch"));
	manager.branch(compactionId);
	return { manager, alternateLeafId, compactionId };
}

function captureState(rig, branchIds) {
	const manager = rig.session.sessionManager;
	return {
		manager,
		header: structuredClone(manager.getHeader()),
		entries: structuredClone(manager.getEntries()),
		leafId: manager.getLeafId(),
		activeBranch: structuredClone(manager.getBranch()),
		alternateBranch: structuredClone(manager.getBranch(branchIds.alternateLeafId)),
		model: rig.session.model ? { provider: rig.session.model.provider, id: rig.session.model.id } : null,
		thinkingLevel: rig.session.thinkingLevel,
		activeTools: rig.session.getActiveToolNames(),
		toolNames: rig.session.getAllTools().map((tool) => tool.name).sort(),
	};
}

function assertCoreContinuity(before, rig, branchIds) {
	const manager = rig.session.sessionManager;
	assert.equal(manager, before.manager, "Reload must retain the original SessionManager instance");
	assert.deepEqual(manager.getHeader(), before.header);
	assert.deepEqual(manager.getEntries(), before.entries);
	assert.equal(manager.getLeafId(), before.leafId);
	assert.deepEqual(manager.getBranch(), before.activeBranch);
	assert.deepEqual(manager.getBranch(branchIds.alternateLeafId), before.alternateBranch);
	assert.ok(manager.getEntries().some((entry) => entry.type === "compaction" && entry.summary === "TD11 preserved compaction summary"));
	assert.deepEqual(rig.session.model ? { provider: rig.session.model.provider, id: rig.session.model.id } : null, before.model);
	assert.equal(rig.session.thinkingLevel, before.thinkingLevel);
}

function assertContinuity(before, rig, branchIds, { expectSameTools }) {
	assertCoreContinuity(before, rig, branchIds);
	if (expectSameTools) {
		assert.deepEqual(rig.session.getActiveToolNames(), before.activeTools);
		assert.deepEqual(rig.session.getAllTools().map((tool) => tool.name).sort(), before.toolNames);
	}
}

function assertStatePrefixPreserved(before, after, branchIds) {
	assert.equal(after.manager, before.manager);
	assert.deepEqual(after.header, before.header);
	assert.deepEqual(after.entries.slice(0, before.entries.length), before.entries);
	assert.deepEqual(after.alternateBranch, before.alternateBranch);
	assert.deepEqual(after.activeBranch.slice(0, before.activeBranch.length), before.activeBranch);
	assert.ok(after.entries.some((entry) => entry.type === "compaction" && entry.summary === "TD11 preserved compaction summary"));
	assert.deepEqual(after.model, before.model);
	assert.equal(after.thinkingLevel, before.thinkingLevel);
	assert.deepEqual(after.activeTools, before.activeTools);
	assert.deepEqual(after.toolNames, before.toolNames);
	assert.ok(after.manager.getBranch(branchIds.alternateLeafId).length > 0);
}

function countUsers(manager, text) {
	return manager.getEntries().filter(
		(entry) => entry.type === "message" && entry.message.role === "user" && messageText(entry.message.content) === text,
	).length;
}

function messageText(content) {
	if (typeof content === "string") return content;
	return Array.isArray(content)
		? content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
		: "";
}

function extensionErrors(loader) {
	return loader.getExtensions().errors.map((entry) => entry.error ?? String(entry));
}

function userMessage(content) {
	return { role: "user", content, timestamp: Date.now() };
}

function createGate() {
	const started = deferred();
	const released = deferred();
	return {
		startedPromise: started.promise,
		started: () => started.resolve(),
		release: () => released.resolve(),
		promise: released.promise,
	};
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function withTimeout(promise, ms, message) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(message)), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

await main();
