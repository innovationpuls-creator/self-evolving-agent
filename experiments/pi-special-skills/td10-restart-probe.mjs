import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCodemodeExtension, createToolSearchExtension, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";

const [statePath, cwd, agentDir, canaryPath, v1Path, v2Path] = process.argv.slice(2);
assert.ok(statePath && cwd && agentDir && canaryPath && v1Path && v2Path);
const state = JSON.parse(await readFile(statePath, "utf8"));
const disabled = state.disabledSkills.includes("td09-special");
const selectedPackage = disabled ? undefined : ({ v1: v1Path, v2: v2Path })[state.activeVersion];
process.env.TD09_CANARY_PATH = canaryPath;
globalThis.__td09Harness = {
	alphaCalls: [], alphaResults: [], agentStartHooks: [], extensionLoads: [],
	extensionReadEvidence: [], gates: new Map(), toolCallHooks: [],
};

const settingsManager = SettingsManager.inMemory({}, { projectTrusted: true });
settingsManager.setPackages(selectedPackage ? [{ source: selectedPackage }] : []);
await settingsManager.flush();
const resourceLoader = new DefaultResourceLoader({
	cwd,
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
});
await resourceLoader.reload();
const faux = fauxProvider({ models: [{ id: "td10-restart-model", contextWindow: 8192, maxTokens: 512 }] });
const modelRuntime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const { session } = await createAgentSession({
	cwd,
	agentDir,
	model: faux.getModel(),
	modelRuntime,
	resourceLoader,
	settingsManager,
	sessionManager: SessionManager.inMemory(),
	tools: ["read", "tool_search", "codemode", "td09_skill_gateway", "td09_skill_admin", "td09_skill_alpha", "td09_skill_beta"],
});

const evidence = {
	pid: process.pid,
	activeVersion: state.activeVersion,
	lastGoodVersion: state.lastGoodVersion,
	disabled,
	skillLoaded: resourceLoader.getSkills().skills.some((skill) => skill.name === "td09-special"),
	alphaRegistered: session.getAllTools().some((tool) => tool.name === "td09_skill_alpha"),
	packageExtensionLoads: globalThis.__td09Harness.extensionLoads.length,
};
assert.equal(evidence.disabled, true);
assert.equal(evidence.skillLoaded, false);
assert.equal(evidence.alphaRegistered, false);
assert.equal(evidence.packageExtensionLoads, 0);
session.dispose();
process.stdout.write(`${JSON.stringify(evidence)}\n`);
