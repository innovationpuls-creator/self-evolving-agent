import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
	createAgentSession,
	createCodemodeExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const root = dirname(fileURLToPath(import.meta.url));
const packageV1 = join(root, "fixtures", "package-v1");
const packageV2 = join(root, "fixtures", "package-v2");
const packageBad = join(root, "fixtures", "package-bad");
const workspace = await mkdtemp(join(tmpdir(), "td09-special-skills-"));
const agentDir = join(workspace, "agent-home");
const canaryPath = join(workspace, "non-secret-canary.txt");
const reportPath = join(root, "results", "last-run.json");
const ALPHA = "td09_skill_alpha";
let nextCallId = 0;

await mkdir(agentDir, { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(canaryPath, "TD09_NON_SECRET_CANARY\n", { mode: 0o600 });
process.env.TD09_CANARY_PATH = canaryPath;
globalThis.__td09Harness = {
	alphaCalls: [],
	alphaResults: [],
	agentStartHooks: [],
	extensionLoads: [],
	extensionReadEvidence: [],
	gates: new Map(),
	toolCallHooks: [],
};

const checks = {};
const rigs = [];

try {
	const denied = await createRig(packageV1, { scope: "project", trust: false });
	rigs.push(denied);
	assert.equal(denied.loader.getSkills().skills.some((skill) => skill.name === "td09-special"), false);
	assert.equal(denied.loader.getExtensions().extensions.some((extension) => extension.path.includes("package-v1")), false);
	assert.equal(globalThis.__td09Harness.extensionLoads.length, 0, "Untrusted project package code must not load before trust is granted");
	checks.projectTrustDenialSkipsPackageCode = true;
	checks.projectTrustDenialSkipsSkill = true;
	await disposeRig(denied);

	const active = await createRig(packageV1, { scope: "project", trust: true });
	rigs.push(active);
	assert.ok(active.loader.getSkills().skills.some((skill) => skill.name === "td09-special"));
	assert.ok(active.session.systemPrompt.includes("td09-special"), "Pi should advertise the native Skill name and description");
	assert.deepEqual(globalThis.__td09Harness.extensionReadEvidence.at(-1), {
		version: "v1",
		pid: process.pid,
		canary: "TD09_NON_SECRET_CANARY",
	});
	checks.standardSkillDiscoveredFromPiPackage = true;
	checks.extensionRunsInsidePiHostProcess = globalThis.__td09Harness.extensionReadEvidence.at(-1).pid === process.pid;
	checks.loadedExtensionCanReadHostAccessibleCanary = globalThis.__td09Harness.extensionReadEvidence.at(-1).canary === "TD09_NON_SECRET_CANARY";

	const initialHookCounts = hookCounts("v1");
	await runToolCalls(active, "Discover and use the Alpha fixture", [
		["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
		[ALPHA, { value: "tool-search-call", readCanary: true }],
	]);
	assert.ok(active.session.getActiveToolNames().includes(ALPHA));
	assert.deepEqual(lastAlphaResult("tool-search-call"), {
		version: "v1",
		pid: process.pid,
		cwd: workspace,
		value: "tool-search-call",
		canary: "TD09_NON_SECRET_CANARY",
	});
	assert.equal(hookCounts("v1").agentStart, initialHookCounts.agentStart + 1);
	assert.ok(hookCounts("v1").toolCall > initialHookCounts.toolCall);
	assert.ok(active.session.getAllTools().some((tool) => tool.name === "td09_skill_beta"));
	checks.multipleToolsAndHooksRegistered = true;
	checks.deferredToolDiscoveredAndCalledThroughAgentLoop = true;
	checks.hooksObserveAgentAndToolEvents = true;

	await runToolCalls(active, "Remove the deferred tool from the model declaration", [
		["td09_skill_admin", { action: "remove-from-model" }],
	]);
	assert.equal(active.session.getActiveToolNames().includes(ALPHA), false);
	assert.equal(active.session.getCallableToolNames().includes(ALPHA), true);
	await runToolCalls(active, "Search again after declaration-only removal", [
		["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
	]);
	assert.equal(active.session.getActiveToolNames().includes(ALPHA), true);
	checks.toolSearchCanReactivateAfterDeclarationOnlyRemoval = true;
	await runToolCalls(active, "Remove Alpha from the model declaration again", [
		["td09_skill_admin", { action: "remove-from-model" }],
	]);
	assert.equal(active.session.getActiveToolNames().includes(ALPHA), false);
	const beforeGateway = globalThis.__td09Harness.alphaCalls.length;
	await runToolCalls(active, "Call the inactive deferred tool through a trusted gateway", [
		["td09_skill_gateway", { value: "nested-bypass" }],
	]);
	assert.equal(globalThis.__td09Harness.alphaCalls.length, beforeGateway + 1);
	checks.removingDeferredToolFromModelDoesNotDisableNestedCall = true;

	const beforeCodemode = globalThis.__td09Harness.alphaCalls.length;
	await runToolCalls(active, "Call the inactive deferred tool through codemode", [
		["codemode", { code: "return await tools.td09_skill_alpha({ value: 'codemode-bypass' });" }],
	]);
	assert.equal(globalThis.__td09Harness.alphaCalls.length, beforeCodemode + 1);
	checks.inactiveDeferredToolRemainsReachableThroughCodemode = true;

	await runToolCalls(active, "Unsubscribe both fixture hooks", [
		["td09_skill_admin", { action: "disable-hooks" }],
	]);
	const stoppedHookCounts = hookCounts("v1");
	await runToolCalls(active, "Verify unsubscribed hooks stay quiet", [
		["td09_skill_gateway", { value: "hooks-stopped" }],
	]);
	assert.deepEqual(hookCounts("v1"), stoppedHookCounts);
	checks.hooksCanBeUnsubscribedWithoutReload = true;

	await runToolCalls(active, "Hide the deferred tool completely", [
		["td09_skill_admin", { action: "hide-alpha" }],
	]);
	assert.equal(active.session.getCallableToolNames().includes(ALPHA), false);
	assert.equal(active.session.getAllTools().find((tool) => tool.name === ALPHA)?.exposure, "hidden");
	await runToolCalls(active, "Search after hiding Alpha", [
		["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
	]);
	assert.equal(active.session.getActiveToolNames().includes(ALPHA), false);
	checks.hiddenToolCannotBeRediscovered = true;
	const beforeHiddenGateway = globalThis.__td09Harness.alphaCalls.length;
	await runToolCalls(active, "Try a nested call after hiding the tool", [
		["td09_skill_gateway", { value: "hidden-nested-call" }],
	]);
	assert.equal(globalThis.__td09Harness.alphaCalls.length, beforeHiddenGateway);
	const beforeHiddenCodemode = globalThis.__td09Harness.alphaCalls.length;
	await runToolCalls(active, "Try codemode after hiding the tool", [
		["codemode", { code: "return await tools.td09_skill_alpha({ value: 'hidden-codemode-call' });" }],
	]);
	assert.equal(globalThis.__td09Harness.alphaCalls.length, beforeHiddenCodemode);
	checks.hiddenExposureBlocksDirectNestedAndCodemodeRoutes = true;

	active.settingsManager.setProjectPackages([{ source: packageV2 }]);
	await active.settingsManager.flush();
	await active.session.reload();
	assert.ok(active.loader.getExtensions().extensions.length > 0);
	assert.ok(globalThis.__td09Harness.extensionLoads.includes("v2"));
	const v2HookBaseline = hookCounts("v2").agentStart;
	await runToolCalls(active, "Verify Hooks were registered again after reload", []);
	assert.equal(hookCounts("v2").agentStart, v2HookBaseline + 1);
	checks.hooksReRegisterAfterNativeSessionReload = true;

	await runToolCalls(active, "Discover the v2 fixture tool after reload", [
		["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
		[ALPHA, { value: "reload-v2" }],
	]);
	assert.equal(lastAlphaResult("reload-v2")?.version, "v2");
	checks.newVersionSwitchThroughPackageReload = true;

	active.settingsManager.setProjectPackages([{ source: packageV1 }]);
	await active.settingsManager.flush();
	await active.session.reload();
	await runToolCalls(active, "Discover the v1 rollback tool", [
		["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
		[ALPHA, { value: "rollback-v1" }],
	]);
	assert.equal(lastAlphaResult("rollback-v1")?.version, "v1");
	checks.oldVersionCanBeRestoredByHostPackageSelection = true;

	active.settingsManager.setProjectPackages([{ source: packageBad }]);
	await active.settingsManager.flush();
	await active.session.reload();
	assert.ok(active.loader.getExtensions().errors.some((entry) => entry.error.includes("TD-09 deliberate candidate initialization failure")));
	assert.equal(active.session.getAllTools().some((tool) => tool.name === ALPHA), false);
	checks.failedReloadDoesNotAutoFallback = true;
	active.settingsManager.setProjectPackages([{ source: packageV1 }]);
	await active.settingsManager.flush();
	await active.session.reload();
	assert.equal(globalThis.__td09Harness.extensionLoads.at(-1), "v1");
	await runToolCalls(active, "Use the old version after host-directed rollback", [
		["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
		[ALPHA, { value: "failed-candidate-fallback" }],
	]);
	assert.equal(lastAlphaResult("failed-candidate-fallback")?.version, "v1");
	checks.hostCanRestorePreviousVersionAfterFailedReload = true;

	const live = await createRig(packageV1);
	rigs.push(live);
	const safeGate = addGate("v1");
	const liveRun = runToolCalls(live, "Keep the v1 tool invocation running", [
		["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
		[ALPHA, { value: "live-v1" }],
	]);
	await withTimeout(safeGate.startedPromise, 10_000, "v1 tool did not reach the live-call gate");

	const candidateV2 = await createRig(packageV2);
	rigs.push(candidateV2);
	await runToolCalls(candidateV2, "Run the staged v2 package independently", [
		["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
		[ALPHA, { value: "staged-v2" }],
	]);
	assert.equal(lastAlphaResult("staged-v2")?.version, "v2");
	safeGate.release();
	await withTimeout(liveRun, 10_000, "v1 in-flight tool did not finish");
	assert.equal(lastAlphaResult("live-v1")?.version, "v1");
	checks.separateVersionStagingPreservesInFlightOldTool = true;

	const unsafe = await createRig(packageV1);
	rigs.push(unsafe);
	const unsafeGate = addGate("v1");
	const unsafeToolEnds = [];
	unsafe.session.subscribe((event) => {
		if (event.type === "tool_execution_end" && event.toolName === ALPHA) {
			unsafeToolEnds.push({ isError: event.isError, result: event.result });
		}
	});
	const unsafeRun = runToolCalls(unsafe, "Start an invocation before in-place reload", [
		["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
		[ALPHA, { value: "in-place-reload" }],
	]);
	await withTimeout(unsafeGate.startedPromise, 10_000, "reload probe did not reach its gate");
	unsafe.settingsManager.setPackages([{ source: packageV2 }]);
	await unsafe.session.reload();
	unsafeGate.release();
	await withTimeout(unsafeRun, 10_000, "in-place reload probe did not finish");
	assert.ok(unsafeToolEnds.some((event) => event.isError), "An in-flight extension tool should surface stale-context failure after in-place reload");
	checks.inPlaceReloadCanInvalidateInFlightExtensionContext = true;

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
		bypassEvidence: {
			toolAfterActiveSetRemoval: true,
			codemodeAfterActiveSetRemoval: true,
			nestedAfterHidden: false,
			codemodeAfterHidden: false,
		},
		inPlaceReloadFailure: {
			isError: unsafeToolEnds.some((event) => event.isError),
			errorText: JSON.stringify(unsafeToolEnds.at(-1)?.result ?? {}).slice(0, 500),
		},
	};
	await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
	await Promise.allSettled(rigs.map(disposeRig));
	await rm(workspace, { recursive: true, force: true });
}

async function createRig(packagePath, options = {}) {
	const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
	if (options.scope === "project") {
		settingsManager.setProjectPackages([{ source: packagePath }]);
		await settingsManager.flush();
	} else {
		settingsManager.setPackages([{ source: packagePath }]);
	}
	const loader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir,
		settingsManager,
		extensionFactories: [createCodemodeExtension({ mode: "on" }), createToolSearchExtension()],
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		skillsOverride: (base) => ({
			skills: base.skills.filter((skill) => skill.name === "td09-special"),
			diagnostics: base.diagnostics,
		}),
		systemPrompt: "You are a deterministic Pi SDK lifecycle fixture. Use only the requested fixture tools.",
	});
	if (options.scope === "project") {
		await loader.reload({ resolveProjectTrust: async () => options.trust === true });
	} else {
		await loader.reload();
	}
	const faux = fauxProvider({ models: [{ id: "td09-faux-model", contextWindow: 8192, maxTokens: 512 }] });
	const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(faux.provider);
	const { session } = await createAgentSession({
		cwd: workspace,
		agentDir,
		model: faux.getModel(),
		modelRuntime,
		resourceLoader: loader,
		settingsManager,
		sessionManager: SessionManager.inMemory(),
		tools: ["tool_search", "codemode", "td09_skill_gateway", "td09_skill_admin", "td09_skill_alpha", "td09_skill_beta"],
	});
	return { faux, loader, modelRuntime, packagePath, session, settingsManager };
}

async function disposeRig(rig) {
	try {
		rig.session.dispose();
	} catch {
		// A failed candidate can have no initialized extension runtime to dispose.
	}
}

async function runToolCalls(rig, prompt, toolCalls) {
	const responses = toolCalls.map(([name, args]) =>
		fauxAssistantMessage(fauxToolCall(name, args, { id: `td09-call-${++nextCallId}` }), { stopReason: "toolUse" }),
	);
	responses.push(fauxAssistantMessage("Fixture turn finished."));
	rig.faux.setResponses(responses);
	await rig.session.prompt(prompt);
	assert.equal(rig.faux.getPendingResponseCount(), 0, "Every Faux Provider response should be consumed by Pi Agent Loop");
}

function addGate(version) {
	let resolve;
	let announceStarted;
	const promise = new Promise((done) => { resolve = done; });
	const startedPromise = new Promise((done) => { announceStarted = done; });
	globalThis.__td09Harness.gates.set(version, { promise, started: announceStarted });
	return { release: resolve, startedPromise };
}

function hookCounts(version) {
	return {
		agentStart: globalThis.__td09Harness.agentStartHooks.filter((entry) => entry === version).length,
		toolCall: globalThis.__td09Harness.toolCallHooks.filter((entry) => entry.version === version).length,
	};
}

function lastAlphaResult(value) {
	return globalThis.__td09Harness.alphaResults.findLast((entry) => entry.value === value);
}

function withTimeout(promise, timeoutMs, message) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
	]).finally(() => clearTimeout(timer));
}
