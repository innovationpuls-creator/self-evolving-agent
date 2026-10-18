import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api as forge } from "@electron-forge/core";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "security", "macos-xpc");
const includePermissionProbes = process.env.TD12_INCLUDE_PERMISSION_PROBES === "1";
const includeModelChannelSmoke = process.env.TD13_INCLUDE_MODEL_CHANNEL === "1";
const includePiSmoke = process.env.TD12_INCLUDE_PI_SMOKE === "1" || includeModelChannelSmoke;
const resultPath = path.join(projectRoot, "results", includePiSmoke
	? includeModelChannelSmoke ? "macos-xpc-model-channel.json" : "macos-node-xpc-pi.json"
	: includePermissionProbes ? "macos-node-xpc-permissions.json" : "macos-node-xpc-bootstrap.json");
const nodeVersion = "24.22.0";
const nodeBinaryPackage = `node-bin-darwin-arm64@${nodeVersion}`;
const nodeBinaryPackageURL = `https://registry.npmjs.org/node-bin-darwin-arm64/-/node-bin-darwin-arm64-${nodeVersion}.tgz`;
const expectedNodeBinaryPackageIntegrity = "sha512-vcD7IMiHzzsanVcQU0whxtEdU6FbQpHyXzV5buIZfIzRKAbvd/yF9kJt7g1sP4p5Nm5gQHOzSCOGVU9gnCegKQ==";
const serviceBundleID = "com.electron.pi-host-prototype.node-bootstrap";
const bridgeBundleID = "com.electron.pi-host-prototype.reflection-bridge";
const nodeHelperID = "com.electron.pi-host-prototype.reflection-node";
const clientID = bridgeBundleID;
const scratch = await mkdtemp(path.join(os.tmpdir(), "td12-node-xpc-"));
const userDataRoot = await mkdtemp(path.join(os.homedir(), ".td12-node-xpc-host-data-"));

