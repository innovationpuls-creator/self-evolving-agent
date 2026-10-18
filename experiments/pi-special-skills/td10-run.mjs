import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
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
const fixtureRoot = join(root, "fixtures");
const sourceV1 = join(fixtureRoot, "package-v1");
const sourceV2 = join(fixtureRoot, "package-v2");
const sourceBad = join(fixtureRoot, "package-bad");
const workspace = await mkdtemp(join(tmpdir(), "td10-skill-release-"));
const agentDir = join(workspace, "agent-home");
const statePath = join(workspace, "release-state.json");
const canaryPath = join(workspace, "non-secret-canary.txt");
const resultsPath = join(root, "results", "td10-last-run.json");
const specialSkill = "td09-special";
const alpha = "td09_skill_alpha";
const beta = "td09_skill_beta";
const gateway = "td09_skill_gateway";
const admin = "td09_skill_admin";
const releasePaths = {};
const rigs = new Set();
let nextCallId = 0;

await mkdir(agentDir, { recursive: true });
await mkdir(dirname(resultsPath), { recursive: true });
await writeFile(canaryPath, "TD10_LOCAL_FIXTURE_CANARY\n", { mode: 0o600 });
process.env.TD09_CANARY_PATH = canaryPath;
globalThis.__td09Harness = makeFixtureHarness();

const checks = {};
let activeHost;
let versionAfterIdleSwitch;
let activeVersionAfterFailure;

