import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

const request = JSON.parse(Buffer.from(process.argv[2] ?? "", "base64").toString("utf8"));

async function runSecurityProbe(paths) {
	const readProbe = (target) => {
		try {
			readFileSync(target, "utf8");
			return { denied: false, errorCode: null };
		} catch (error) {
			return { denied: true, errorCode: error?.code ?? null };
		}
	};
	let hostKnowledgeWriteDenied = false;
	let hostKnowledgeWriteErrorCode = null;
	try {
		writeFileSync(paths.hostKnowledgePath, "unauthorized-node-write\n");
	} catch (error) {
		hostKnowledgeWriteDenied = true;
		hostKnowledgeWriteErrorCode = error?.code ?? null;
	}
	let networkDenied = false;
	let networkErrorCode = null;
	try {
		const response = await fetch(paths.networkProbeURL, { signal: AbortSignal.timeout(2500) });
		await response.arrayBuffer();
	} catch (error) {
		networkDenied = true;
		networkErrorCode = error?.cause?.code ?? error?.code ?? null;
	}
	const credentialRead = readProbe(paths.fakeCredentialPath);
	const formalSkillRead = readProbe(paths.fakeSkillPath);
	return {
		credentialReadDenied: credentialRead.denied,
		formalSkillReadDenied: formalSkillRead.denied,
		hostKnowledgeWriteDenied,
		networkDenied,
		credentialReadErrorCode: credentialRead.errorCode,
		formalSkillReadErrorCode: formalSkillRead.errorCode,
		hostKnowledgeWriteErrorCode,
		networkErrorCode,
	};
}

async function runModelBridgeProbe() {
	const requestID = randomUUID();
	const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
	const response = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("host_model_probe_timeout")), 5000);
		lines.on("line", (line) => {
			let message;
			try { message = JSON.parse(line); } catch { return; }
			if (message.kind !== "model_response" || message.requestID !== requestID) return;
			clearTimeout(timer);
			resolve(message);
		});
	});
	process.stdout.write(`${JSON.stringify({
		kind: "model_request",
		requestID,
		modelID: "reflection-host-approved",
		contextJSON: JSON.stringify({ messages: [] }),
	})}\n`);
	const reply = await response;
	lines.close();
	const assistant = JSON.parse(reply.assistantMessageJSON ?? "null");
	return {
		ok: reply.ok === true && assistant?.content?.some((block) => block.type === "text" && block.text === "xpc-bridge-ok"),
		workerPID: process.pid,
		nodeVersion: process.version,
		modelProvider: "xpc-probe",
		modelCalls: ["reflection-host-approved"],
		echo: assistant?.content?.find((block) => block.type === "text")?.text,
	};
}

async function main() {
	if (request.mode === "bootstrap") {
		return { ok: true, nodeVersion: process.version, workerPID: process.pid, echo: request.echo };
	}
	if (request.mode === "bridge-probe") return runModelBridgeProbe();
	if (request.mode === "pi-reflection" || request.mode === "pi-unauthorized-model" || request.mode === "pi-error" || request.mode === "pi-cancel") {
		const { runPiReflection } = await import("./PiReflectionWorker.mjs");
		return runPiReflection(request);
	}
	if (request.mode === "probe-child") {
		const security = await runSecurityProbe(request.probes);
		return { ok: true, nodeVersion: process.version, workerPID: process.pid, security };
	}
	if (request.mode === "probe") {
		const security = await runSecurityProbe(request.probes);
		const childRequest = { mode: "probe-child", probes: request.probes };
		const child = spawnSync(process.execPath, [
			fileURLToPath(import.meta.url),
			Buffer.from(JSON.stringify(childRequest)).toString("base64"),
		], { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
		let childResult;
		if (child.status === 0) {
			try {
				childResult = JSON.parse(child.stdout);
			} catch (error) {
				childResult = { ok: false, error: `Invalid child response: ${String(error)}` };
			}
		}
		return {
			ok: true,
			nodeVersion: process.version,
			workerPID: process.pid,
			security,
			child: {
				started: child.status === 0 && childResult?.ok === true,
				exitStatus: child.status,
				workerPID: childResult?.workerPID,
				security: childResult?.security,
				error: child.error?.code ?? child.error?.message ?? childResult?.error ?? null,
			},
		};
	}
	throw new Error(`Unsupported Node bootstrap mode: ${request.mode}`);
}

try {
	const result = await main();
	process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
	process.stderr.write(`${String(error)}\n`);
	process.exitCode = 1;
}
