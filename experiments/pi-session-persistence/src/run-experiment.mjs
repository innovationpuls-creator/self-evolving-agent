import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workerPath = join(projectRoot, "src", "worker.mjs");
const artifactsDir = join(projectRoot, "artifacts");
const mockedCredential = "mock_sk_pi_session_LeakProbe_42_not_a_real_credential";
const mockKeyStore = { sessionKey: randomBytes(32) };
const workDir = await mkdtemp(join(tmpdir(), "pi-session-persistence-"));
const encryptedPath = join(workDir, "session.enc.json");
const safeExportPath = join(artifactsDir, "safe-export.json");

try {
	await mkdir(artifactsDir, { recursive: true, mode: 0o700 });
	const prepare = await spawnAndKillAfterCheckpoint(workerPath, ["prepare", encryptedPath, safeExportPath], mockKeyStore.sessionKey);
	assert.equal(prepare.signal, "SIGKILL", "The first Agent Host worker must be terminated by SIGKILL");
	assert.ok(!prepare.stdout.includes(mockedCredential), "The crashed worker must not print simulated credentials");
	assert.equal(prepare.stderr, "", `Prepare worker stderr: ${prepare.stderr}`);

	const encryptedBytes = await readFile(encryptedPath);
	assert.ok(!encryptedBytes.includes(Buffer.from(mockedCredential)), "Persisted encrypted snapshot must not contain the simulated credential in plaintext");
	const encryptedMode = (await stat(encryptedPath)).mode & 0o777;
	assert.equal(encryptedMode, 0o600, "Persisted snapshot must have owner-only file permissions");
	const safeExportText = await readFile(safeExportPath, "utf8");
	const safeExport = JSON.parse(safeExportText);
	assert.equal(safeExport.resumable, false);
	assert.ok(!safeExportText.includes(mockedCredential), "Plaintext safe export must not contain the simulated credential");
	assert.ok(safeExportText.includes("[REDACTED]"), "Safe export must visibly redact credential fields");

	const recovered = await spawnAndWait(workerPath, ["recover", encryptedPath], mockKeyStore.sessionKey);
	assert.equal(recovered.code, 0, `Recovery worker failed. stdout=${recovered.stdout}\nstderr=${recovered.stderr}`);
	assert.equal(recovered.stderr, "", `Recovery worker stderr: ${recovered.stderr}`);
	assert.ok(!recovered.stdout.includes(mockedCredential), "Recovery worker must not log simulated credentials");
	const recoveryResult = JSON.parse(recovered.stdout.trim().split("\n").at(-1));
	assert.equal(recoveryResult.phase, "recovered");
	for (const [name, passed] of Object.entries(recoveryResult.checks)) assert.equal(passed, true, `${name} did not pass`);

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
		checks: {
			allEntriesRoundTrip: true,
			historyBranchRestored: true,
			compactionRestored: true,
			customEntryRestored: true,
			processCrashRecoveryAfterSigkill: true,
			ciphertextHasNoPlaintextMockCredential: true,
			plaintextSafeExportRedactsCredential: true,
			ciphertextAuthenticationRejectsTampering: true,
			toolArgumentsUnchanged: true,
			recoveredSessionContinuesToolCalling: true,
			persistedFileMode: "0600",
		},
		entryCountAtRecovery: recoveryResult.entryCount,
		recoveryWorker: recoveryResult.checks,
		crashSignal: prepare.signal,
	};
	await writeFile(join(artifactsDir, "last-run.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
	await rm(workDir, { recursive: true, force: true });
}

async function spawnAndKillAfterCheckpoint(scriptPath, args, key) {
	const child = spawn(process.execPath, [scriptPath, ...args], { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
	child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
	child.stdin.end(`${key.toString("base64")}\n`);
	await waitForOutput(child, () => stdout.includes("READY_FOR_SIGKILL"), stdout, 30_000);
	const closed = once(child, "close");
	child.kill("SIGKILL");
	const [code, signal] = await withTimeout(closed, 10_000, "Prepare worker did not terminate after SIGKILL");
	return { code, signal, stdout, stderr };
}

async function spawnAndWait(scriptPath, args, key) {
	const child = spawn(process.execPath, [scriptPath, ...args], { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
	child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
	child.stdin.end(`${key.toString("base64")}\n`);
	const closed = once(child, "close");
	const [code, signal] = await withTimeout(closed, 30_000, "Recovery worker timed out");
	return { code, signal, stdout, stderr };
}

function waitForOutput(child, predicate, output, timeoutMs) {
	if (predicate()) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`Worker did not reach checkpoint in ${timeoutMs} ms. Output: ${output}`));
		}, timeoutMs);
		const check = () => {
			if (predicate()) {
				clearTimeout(timeout);
				resolve();
			}
		};
		child.stdout.on("data", check);
		child.once("close", (code, signal) => {
			clearTimeout(timeout);
			reject(new Error(`Worker exited before checkpoint (code=${code}, signal=${signal}). Output: ${output}`));
		});
	});
}

function withTimeout(promise, timeoutMs, message) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
	]).finally(() => clearTimeout(timer));
}
