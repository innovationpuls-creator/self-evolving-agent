import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { requireIsolation } from "./isolation.mjs";
requireIsolation(import.meta.url);
const root = process.env.D6_RUN_ROOT;
const results = [];
async function command(name, args, env = {}) {
	const child = spawn(args[0], args.slice(1), {
		cwd: root,
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "",
		stderr = "";
	child.stdout.on("data", (data) => {
		stdout += data;
		process.stdout.write(data);
	});
	child.stderr.on("data", (data) => {
		stderr += data;
		process.stderr.write(data);
	});
	const code = await new Promise((done) => child.once("exit", done));
	results.push({ name, code, stdout, stderr });
	await fs.writeFile(
		new URL("../evidence/mock-campaign.json", import.meta.url),
		JSON.stringify(results, null, 2),
	);
	return code;
}
if (
	await command("mock-build", [
		"npm",
		"--prefix",
		"prototypes/d6",
		"run",
		"build",
	])
)
	throw new Error("build failed");
const preview = spawn(
	process.execPath,
	[
		join(root, "node_modules/vite/bin/vite.js"),
		"preview",
		"--configLoader",
		"native",
		"--host",
		"127.0.0.1",
		"--port",
		"0",
	],
	{ cwd: join(root, "prototypes/d6"), stdio: ["ignore", "pipe", "pipe"] },
);
try {
	const origin = await new Promise((done, reject) => {
		const timer = setTimeout(
			() => reject(new Error("preview readiness timeout")),
			15000,
		);
		preview.once("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`preview exited ${code}`));
		});
		preview.stderr.on("data", (data) => process.stderr.write(data));
		preview.stdout.on("data", (data) => {
			const found = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
			if (found) {
				clearTimeout(timer);
				done(found[0]);
			}
		});
	});
	const env = { D6_MOCK_ORIGIN: origin };
	await command(
		"A/B exact screenshot parity and current A workspace",
		["node", "prototypes/d6/capability-integration/scripts/regression.mjs"],
		env,
	);
	await command(
		"B full original behavior regression",
		["node", "prototypes/d6/scripts/browser.mjs"],
		{ ...env, D6_MOCK_MODES: "studio" },
	);
} finally {
	preview.kill("SIGTERM");
	if (preview.exitCode === null)
		await new Promise((done) => preview.once("exit", done));
}
if (results.some((row) => row.code !== 0)) process.exitCode = 1;