async function main() {
try {
	releasePaths.v1 = join(workspace, "installed-v1");
	await cp(sourceV1, releasePaths.v1, { recursive: true });
	releasePaths.v2 = sourceV2;

	const initialState = { schemaVersion: 1, activeVersion: "v1", lastGoodVersion: "v1", disabledSkills: [] };
	await saveHostState(statePath, initialState);
	const v1Rig = await createRig(releasePaths.v1, { workspace, agentDir });
	const host = new ReleaseHost(v1Rig, "v1", statePath, releasePaths);
	activeHost = host;

	await verifyKnowledgeOnlyRefresh(v1Rig, releasePaths.v1, checks);

	const v1Gate = addGate("v1");
	const oldCall = host.invokeAlpha("in-flight-v1");
	await withTimeout(v1Gate.startedPromise, 10_000, "V1 tool did not reach its in-flight gate");

	const badStage = await stageCandidate(sourceBad, "bad-stage", workspace, agentDir);
	assert.equal(badStage.accepted, false);
	assert.match(badStage.reason, /TD-09 deliberate candidate initialization failure/);
	assert.equal(host.activeVersion, "v1");
	assert.equal(host.activeRig, v1Rig);
	assert.equal(v1Rig.session.isIdle, false, "V1 should stay in flight while the candidate is checked");
	const stateAfterBadStage = JSON.parse(await readFile(statePath, "utf8"));
	assert.equal(stateAfterBadStage.activeVersion, "v1");
	assert.equal(stateAfterBadStage.lastGoodVersion, "v1");
	checks.failedCandidateStageLeavesActiveVersionUntouched = true;
	checks.failedCandidateStageLeavesPersistedActiveAndLastGoodUntouched = true;
	await disposeRig(badStage.rig);

	const v2Stage = await stageCandidate(sourceV2, "v2", workspace, agentDir);
	assert.equal(v2Stage.accepted, true);
	assert.equal(v2Stage.hookProbePassed, true);
	assert.equal(lastAlphaResult("v2-stage-health-check")?.version, "v2");
	checks.newVersionLoadsAndExecutesInIndependentStage = true;
	checks.stagedCandidateHooksPassHealthProbe = true;

	const switchV2 = host.activate(v2Stage);
	assert.equal(host.isSwitching, true);
	assert.equal(host.activeRig, v1Rig, "Keep routing to V1 until its in-flight work has drained");
	const nextCall = host.invokeAlpha("queued-for-v2");
	v1Gate.release();
	await withTimeout(oldCall, 10_000, "The old V1 tool did not complete during staging");
	await withTimeout(switchV2, 10_000, "The V2 switch did not complete after V1 became idle");
	const queuedResult = await withTimeout(nextCall, 10_000, "The queued call did not run after the version switch");
	assert.equal(lastAlphaResult("in-flight-v1")?.version, "v1");
	assert.equal(queuedResult?.version, "v2");
	assert.equal(host.activeVersion, "v2");
	assert.equal(host.state.lastGoodVersion, "v2");
	const persistedV2 = JSON.parse(await readFile(statePath, "utf8"));
	assert.equal(persistedV2.activeVersion, "v2");
	assert.equal(persistedV2.lastGoodVersion, "v2");
	checks.successfulActivationPersistsActiveAndLastGoodVersions = true;
	versionAfterIdleSwitch = host.activeVersion;
	checks.oldToolFinishesBeforeVersionSwitch = true;
	checks.switchWaitsForIdleAndQueuesNewCalls = true;
	checks.postSwitchCallsUseV2 = true;

	const v2HookCountsBeforeFailure = hookCounts("v2");
	const v2ExtensionLoadsBeforeFailure = globalThis.__td09Harness.extensionLoads.filter((version) => version === "v2").length;
	await replaceCurrentWithFailingRelease(host, sourceBad);
	assert.ok(host.activeRig.loader.getExtensions().errors.some((entry) => entry.error.includes("TD-09 deliberate candidate initialization failure")));
	assert.equal(host.activeRig.session.getAllTools().some((tool) => tool.name === alpha), false);
	checks.forcedBadActivationRemovesCandidateTool = true;

	await host.restoreLastGood();
	assert.equal(host.activeVersion, "v2");
	activeVersionAfterFailure = host.activeVersion;
	assert.ok(host.activeRig.session.getAllTools().some((tool) => tool.name === alpha));
	assert.ok(host.activeRig.session.getAllTools().some((tool) => tool.name === gateway));
	assert.equal(globalThis.__td09Harness.extensionLoads.at(-1), "v2");
	await runToolCalls(host.activeRig, "Verify the restored agent hook", []);
	assert.ok(hookCounts("v2").agentStart > v2HookCountsBeforeFailure.agentStart);
	const restoredHookCounts = hookCounts("v2");
	const restoredCall = await host.invokeAlpha("v2-after-rollback");
	assert.equal(restoredCall?.version, "v2");
	assert.ok(hookCounts("v2").toolCall > restoredHookCounts.toolCall);
	assert.ok(globalThis.__td09Harness.extensionLoads.filter((version) => version === "v2").length > v2ExtensionLoadsBeforeFailure);
	checks.failureRollbackRestoresToolAndHooks = true;

	const hookCountsBeforeDisable = hookCounts("v2");
	const extensionLoadsBeforeDisable = globalThis.__td09Harness.extensionLoads.length;
	await host.setSkillDisabled(specialSkill, true);
	assertSkillDisabled(host.activeRig);
	await runToolCalls(host.activeRig, "Probe the disabled package after reload", []);
	assert.deepEqual(hookCounts("v2"), hookCountsBeforeDisable);
	assert.equal(globalThis.__td09Harness.extensionLoads.length, extensionLoadsBeforeDisable);
	checks.disableSurvivesPiSessionReload = true;

	await host.selectVersion("v1");
	assert.equal(host.state.activeVersion, "v1");
	assertSkillDisabled(host.activeRig);
	await runToolCalls(host.activeRig, "Probe the disabled package after version selection", []);
	assert.deepEqual(hookCounts("v2"), hookCountsBeforeDisable);
	assert.equal(globalThis.__td09Harness.extensionLoads.length, extensionLoadsBeforeDisable);
	checks.disableSurvivesVersionSwitch = true;
	checks.disabledPackageHooksRemainInactiveAfterReloadAndVersionSelection = true;

	await host.selectVersion("v2");
	assertSkillDisabled(host.activeRig);
	checks.disabledSkillDoesNotLoadDuringVersionSelection = true;

	const restart = spawnSync(process.execPath, [
		join(root, "td10-restart-probe.mjs"),
		statePath,
		workspace,
		agentDir,
		canaryPath,
		releasePaths.v1,
		releasePaths.v2,
	], { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000 });
	assert.equal(restart.status, 0, restart.stderr || restart.stdout);
	const restartEvidence = JSON.parse(restart.stdout.trim());
	assert.notEqual(restartEvidence.pid, process.pid);
	assert.equal(restartEvidence.activeVersion, "v2");
	assert.equal(restartEvidence.lastGoodVersion, "v2");
	assert.equal(restartEvidence.disabled, true);
	assert.equal(restartEvidence.skillLoaded, false);
	assert.equal(restartEvidence.alphaRegistered, false);
	assert.equal(restartEvidence.packageExtensionLoads, 0);
	checks.disabledSkillRemainsUnloadedAfterNewHostProcessStarts = true;

	const finalRig = host.activeRig;
	await host.close();
	rigs.delete(finalRig);
	activeHost = undefined;

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
			activeVersionAfterFailure,
			versionAfterIdleSwitch,
			lastGoodVersionAfterHostRestart: restartEvidence.lastGoodVersion,
			versionAfterHostRestart: restartEvidence.activeVersion,
			disabledAfterHostRestart: restartEvidence.disabled,
			restartChildPid: restartEvidence.pid,
		},
		securityBoundary: {
			loadedFixtureCode: "handwritten local trusted fixtures only",
			loadedUntrustedGeneratedCode: false,
			osSandboxImplementedOrTested: false,
		},
	};
	await writeFile(resultsPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
	if (activeHost) await activeHost.close().catch(() => {});
	await Promise.allSettled([...rigs].map(disposeRig));
	await rm(workspace, { recursive: true, force: true });
}
}