const run = (command, args, options = {}) => {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

function getCodeSignatureDetails(target) {
	const output = run("codesign", ["-dv", "--verbose=4", target]);
	const text = `${output.stdout}\n${output.stderr}`;
	const details = {};
	for (const key of ["Identifier", "Format", "Signature", "TeamIdentifier", "CDHash"]) {
		const value = text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
		if (value) details[key] = value;
	}
	return details;
}

function isolatedNpmEnvironment() {
	return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
}

async function acquirePinnedNodeBinary(destinationRoot) {
	const packed = JSON.parse(run("npm", ["pack", nodeBinaryPackage, "--pack-destination", destinationRoot, "--json"], {
		env: isolatedNpmEnvironment(),
	}).stdout);
	assert.equal(packed.length, 1, "Expected one pinned Node binary package");
	assert.equal(packed[0].name, "node-bin-darwin-arm64");
	assert.equal(packed[0].version, nodeVersion);
	assert.equal(packed[0].integrity, expectedNodeBinaryPackageIntegrity, "npm package integrity differs from the pinned registry value");
	const archivePath = path.join(destinationRoot, packed[0].filename);
	const archive = await readFile(archivePath);
	const actualIntegrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
	assert.equal(actualIntegrity, expectedNodeBinaryPackageIntegrity, "Node package archive failed SHA-512 SRI verification");
	const extractedNodeRoot = path.join(destinationRoot, "node-dist");
	await mkdir(extractedNodeRoot, { recursive: true });
	run("tar", ["-xzf", archivePath, "-C", extractedNodeRoot, "--no-same-owner", "--no-same-permissions"]);
	const sourceNode = path.join(extractedNodeRoot, "package", "bin", "node");
	assert.equal(run(sourceNode, ["--version"]).stdout.trim(), `v${nodeVersion}`);
	return { sourceNode, integrity: actualIntegrity, archiveBytes: archive.length };
}

async function runSmoke(executable, reportFile) {
	return new Promise((resolve, reject) => {
		const args = ["--smoke-test", "--node-bootstrap-smoke-test"];
		if (includePermissionProbes) args.push("--node-permission-smoke-test");
		if (includePiSmoke) args.push("--node-pi-smoke-test");
		const child = spawn(executable, args, {
			cwd: scratch,
			env: {
				...process.env,
				PI_HOST_DATA_DIR: userDataRoot,
				PI_HOST_SMOKE_REPORT: reportFile,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdout = [];
		const stderr = [];
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("Packaged Electron smoke exceeded 120 seconds"));
		}, 120_000);
		child.stdout.on("data", (chunk) => stdout.push(chunk));
		child.stderr.on("data", (chunk) => stderr.push(chunk));
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			resolve({
				code,
				signal,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
	});
}

let report = {
	verifiedAt: new Date().toISOString(),
	platform: `${process.platform}-${process.arch}`,
	macOS: os.release(),
	electron: null,
	piSdkHostVersion: null,
	nodeVersion: `v${nodeVersion}`,
	nodeBinaryPackage,
	nodeBinaryPackageURL,
	nodeBinaryPackageRepository: "https://github.com/aredridel/node-bin-gen",
	expectedNodeBinaryPackageIntegrity,
	usedDocker: false,
	usedElectronFrameworkForWorker: false,
	usedRealCredentials: false,
	loadedUntrustedGeneratedCode: false,
	stage: includeModelChannelSmoke
		? "TD13: macOS App Sandbox Worker using a Pi 1.3.0 native Provider bridge over anonymous XPC to a trusted Host Faux ModelRuntime, Pi Tool Calling, cancellation, and host-validated knowledge update"
		: includePiSmoke
		? "standalone Node bootstrap, macOS sandbox probes, then Pi SDK 1.3.0 Faux Tool Calling and host-validated knowledge update"
		: includePermissionProbes
		? "signed standalone Node launch followed by real OS permission probes; Pi integration remains gated on every probe passing"
		: "signed standalone Node launch and JSON round-trip only; OS permission probes are gated on this stage passing",
	checks: {},
};

try {
	assert.equal(process.platform, "darwin", "This experiment runs only on macOS");
	assert.equal(process.arch, "arm64", "This experiment uses the arm64 Electron prototype");
	const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
	report.electron = packageJson.devDependencies.electron;
	report.piSdkHostVersion = packageJson.dependencies["@earendil-works/pi-coding-agent"];
	assert.equal(report.piSdkHostVersion, includePiSmoke ? "1.3.0" : report.piSdkHostVersion);
	if (includePiSmoke) assert.equal(includePermissionProbes, true, "Pi SDK smoke must run after the permission probes");
	if (includeModelChannelSmoke) assert.equal(includePermissionProbes, true, "TD13 model channel must retain the passed OS permission probes");

	const nodeEvidence = await acquirePinnedNodeBinary(scratch);
	const sourceNode = nodeEvidence.sourceNode;
	report.nodeBinaryPackageSRIValidated = nodeEvidence.integrity === expectedNodeBinaryPackageIntegrity;
	report.nodeBinaryPackageBytes = nodeEvidence.archiveBytes;
	const sourceNodeVersion = run(sourceNode, ["--version"]).stdout.trim();
	const sourceNodeDependencies = run("otool", ["-L", sourceNode]).stdout;
	assert.equal(sourceNodeDependencies.includes("Electron Framework"), false, "Standalone Node must not depend on Electron Framework");
	report.nodeBinaryBytes = (await stat(sourceNode)).size;
	report.nodeHasNoElectronFrameworkDependency = true;

	const outDir = path.join(scratch, "forge-out");
	await forge.package({ dir: projectRoot, arch: "arm64", platform: "darwin", outDir, interactive: false });
	const appPath = path.join(outDir, "Pi Host Prototype-darwin-arm64", "Pi Host Prototype.app");
	const contents = path.join(appPath, "Contents");
	const bridgeAppPath = path.join(contents, "Helpers", "ReflectionBridge.app");
	const bridgeContents = path.join(bridgeAppPath, "Contents");
	const bridgeMacOS = path.join(bridgeContents, "MacOS");
	const serviceBundlePath = path.join(bridgeContents, "XPCServices", `${serviceBundleID}.xpc`);
	const serviceContents = path.join(serviceBundlePath, "Contents");
	const serviceMacOS = path.join(serviceContents, "MacOS");
	const serviceResources = path.join(serviceContents, "Resources");
	const serviceExecutable = path.join(serviceMacOS, "NodeBootstrapService");
	const nodeExecutable = path.join(serviceMacOS, "ReflectionNode");
	const clientExecutable = path.join(bridgeMacOS, "reflection-xpc-client");
	const sourceServiceMain = path.join(scratch, "node-bootstrap-service.swift");
	const sourceClientMain = path.join(scratch, "node-bootstrap-client.swift");
	await Promise.all([
		mkdir(bridgeMacOS, { recursive: true }),
		mkdir(serviceMacOS, { recursive: true }),
		mkdir(serviceResources, { recursive: true }),
	]);
	let piWorkerRuntime;
	if (includePiSmoke) {
		const piRuntimeRoot = path.join(scratch, "pi-worker-runtime");
		await mkdir(piRuntimeRoot, { recursive: true });
		await Promise.all([
			copyFile(path.join(projectRoot, "package.json"), path.join(piRuntimeRoot, "package.json")),
			copyFile(path.join(projectRoot, "package-lock.json"), path.join(piRuntimeRoot, "package-lock.json")),
		]);
		const npmUserConfig = path.join(piRuntimeRoot, "npm-user.npmrc");
		const npmGlobalConfig = path.join(piRuntimeRoot, "npm-global.npmrc");
		await Promise.all([
			writeFile(path.join(piRuntimeRoot, ".npmrc"), "ignore-scripts=true\nallow-scripts=\n"),
			writeFile(npmUserConfig, ""),
			writeFile(npmGlobalConfig, ""),
		]);
		const isolatedNpmConfig = [`--userconfig=${npmUserConfig}`, `--globalconfig=${npmGlobalConfig}`];
		const scriptPolicy = run("npm", [
			"config", "get", "ignore-scripts",
			...isolatedNpmConfig,
		], { cwd: piRuntimeRoot, env: isolatedNpmEnvironment() });
		assert.equal(scriptPolicy.stdout.trim(), "true", "Worker dependency lifecycle scripts must be disabled before npm ci");
		const allowScriptsPolicy = run("npm", ["config", "get", "allow-scripts", ...isolatedNpmConfig], {
			cwd: piRuntimeRoot,
			env: isolatedNpmEnvironment(),
		});
		assert.equal(allowScriptsPolicy.stdout.trim(), "", "Worker dependency install-script allow-list must be empty");
		const install = run("npm", [
			"ci", "--omit=dev", "--bin-links=false", "--no-audit", "--no-fund",
			...isolatedNpmConfig, "--registry=https://registry.npmjs.org/",
		], { cwd: piRuntimeRoot, env: isolatedNpmEnvironment() });
		let electronPackageInstalled = false;
		try {
			await stat(path.join(piRuntimeRoot, "node_modules", "electron"));
			electronPackageInstalled = true;
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
		assert.equal(electronPackageInstalled, false, "Standalone Node runtime must not package Electron or Electron Framework");
		await cp(path.join(piRuntimeRoot, "node_modules"), path.join(serviceResources, "node_modules"), {
			recursive: true,
			preserveTimestamps: true,
			filter: (sourcePath) => !sourcePath.split(path.sep).includes(".bin"),
		});
		await copyFile(path.join(sourceRoot, "PiReflectionWorker.mjs"), path.join(serviceResources, "PiReflectionWorker.mjs"));
		piWorkerRuntime = {
			productionOnly: true,
			lifecycleScriptsDisabled: scriptPolicy.stdout.trim() === "true" && allowScriptsPolicy.stdout.trim() === "",
			cliBinaryLinksOmitted: true,
			electronPackageOmitted: !electronPackageInstalled,
			piCodingAgent: packageJson.dependencies["@earendil-works/pi-coding-agent"],
			piAi: packageJson.dependencies["@earendil-works/pi-ai"],
			typebox: packageJson.dependencies.typebox,
			installSummary: install.stdout.trim(),
			location: "XPCService/Contents/Resources/node_modules",
		};
	}
	report.piWorkerRuntime = piWorkerRuntime ?? null;
	await Promise.all([
		copyFile(sourceNode, nodeExecutable),
		copyFile(path.join(sourceRoot, "NodeBootstrapWorker.mjs"), path.join(serviceResources, "node-bootstrap.mjs")),
		copyFile(path.join(sourceRoot, "NodeBootstrapService-Info.plist"), path.join(serviceContents, "Info.plist")),
		copyFile(path.join(sourceRoot, "ReflectionBridge-Info.plist"), path.join(bridgeContents, "Info.plist")),
		copyFile(path.join(sourceRoot, "NodeBootstrapService.swift"), sourceServiceMain),
		copyFile(path.join(sourceRoot, "NodeBootstrapClient.swift"), sourceClientMain),
	]);

	run("swiftc", ["-target", "arm64-apple-macosx15.0", sourceServiceMain, "-o", serviceExecutable]);
	run("swiftc", ["-target", "arm64-apple-macosx15.0", sourceClientMain, "-o", clientExecutable]);
	run("xcrun", [
		"swift-stdlib-tool", "--copy", "--platform", "macosx",
		"--scan-executable", serviceExecutable,
		"--scan-executable", clientExecutable,
		"--destination", path.join(contents, "Frameworks"),
		"--sign", "-",
	]);
	run("chmod", ["755", nodeExecutable, clientExecutable]);

	// Sign nested code from the deepest item outward, as required by Apple's bundle-signing guidance.
	run("codesign", [
		"--force", "--sign", "-", "--timestamp=none", "--identifier", nodeHelperID,
		"--entitlements", path.join(sourceRoot, "ReflectionNode.entitlements"), nodeExecutable,
	]);
	run("codesign", [
		"--force", "--sign", "-", "--timestamp=none", "--identifier", serviceBundleID,
		"--entitlements", path.join(sourceRoot, "ReflectionService.entitlements"), serviceBundlePath,
	]);
	run("codesign", ["--force", "--sign", "-", "--timestamp=none", "--identifier", clientID, clientExecutable]);
	run("codesign", ["--force", "--sign", "-", "--timestamp=none", "--identifier", bridgeBundleID, bridgeAppPath]);
	run("codesign", ["--force", "--sign", "-", "--timestamp=none", appPath]);
	for (const signedPath of [nodeExecutable, serviceBundlePath, clientExecutable, bridgeAppPath, appPath]) {
		run("codesign", ["--verify", "--strict", signedPath]);
	}
	const nodeEntitlements = run("codesign", ["-d", "--entitlements", ":-", nodeExecutable]);
	const serviceEntitlements = run("codesign", ["-d", "--entitlements", ":-", serviceBundlePath]);
	const nodeEntitlementText = `${nodeEntitlements.stdout}${nodeEntitlements.stderr}`;
	const serviceEntitlementText = `${serviceEntitlements.stdout}${serviceEntitlements.stderr}`;
	report.signing = {
		nodeSignatureVerified: true,
		xpcServiceSignatureVerified: true,
		bridgeAppSignatureVerified: true,
		hostAppSignatureVerified: true,
		nodeSignatureDetails: getCodeSignatureDetails(nodeExecutable),
		xpcServiceSignatureDetails: getCodeSignatureDetails(serviceBundlePath),
		bridgeAppSignatureDetails: getCodeSignatureDetails(bridgeAppPath),
		hostAppSignatureDetails: getCodeSignatureDetails(appPath),
		nodeHasAppSandbox: nodeEntitlementText.includes("com.apple.security.app-sandbox"),
		nodeInheritsParentSandbox: nodeEntitlementText.includes("com.apple.security.inherit"),
		serviceHasAppSandbox: serviceEntitlementText.includes("com.apple.security.app-sandbox"),
		serviceHasNetworkClient: serviceEntitlementText.includes("com.apple.security.network.client"),
	};

	const reportFile = path.join(scratch, "electron-smoke.json");
	const smoke = await runSmoke(path.join(contents, "MacOS", "pi-electron-host"), reportFile);
	let sandboxDenialLog = { query: "eventMessage CONTAINS[c] 'Sandbox:' AND eventMessage CONTAINS[c] 'ReflectionNode'", lines: [] };
	if (includePermissionProbes) {
		const logResult = spawnSync("log", ["show", "--last", "5m", "--style", "compact", "--predicate", 'eventMessage CONTAINS[c] "Sandbox:" AND eventMessage CONTAINS[c] "ReflectionNode"'], { encoding: "utf8" });
		const logText = `${logResult.stdout ?? ""}\n${logResult.stderr ?? ""}`;
		sandboxDenialLog = {
			query: "eventMessage CONTAINS[c] 'Sandbox:' AND eventMessage CONTAINS[c] 'ReflectionNode'",
			available: !logResult.error && logResult.status === 0,
			lines: logText.split(/\r?\n/).filter((line) => /Sandbox:\s*ReflectionNode\(\d+\)\s+deny\(/i.test(line)).slice(-30),
		};
	}
	let appSmoke;
	try {
		appSmoke = JSON.parse(await readFile(reportFile, "utf8"));
	} catch {
		appSmoke = null;
	}
	const baseChecksPass = Boolean(appSmoke?.checks && Object.values(appSmoke.checks).every(Boolean));
	report.appSmoke = appSmoke;
	report.processOutput = { exitCode: smoke.code, signal: smoke.signal, stdout: smoke.stdout, stderr: smoke.stderr };
	if (includePermissionProbes) report.osSandboxDenialLog = sandboxDenialLog;
	report.checks = {
		packagedHostLaunched: smoke.code === 0 && appSmoke?.host?.electron === report.electron,
		allHostAndNodeBootstrapSmokeChecksPassed: baseChecksPass,
		nodeSignatureAndSandboxEntitlementsVerified: report.signing.nodeSignatureVerified
			&& report.signing.nodeHasAppSandbox
			&& report.signing.nodeInheritsParentSandbox
			&& report.signing.serviceHasAppSandbox
			&& !report.signing.serviceHasNetworkClient,
		signedStandaloneNodeStartedByXpcAndReturnedJSON: Boolean(
			appSmoke?.checks?.signedNodeStartedByXpcService
			&& appSmoke?.checks?.pinnedNodeVersionReturned
			&& appSmoke?.checks?.workerReturnedRequestData,
		),
	};
	if (includePermissionProbes) {
		const permissionChecks = appSmoke?.checks ?? {};
		const permissionEvidence = appSmoke?.nodePermissionEvidence;
		const directPID = permissionEvidence?.response?.workerPID;
		const childPID = permissionEvidence?.response?.child?.workerPID;
		const paths = permissionEvidence?.probePaths;
		const networkPort = paths?.networkProbeURL ? new URL(paths.networkProbeURL).port : "";
		const denialLogged = (pid, operation) => sandboxDenialLog.lines.some((line) =>
			line.includes(`ReflectionNode(${pid})`) && line.includes(operation));
		const osDenialEvidence = {
			directCredentialRead: Boolean(directPID && paths && denialLogged(directPID, `file-read-data ${paths.credentialPath}`)),
			childCredentialRead: Boolean(childPID && paths && denialLogged(childPID, `file-read-data ${paths.credentialPath}`)),
			directFormalSkillRead: Boolean(directPID && paths && denialLogged(directPID, `file-read-data ${paths.skillPath}`)),
			childFormalSkillRead: Boolean(childPID && paths && denialLogged(childPID, `file-read-data ${paths.skillPath}`)),
			directHostKnowledgeWrite: Boolean(directPID && paths && denialLogged(directPID, `file-write-data ${paths.knowledgePath}`)),
			childHostKnowledgeWrite: Boolean(childPID && paths && denialLogged(childPID, `file-write-data ${paths.knowledgePath}`)),
			directLoopbackNetwork: Boolean(directPID && networkPort && denialLogged(directPID, `network-outbound remote:*:${networkPort}`)),
			childLoopbackNetwork: Boolean(childPID && networkPort && denialLogged(childPID, `network-outbound remote:*:${networkPort}`)),
		};
		report.checks.osSandboxDeniedFileNetworkAndChildAccess = Boolean(
			permissionChecks.osDeniedFakeCredentialRead
			&& permissionChecks.osDeniedFormalSkillRead
			&& permissionChecks.osDeniedHostKnowledgeWrite
			&& permissionChecks.osDeniedLoopbackNetwork
			&& permissionChecks.signedNodeChildStartedAndReturned
			&& permissionChecks.childOsDeniedFakeCredentialRead
			&& permissionChecks.childOsDeniedFormalSkillRead
			&& permissionChecks.childOsDeniedHostKnowledgeWrite
			&& permissionChecks.childOsDeniedLoopbackNetwork
		);
		report.checks.hostCanariesAndNetworkPositiveControlPassed = Boolean(
			permissionChecks.hostPositiveControlCanReadFakeCredential
			&& permissionChecks.hostPositiveControlCanReadFormalSkill
			&& permissionChecks.hostPositiveControlCanReadKnowledge
			&& permissionChecks.hostPositiveControlCanReachLoopback
			&& permissionChecks.hostKnowledgeCanaryUnchanged
			&& permissionChecks.workerNetworkDidNotReachLoopback
		);
		report.checks.macosSandboxDenialWasRecorded = sandboxDenialLog.available
			&& Object.values(osDenialEvidence).every(Boolean);
		report.osSandboxDenialEvidence = osDenialEvidence;
		report.permissionProbeResult = {
			directNode: appSmoke?.nodePermissionEvidence?.response?.security ?? null,
			childNode: appSmoke?.nodePermissionEvidence?.response?.child ?? null,
			hostChecks: permissionChecks,
		};
	}
	if (includePiSmoke) {
		const bridgeProbe = appSmoke?.nodePermissionEvidence?.bridgeProbeEvidence;
		const bridgeChecks = bridgeProbe?.checks ?? {};
		report.checks.xpcWorkerHostModelRequestRoundTrip = Object.values(bridgeChecks).length > 0
			&& Object.values(bridgeChecks).every(Boolean);
		report.modelBridgeProbeEvidence = bridgeProbe ?? null;
		const piEvidence = appSmoke?.nodePermissionEvidence?.piEvidence;
		const piChecks = piEvidence?.checks ?? {};
		report.checks.piSdk130FauxToolCallingAndHostValidatedKnowledgeUpdate = Object.values(piChecks).length > 0
			&& Object.values(piChecks).every(Boolean);
		report.checks.piWorkerProductionRuntimePackaged = Boolean(report.piWorkerRuntime?.productionOnly
			&& report.piWorkerRuntime?.lifecycleScriptsDisabled
			&& report.piWorkerRuntime?.cliBinaryLinksOmitted
			&& report.piWorkerRuntime?.electronPackageOmitted
			&& piEvidence?.response?.modelProvider === (includeModelChannelSmoke ? "reflection-host-bridge" : "faux"));
		report.piReflectionEvidence = piEvidence ?? null;
		if (includeModelChannelSmoke) {
			report.checks.piSmokeWasGatedOnSuccessfulBridgeProbe = report.checks.xpcWorkerHostModelRequestRoundTrip;
			report.checks.pi130NativeProviderRelayedFauxRequestsThroughHostXpc = Boolean(
				piChecks.threePiProviderRoundsRelayedThroughHost
				&& piChecks.hostAuthorizedFixedModelAndBoundedTranscript
				&& piChecks.modelChannelContainsNoCredentialOrResourceProxyFields
			);
			report.checks.hostRejectedUnauthorizedModelAndHandledErrorAndCancel = Boolean(
				piChecks.hostRejectedUnapprovedModelID
				&& piChecks.upstreamFailureReachedWorkerAsPiError
				&& piChecks.PiAbortSignalSentHostCancellationAndWorkerContinued
			);
			report.modelChannelEvidence = {
				host: piEvidence?.hostChannel ?? null,
				negativeCases: piEvidence?.negativeCases ?? null,
			};
		}
	}
	report.outcome = Object.values(report.checks).every(Boolean) ? "PASS" : "FAIL";
} catch (error) {
	report.outcome = "FAIL";
	report.error = error instanceof Error ? error.stack ?? error.message : String(error);
} finally {
	await mkdir(path.dirname(resultPath), { recursive: true });
	await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`);
	await Promise.all([
		rm(scratch, { recursive: true, force: true }),
		rm(userDataRoot, { recursive: true, force: true }),
	]);
}

console.log(JSON.stringify({ outcome: report.outcome, resultPath, checks: report.checks, error: report.error }, null, 2));
if (report.outcome !== "PASS") process.exitCode = 1;
