import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api as forge } from "@electron-forge/core";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "security", "macos-xpc");
const resultPath = path.join(projectRoot, "results", "macos-app-sandbox-xpc.json");
const serviceBundleID = "com.electron.pi-host-prototype.reflection";
const bridgeBundleID = "com.electron.pi-host-prototype.reflection-bridge";
const nodeHelperID = "com.electron.pi-host-prototype.reflection-node";
const clientID = bridgeBundleID;
const scratch = await mkdtemp(path.join(os.tmpdir(), "td12-macos-xpc-"));
const userDataRoot = await mkdtemp(path.join(os.homedir(), ".td12-pi-host-data-"));
const run = (command, args, options = {}) => {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
	}
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

async function runSmoke(executable, reportFile) {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, ["--smoke-test", "--sandbox-smoke-test"], {
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
	node: process.version,
	electron: null,
	piSdk: null,
	packaging: "Electron Forge 8.0.1 package API; temporary output directory",
	appSandbox: "XPC Service with com.apple.security.app-sandbox; child Electron Node runtime with app-sandbox + inherit",
	codeSigning: "ad-hoc; no Developer ID identity or notarization",
	usedDocker: false,
	loadedUntrustedGeneratedCode: false,
	usedRealCredentials: false,
	windowsAppContainer: "UNVERIFIED: no Windows kernel/runtime was available",
	checks: {},
};

try {
	assert.equal(process.platform, "darwin", "This experiment runs only on macOS");
	assert.equal(process.arch, "arm64", "The packaged Electron prototype is arm64");
	const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
	const piSdkVersion = packageJson.dependencies["@earendil-works/pi-coding-agent"];
const electronVersion = packageJson.devDependencies.electron;
	report.piSdk = `@earendil-works/pi-coding-agent@${piSdkVersion}`;
	report.electron = electronVersion;

	const outDir = path.join(scratch, "forge-out");
	await forge.package({ dir: projectRoot, arch: "arm64", platform: "darwin", outDir, interactive: false });
	const appPath = path.join(outDir, "Pi Host Prototype-darwin-arm64", "Pi Host Prototype.app");
	const contents = path.join(appPath, "Contents");
	const helpersDir = path.join(contents, "Helpers");
	const bridgeAppPath = path.join(helpersDir, "ReflectionBridge.app");
	const bridgeContents = path.join(bridgeAppPath, "Contents");
	const bridgeMacOS = path.join(bridgeContents, "MacOS");
	const serviceBundlePath = path.join(bridgeContents, "XPCServices", `${serviceBundleID}.xpc`);
	const serviceContents = path.join(serviceBundlePath, "Contents");
	const serviceExecutable = path.join(serviceContents, "MacOS", "ReflectionService");
	const serviceNodeExecutable = path.join(serviceContents, "MacOS", "ReflectionNode");
	const serviceFrameworks = path.join(serviceContents, "Frameworks");
	const clientExecutable = path.join(bridgeMacOS, "reflection-xpc-client");
	const nodeExecutable = serviceNodeExecutable;
	const sourceServiceMain = path.join(scratch, "service-main.swift");
	const sourceClientMain = path.join(scratch, "client-main.swift");
	await Promise.all([
		mkdir(helpersDir, { recursive: true }),
		mkdir(bridgeMacOS, { recursive: true }),
		mkdir(serviceContents, { recursive: true }),
		mkdir(path.dirname(serviceExecutable), { recursive: true }),
	]);
	await mkdir(serviceFrameworks, { recursive: true });
	await cp(
		path.join(contents, "Frameworks", "Electron Framework.framework"),
		path.join(serviceFrameworks, "Electron Framework.framework"),
		{ recursive: true, preserveTimestamps: true },
	);
	run("codesign", [
		"--force", "--deep", "--sign", "-", "--timestamp=none",
		path.join(serviceFrameworks, "Electron Framework.framework"),
	]);
	await Promise.all([
		copyFile(path.join(sourceRoot, "ReflectionService.swift"), sourceServiceMain),
		copyFile(path.join(sourceRoot, "ReflectionXPCClient.swift"), sourceClientMain),
		copyFile(path.join(sourceRoot, "ReflectionBridge-Info.plist"), path.join(bridgeContents, "Info.plist")),
		copyFile(path.join(sourceRoot, "ReflectionService-Info.plist"), path.join(serviceContents, "Info.plist")),
		copyFile(path.join(contents, "MacOS", "pi-electron-host"), nodeExecutable),
	]);

	run("swiftc", ["-target", "arm64-apple-macosx14.0", sourceServiceMain, "-o", serviceExecutable]);
	run("swiftc", ["-target", "arm64-apple-macosx14.0", sourceClientMain, "-o", clientExecutable]);
	run("xcrun", [
		"swift-stdlib-tool", "--copy", "--platform", "macosx",
		"--scan-executable", serviceExecutable,
		"--scan-executable", clientExecutable,
		"--destination", path.join(contents, "Frameworks"),
		"--sign", "-",
	]);
	run("chmod", ["755", clientExecutable, nodeExecutable]);
	run("codesign", [
		"--force", "--sign", "-", "--timestamp=none", "--identifier", nodeHelperID,
		"--entitlements", path.join(sourceRoot, "ReflectionNode.entitlements"), nodeExecutable,
	]);
	run("codesign", [
		"--force", "--sign", "-", "--timestamp=none", "--identifier", clientID, clientExecutable,
	]);
	run("codesign", [
		"--force", "--sign", "-", "--timestamp=none", "--identifier", serviceBundleID,
		"--entitlements", path.join(sourceRoot, "ReflectionService.entitlements"),
		serviceBundlePath,
	]);
	run("codesign", ["--force", "--sign", "-", "--timestamp=none", "--identifier", bridgeBundleID, bridgeAppPath]);
	run("codesign", ["--force", "--sign", "-", "--timestamp=none", appPath]);
	run("codesign", ["--verify", "--strict", clientExecutable]);
	run("codesign", ["--verify", "--strict", nodeExecutable]);
	run("codesign", ["--verify", "--strict", serviceBundlePath]);
	run("codesign", ["--verify", "--strict", bridgeAppPath]);
	run("codesign", ["--verify", "--strict", appPath]);
	const nodeEntitlements = run("codesign", ["-d", "--entitlements", ":-", nodeExecutable]);
	const serviceEntitlements = run("codesign", ["-d", "--entitlements", ":-", serviceBundlePath]);
	const appEntitlements = run("codesign", ["-d", "--entitlements", ":-", appPath]);
	report.signingEntitlements = {
		piWorkerHasAppSandbox: `${nodeEntitlements.stdout}${nodeEntitlements.stderr}`.includes("com.apple.security.app-sandbox"),
		piWorkerInheritsParentSandbox: `${nodeEntitlements.stdout}${nodeEntitlements.stderr}`.includes("com.apple.security.inherit"),
		serviceHasAppSandbox: `${serviceEntitlements.stdout}${serviceEntitlements.stderr}`.includes("com.apple.security.app-sandbox"),
		serviceHasNetworkClient: `${serviceEntitlements.stdout}${serviceEntitlements.stderr}`.includes("com.apple.security.network.client"),
		hostAppHasAppSandbox: `${appEntitlements.stdout}${appEntitlements.stderr}`.includes("com.apple.security.app-sandbox"),
	};
	const appReportPath = path.join(scratch, "electron-smoke.json");
	const smoke = await runSmoke(path.join(contents, "MacOS", "pi-electron-host"), appReportPath);
	let appSmokeReport;
	try {
		appSmokeReport = JSON.parse(await readFile(appReportPath, "utf8"));
	} catch {
		appSmokeReport = null;
	}
	const allSmokeChecksPassed = Boolean(appSmokeReport?.checks
		&& Object.values(appSmokeReport.checks).every(Boolean));
	report.checks = {
		packagedAppLaunched: smoke.code === 0 && appSmokeReport?.host?.electron === electronVersion,
		embeddedXpcServiceRanPiSdk: Boolean(appSmokeReport?.checks?.xpcServiceAndPiWorkerRan),
		appSandboxSmokeChecks: allSmokeChecksPassed,
		packagedBundleAndHelpersSignatureVerified: true,
		entitlementsMatchIsolationDesign: report.signingEntitlements.piWorkerHasAppSandbox
			&& report.signingEntitlements.piWorkerInheritsParentSandbox
			&& report.signingEntitlements.serviceHasAppSandbox
			&& !report.signingEntitlements.serviceHasNetworkClient
			&& !report.signingEntitlements.hostAppHasAppSandbox,
	};
	report.appSmoke = appSmokeReport;
	report.processOutput = { stdout: smoke.stdout, stderr: smoke.stderr, exitCode: smoke.code, signal: smoke.signal };

	if (!report.checks.packagedAppLaunched || !report.checks.embeddedXpcServiceRanPiSdk
		|| !report.checks.entitlementsMatchIsolationDesign || !allSmokeChecksPassed) {
		report.outcome = "FAIL";
	} else {
		report.outcome = "PASS";
	}
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