async function verifyKnowledgeOnlyRefresh(rig, packagePath, checks) {
	const skill = rig.loader.getSkills().skills.find((item) => item.name === specialSkill);
	assert.ok(skill);
	const initialDescription = skill.description;
	const extensionLoadsBefore = globalThis.__td09Harness.extensionLoads.length;
	const skillFile = skill.filePath;
	const updatedDescription = "Updated TD-10 description metadata for a knowledge-only release.";
	const updatedBodyMarker = "TD10_BODY_REFRESHED_WITHOUT_EXTENSION_RELOAD";
	await writeFile(skillFile, [
		"---",
		`name: ${specialSkill}`,
		`description: ${updatedDescription}`,
		"---",
		"",
		"# TD-10 refreshed knowledge fixture",
		"",
		updatedBodyMarker,
		"",
	].join("\n"));

	assert.ok(rig.session.systemPrompt.includes(initialDescription));
	assert.equal(rig.loader.getSkills().skills.find((item) => item.name === specialSkill)?.description, initialDescription);
	await runTextPrompt(rig, `/skill:${specialSkill}`);
	assert.ok(lastUserText(rig.session).includes(updatedBodyMarker), "Skill command expansion should read the current file body from disk");
	assert.equal(globalThis.__td09Harness.extensionLoads.length, extensionLoadsBefore);
	checks.skillBodyEditIsReadOnInvocationWithoutRuntimeReload = true;

	rig.loader.extendResources({
		skillPaths: [{
			path: skillFile,
			metadata: {
				source: skill.sourceInfo.source,
				scope: skill.sourceInfo.scope,
				origin: skill.sourceInfo.origin,
				baseDir: skill.baseDir,
				packageRoot: packagePath,
			},
		}],
	});
	assert.equal(rig.loader.getSkills().skills.find((item) => item.name === specialSkill)?.description, updatedDescription);
	rig.session.setActiveToolsByName(rig.session.getActiveToolNames());
	assert.ok(rig.session.systemPrompt.includes(updatedDescription));
	assert.equal(globalThis.__td09Harness.extensionLoads.length, extensionLoadsBefore);
	checks.skillMetadataRefreshUsesNativeResourceInterface = true;
	checks.knowledgeOnlyUpdateDoesNotReloadExtensionRuntime = true;
}

