import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const ENVELOPE_AAD = Buffer.from("pi-session-snapshot:v1", "utf8");
const SENSITIVE_FIELD = /(?:^|_)(?:api_key|access_token|refresh_token|authorization|auth|credential|password|secret|token)(?:_|$)/i;
const BEARER_VALUE = /(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
const TOKEN_LIKE_VALUE = /\b(?:sk|pk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/g;

export function exportSessionSnapshot(sessionManager) {
	const header = sessionManager.getHeader();
	if (!header) throw new Error("Cannot export a session without its Pi session header");

	const entries = structuredClone(sessionManager.getEntries());
	const leafId = sessionManager.getLeafId();
	if (leafId !== null && !entries.some((entry) => entry.id === leafId)) {
		throw new Error(`Session leaf ${leafId} is not present in the exported entries`);
	}

	return {
		format: "pi-session-snapshot-v1",
		header: structuredClone(header),
		entries,
		leafId,
	};
}

export function restoreSessionSnapshot(snapshot) {
	if (snapshot?.format !== "pi-session-snapshot-v1") throw new Error("Unsupported Pi session snapshot format");
	if (!snapshot.header || !Array.isArray(snapshot.entries)) throw new Error("Invalid Pi session snapshot");

	const fileEntries = [structuredClone(snapshot.header), ...structuredClone(snapshot.entries)];
	const manager = SessionManager.inMemory(snapshot.header.cwd, { id: snapshot.header.id }, fileEntries);
	if (snapshot.leafId === null) {
		manager.resetLeaf();
	} else if (snapshot.leafId !== manager.getLeafId()) {
		manager.branch(snapshot.leafId);
	}
	return manager;
}

export function createSafeExport(snapshot, sensitiveValues = []) {
	const detached = structuredClone(snapshot);
	const knownSecrets = sensitiveValues.filter((value) => typeof value === "string" && value.length > 0);

	function scrub(value, key = "") {
		if (isSensitiveField(key) && !isJsonSchemaNode(value)) return "[REDACTED]";
		if (typeof value === "string") {
			let result = value;
			for (const secret of knownSecrets) result = result.split(secret).join("[REDACTED]");
			return result.replace(BEARER_VALUE, "$1[REDACTED]").replace(TOKEN_LIKE_VALUE, "[REDACTED]");
		}
		if (Array.isArray(value)) return value.map((item) => scrub(item));
		if (value && typeof value === "object") {
			return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, scrub(childValue, childKey)]));
		}
		return value;
	}

	return {
		format: "pi-session-safe-export-v1",
		resumable: false,
		session: scrub(detached),
	};
}

function isSensitiveField(key) {
	const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
	return SENSITIVE_FIELD.test(normalized);
}

function isJsonSchemaNode(value) {
	return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.type === "string");
}

export async function writeEncryptedSnapshot(path, snapshot, key) {
	assertKey(key);
	const plaintext = Buffer.from(JSON.stringify(snapshot), "utf8");
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, nonce);
	cipher.setAAD(ENVELOPE_AAD);
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const envelope = {
		format: "pi-session-encrypted-v1",
		algorithm: "aes-256-gcm",
		nonce: nonce.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		ciphertext: ciphertext.toString("base64"),
	};
	const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
	await atomicWrite(path, bytes);
}

export async function readEncryptedSnapshot(path, key) {
	assertKey(key);
	const envelope = JSON.parse(await readFile(path, "utf8"));
	if (envelope?.format !== "pi-session-encrypted-v1" || envelope.algorithm !== "aes-256-gcm") {
		throw new Error("Unsupported encrypted session envelope");
	}
	const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
	decipher.setAAD(ENVELOPE_AAD);
	decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(envelope.ciphertext, "base64")),
		decipher.final(),
	]);
	return JSON.parse(plaintext.toString("utf8"));
}

async function atomicWrite(path, bytes) {
	const folder = dirname(path);
	await mkdir(folder, { recursive: true, mode: 0o700 });
	const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
	let file;
	try {
		file = await open(temporaryPath, "wx", 0o600);
		await file.writeFile(bytes);
		await file.sync();
		await file.close();
		file = undefined;
		await rename(temporaryPath, path);
		const directory = await open(folder, "r");
		try {
			await directory.sync();
		} finally {
			await directory.close();
		}
	} catch (error) {
		if (file) await file.close().catch(() => {});
		await rm(temporaryPath, { force: true }).catch(() => {});
		throw error;
	}
}

function assertKey(key) {
	if (!Buffer.isBuffer(key) || key.byteLength !== 32) throw new Error("Session encryption key must be 32 bytes");
}
