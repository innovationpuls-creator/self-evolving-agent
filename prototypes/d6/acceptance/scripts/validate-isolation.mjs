import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { repository, runs, inventory, difference } from "./isolation.mjs";
import { archiveOutputs } from "./outputs.mjs";

await fs.mkdir(runs, { recursive: true });
const directory = await fs.mkdtemp(join(runs, "isolation-validation-"));
const before = await inventory();
const results = [];
async function run(name, args, signal) {
	const child = spawn(
		process.execPath,
		["prototypes/d6/acceptance/scripts/run.mjs", "--", ...args],
		{ cwd: repository, stdio: ["ignore", "pipe", "pipe"] },
	);
	let stdout = "",
		stderr = "",
		sent = false;
	child.stdout.on("data", (data) => {
		stdout += data;
		if (signal && !sent && stdout.includes("INTERRUPTION_READY")) {
			sent = true;
			child.kill(signal);
		}
	});
	child.stderr.on("data", (data) => {
		stderr += data;
	});
	const result = await new Promise((done) =>
		child.once("exit", (code, endedSignal) =>
			done({ code, signal: endedSignal }),
		),
	);
	const path = stdout.match(/D6 run: (.+)/)?.[1];
	assert.ok(path);
	if (signal === "SIGKILL") {
		// The child intentionally exits itself after one final test-owned write. SIGKILL cannot run finally handlers.
		await new Promise((done) => setTimeout(done, 1800));
		const workspace = join(path, "workspace");
		const survived = JSON.parse(
			await fs.readFile(
				join(
					workspace,
					"prototypes/d6/reflection-lifecycle/evidence/interrupted.json",
				),
			),
		);
		assert.equal(survived.afterParentKill, true);
		await archiveOutputs({ directory: path, workspace });
		await fs.writeFile(
			join(path, "run.json"),
			JSON.stringify({
				status: "interrupted",
				observedBy: "isolation-validation",
				...result,
			}),
		);
		await fs.rm(workspace, { recursive: true });
		await fs.rm(join(path, "tmp"), { recursive: true });
	} else if (!signal) assert.equal(result.code, 0, stdout + stderr);
	const row = { name, path, ...result, stdout, stderr };
	results.push(row);
	console.log(name, result.code, result.signal);
}
const suite = [
	"node",
	"--import",
	"tsx",
	"--test",
	"prototypes/d6/reflection-lifecycle/tests/crash.test.ts",
	"prototypes/d6/reflection-lifecycle/tests/persistence.test.ts",
	"prototypes/d6/reflection-lifecycle/tests/scope.test.ts",
];
await run("repeat-1", suite);
await run("repeat-2", suite);
await Promise.all([run("parallel-1", suite), run("parallel-2", suite)]);
const interruption = `const fs=require('node:fs');fs.writeFileSync('prototypes/d6/reflection-lifecycle/evidence/interrupted.json',JSON.stringify({started:true}));console.log('INTERRUPTION_READY');setTimeout(()=>fs.writeFileSync('prototypes/d6/reflection-lifecycle/evidence/interrupted.json',JSON.stringify({afterParentKill:true})),500);setTimeout(()=>process.exit(0),800);`;
await run("SIGTERM", ["node", "-e", interruption], "SIGTERM");
await run("SIGKILL", ["node", "-e", interruption], "SIGKILL");
assert.equal(new Set(results.map((r) => r.path)).size, results.length);
const changed = difference(before, await inventory());
await fs.writeFile(
	join(directory, "validation.json"),
	JSON.stringify(
		{
			results,
			sourceChanges: changed,
			distinctRuns: true,
			originalHistoricalEvidenceUnchanged: !changed.length,
			boundary: "filesystem output separation; not an OS sandbox",
			abruptExit:
				"SIGKILL leaves a private incomplete run; observer harvests and removes only its own workspaces after the test child exits",
		},
		null,
		2,
	),
	{ flag: "wx" },
);
assert.deepEqual(changed, []);
console.log(`ISOLATION_VALIDATION ${directory}`);