async function stageCandidate(packagePath, version, workspace, agentDir) {
	const rig = await createRig(packagePath, { workspace, agentDir });
	const loadError = rig.loader.getExtensions().errors.find((entry) => entry.error.includes("TD-09 deliberate candidate initialization failure"));
	if (loadError || !rig.session.getAllTools().some((tool) => tool.name === alpha)) {
		return { accepted: false, version, rig, reason: loadError?.error ?? "Expected Tool did not register" };
	}
	const ended = [];
	const hooksBefore = hookCounts(version);
	rig.session.subscribe((event) => {
		if (event.type === "tool_execution_end" && event.toolName === alpha) {
			ended.push({ isError: event.isError, result: event.result });
		}
	});
	await runToolCalls(rig, `Health-check staged ${version}`, [
		["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
		[alpha, { value: `${version}-stage-health-check` }],
	]);
	const output = lastAlphaResult(`${version}-stage-health-check`);
	const hooksAfter = hookCounts(version);
	const hookProbePassed = hooksAfter.agentStart > hooksBefore.agentStart && hooksAfter.toolCall > hooksBefore.toolCall;
	const passed = output?.version === version && ended.some((event) => event.isError === false) && hookProbePassed;
	return { accepted: passed, version, rig, hookProbePassed, reason: passed ? undefined : "Staged Tool or Hook health check failed" };
}

class ReleaseHost {
	constructor(activeRig, version, statePath, paths) {
		this.activeRig = activeRig;
		this.activeVersion = version;
		this.statePath = statePath;
		this.paths = paths;
		this.state = { schemaVersion: 1, activeVersion: version, lastGoodVersion: version, disabledSkills: [] };
		this.inFlight = 0;
		this.isSwitching = false;
		this.idleWaiters = [];
		this.switchWaiters = [];
	}
	async invokeAlpha(value) {
		while (this.isSwitching) {
			await new Promise((resolve) => this.switchWaiters.push(resolve));
		}
		const rig = this.activeRig;
		this.inFlight++;
		try {
			await runToolCalls(rig, `Host-routed ${value}`, [
				["tool_search", { query: "TD-09 Alpha fixture", limit: 1 }],
				[alpha, { value }],
			]);
			return lastAlphaResult(value);
		} finally {
			this.inFlight--;
			if (this.inFlight === 0) {
				for (const resolve of this.idleWaiters.splice(0)) resolve();
			}
		}
	}
	async activate(candidate) {
		assert.equal(candidate.accepted, true, "Only a fully staged and healthy candidate may be activated");
		assert.equal(this.isSwitching, false);
		this.isSwitching = true;
		try {
			if (this.inFlight > 0) await new Promise((resolve) => this.idleWaiters.push(resolve));
			const nextState = { ...this.state, activeVersion: candidate.version, lastGoodVersion: candidate.version };
			await saveHostState(this.statePath, nextState);
			const previous = this.activeRig;
			this.activeRig = candidate.rig;
			this.activeVersion = candidate.version;
			this.state = nextState;
			if (previous !== candidate.rig) await disposeRig(previous);
		} finally {
			this.isSwitching = false;
			for (const resolve of this.switchWaiters.splice(0)) resolve();
		}
	}
	async setSkillDisabled(name, disabled) {
		assert.equal(this.inFlight, 0, "Persistent policy changes must happen after active calls drain");
		const names = new Set(this.state.disabledSkills);
		if (disabled) names.add(name);
		else names.delete(name);
		const nextState = { ...this.state, disabledSkills: [...names].sort() };
		await saveHostState(this.statePath, nextState);
		this.state = nextState;
		await this.applyStateToCurrentSession();
	}
	async selectVersion(version) {
		assert.ok(this.paths[version], `Unknown release version: ${version}`);
		assert.equal(this.inFlight, 0, "Version selection must happen after active calls drain");
		const nextState = { ...this.state, activeVersion: version };
		await saveHostState(this.statePath, nextState);
		this.state = nextState;
		this.activeVersion = version;
		await this.applyStateToCurrentSession();
	}
	async applyStateToCurrentSession() {
		const disabled = this.state.disabledSkills.includes(specialSkill);
		const sources = disabled ? [] : [{ source: this.paths[this.state.activeVersion] }];
		this.activeRig.settingsManager.setPackages(sources);
		await this.activeRig.settingsManager.flush();
		await this.activeRig.session.reload();
	}
	async restoreLastGood() {
		assert.equal(this.inFlight, 0, "Rollback must wait until the active session is idle");
		const version = this.state.lastGoodVersion;
		const sources = this.state.disabledSkills.includes(specialSkill)
			? []
			: [{ source: this.paths[version] }];
		this.activeRig.settingsManager.setPackages(sources);
		await this.activeRig.settingsManager.flush();
		await this.activeRig.session.reload();
		this.activeVersion = version;
		this.state = { ...this.state, activeVersion: version };
		await saveHostState(this.statePath, this.state);
	}
	async close() {
		await disposeRig(this.activeRig);
	}
}

async function replaceCurrentWithFailingRelease(host, packagePath) {
	assert.equal(host.inFlight, 0);
	host.activeRig.settingsManager.setPackages([{ source: packagePath }]);
	await host.activeRig.settingsManager.flush();
	await host.activeRig.session.reload();
}

async function createRig(packagePath, { workspace, agentDir }) {
	const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
	settingsManager.setPackages(packagePath ? [{ source: packagePath }] : []);
	await settingsManager.flush();
	const loader = new DefaultResourceLoader({
		cwd: workspace,
		agentDir,
		settingsManager,
		extensionFactories: [createCodemodeExtension({ mode: "on" }), createToolSearchExtension()],
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		skillsOverride: (base) => ({
			skills: base.skills.filter((skill) => skill.name === specialSkill),
			diagnostics: base.diagnostics,
		}),
		systemPrompt: "You are a deterministic package publication fixture. Use only the requested fixture tools.",
	});
	await loader.reload();
	const faux = fauxProvider({ models: [{ id: "td10-faux-model", contextWindow: 8192, maxTokens: 512 }] });
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
		tools: ["read", "tool_search", "codemode", gateway, admin, alpha, beta],
	});
	const rig = { faux, loader, modelRuntime, packagePath, session, settingsManager };
	rigs.add(rig);
	return rig;
}

