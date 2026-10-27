import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { requireIsolation } from "./isolation.mjs";
requireIsolation(import.meta.url);
const out = new URL("../evidence/", import.meta.url);
await fs.mkdir(out, { recursive: true });
const results = [];
async function trial(index, mode) {
	const start = performance.now();
	const child = spawn(
		process.execPath,
		[
			"--import",
			"tsx",
			"--test",
			"prototypes/d6/acceptance/tests/reflection-race.test.ts",
		],
		{
			env: { ...process.env, D6_SAMPLE_ID: String(index) },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let stdout = "",
		stderr = "";
	child.stdout.on("data", (v) => {
		stdout += v;
	});
	child.stderr.on("data", (v) => {
		stderr += v;
	});
	const code = await new Promise((done) => child.once("exit", done));
	const row = {
		index,
		mode,
		pid: child.pid,
		code,
		durationMs: performance.now() - start,
		stdout,
		stderr,
	};
	results.push(row);
	await fs.writeFile(
		new URL(`trial-${index}.json`, out),
		JSON.stringify(row, null, 2),
		{ flag: "wx" },
	);
	console.log(mode, index, code);
}
for (let i = 0; i < 20; i++) await trial(i, "sequential");
for (let i = 20; i < 44; i += 4)
	await Promise.all(
		Array.from({ length: 4 }, (_, n) => trial(i + n, "parallel-4")),
	);
await fs.writeFile(
	new URL("reflection-trials.json", out),
	JSON.stringify(results, null, 2),
	{ flag: "wx" },
);
if (results.some((r) => r.code !== 0)) process.exitCode = 1;
