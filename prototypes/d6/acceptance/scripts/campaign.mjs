import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { requireIsolation } from "./isolation.mjs";
requireIsolation(import.meta.url);
const cwd = process.env.D6_RUN_ROOT;
const reflection = process.env.D6_CAMPAIGN_FAMILY === "reflection";
const family = reflection ? "reflection-lifecycle" : "capability-integration";
const out = new URL("../evidence/", import.meta.url);
await fs.mkdir(out, { recursive: true });
const results = [],
	services = [];
async function command(name, args, extraEnv = {}) {
	const child = spawn(args[0], args.slice(1), {
		cwd,
		env: { ...process.env, ...extraEnv },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "",
		stderr = "";
	child.stdout.on("data", (v) => {
		stdout += v;
		process.stdout.write(v);
	});
	child.stderr.on("data", (v) => {
		stderr += v;
		process.stderr.write(v);
	});
	const code = await new Promise((done) => child.once("exit", done));
	results.push({ name, args, code, stdout, stderr });
	await fs.writeFile(
		new URL("campaign.json", out),
		JSON.stringify(results, null, 2),
	);
	return code;
}
async function service(name, args, ready) {
	const child = spawn(args[0], args.slice(1), {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
	services.push(child);
	let error = "";
	child.stdout.on("data", (v) => process.stdout.write(v));
	child.stderr.on("data", (v) => {
		error += v;
		process.stderr.write(v);
	});
	const deadline = Date.now() + 120000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error(`${name} exited: ${error}`);
		try {
			if (await ready()) return child;
		} catch {}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`${name} readiness deadline`);
}
try {
	if (
		await command("host-build", [
			"npm",
			"--prefix",
			"prototypes/d6",
			"run",
			"build:host",
		])
	)
		throw new Error("build failed");
	const connection = join(
		cwd,
		`prototypes/d6/${family}/.runtime/${reflection ? "controlled-connection" : "connection"}.json`,
	);
	await service(
		"capability",
		[
			"node",
			"--import",
			"tsx",
			`prototypes/d6/${family}/scripts/${reflection ? "controlled" : "runtime"}.ts`,
		],
		async () => {
			if (reflection)
				await fs.access(
					join(cwd, `prototypes/d6/${family}/.runtime/controlled.json`),
				);
			const c = JSON.parse(await fs.readFile(connection));
			return (
				c.origin &&
				(
					await fetch(`${c.origin}/api/sessions`, {
						headers: { Authorization: `Bearer ${c.token}` },
					})
				).ok
			);
		},
	);
	console.log(`D6_CAMPAIGN_READY ${cwd}`);
	const scripts =
		process.env.D6_CAMPAIGN_SCRIPTS?.split(",") ||
		(reflection
			? ["browser", "lifecycle", "reflection-boundaries"]
			: [
					"browser",
					"complete-chain",
					"activity",
					"partial",
					"boundaries",
					"continuity",
					"proposal",
					"import-draft",
					"memory-seed",
					"memory-browse",
					"memory-boundaries",
				]);
	for (const script of scripts)
		await command(
			script,
			[
				"node",
				["whole-journey", "real-use"].includes(script)
					? `prototypes/d6/acceptance/scripts/${script}.mjs`
					: `prototypes/d6/${family}/scripts/${script}.mjs`,
			],
			{ D6_EVIDENCE_SUBDIR: script },
		);
} finally {
	for (const child of services.reverse()) {
		child.kill("SIGTERM");
		await new Promise((done) => {
			if (child.exitCode !== null) done();
			else child.once("exit", done);
		});
	}
}
if (results.some((r) => r.code !== 0)) process.exitCode = 1;