async function disposeRig(rig) {
	if (rig.disposed) return;
	rig.disposed = true;
	try {
		rig.session.dispose();
	} catch {
		// A failed candidate may not have finished initializing its extension runtime.
	}
}

async function runToolCalls(rig, prompt, toolCalls) {
	const responses = toolCalls.map(([name, args]) =>
		fauxAssistantMessage(fauxToolCall(name, args, { id: `td10-call-${++nextCallId}` }), { stopReason: "toolUse" }),
	);
	responses.push(fauxAssistantMessage("Fixture turn finished."));
	rig.faux.setResponses(responses);
	await rig.session.prompt(prompt);
	assert.equal(rig.faux.getPendingResponseCount(), 0, "Every Faux Provider response should be consumed by the Pi AgentLoop");
}

async function runTextPrompt(rig, prompt) {
	rig.faux.setResponses([fauxAssistantMessage("Fixture turn finished.")]);
	await rig.session.prompt(prompt);
	assert.equal(rig.faux.getPendingResponseCount(), 0);
}

function lastUserText(session) {
	const user = session.messages.findLast((message) => message.role === "user");
	assert.ok(user, "Expected the expanded Skill command in the session transcript");
	if (typeof user.content === "string") return user.content;
	return user.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function assertSkillDisabled(rig) {
	assert.equal(rig.loader.getSkills().skills.some((skill) => skill.name === specialSkill), false);
	assert.equal(rig.session.getAllTools().some((tool) => [alpha, beta, gateway, admin].includes(tool.name)), false);
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

function makeFixtureHarness() {
	return {
		alphaCalls: [],
		alphaResults: [],
		agentStartHooks: [],
		extensionLoads: [],
		extensionReadEvidence: [],
		gates: new Map(),
		toolCallHooks: [],
	};
}

async function saveHostState(path, state) {
	const tempPath = `${path}.${process.pid}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	await rename(tempPath, path);
}

function withTimeout(promise, timeoutMs, message) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
	]).finally(() => clearTimeout(timer));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
