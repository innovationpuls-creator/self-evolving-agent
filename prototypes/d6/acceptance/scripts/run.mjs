import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { archiveOutputs } from "./outputs.mjs";
import { join, relative, resolve } from "node:path";
import {
	difference,
	inventory,
	prepare,
	repository,
	requireIsolation,
} from "./isolation.mjs";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
if (!args.length) throw new Error("Expected a command after --");
if (
	process.env.D6_RUN_ROOT &&
	process.cwd().startsWith(process.env.D6_RUN_ROOT)
) {
	requireIsolation(import.meta.url);
	const child = spawn(args[0], args.slice(1), { stdio: "inherit" });
	child.on("error", (e) => {
		console.error(e.message);
		process.exitCode = 1;
	});
	child.on("exit", (code, signal) => {
		process.exitCode = code ?? (signal ? 130 : 1);
	});
} else {
	const run = await prepare("command");
	console.log(`D6 run: ${run.directory}`);
	const cwd = resolve(run.workspace, relative(repository, process.cwd()));
	if (!cwd.startsWith(run.workspace))
		throw new Error("Run from inside this repository");
	await fs.writeFile(
		join(run.directory, "run.json"),
		JSON.stringify({
			status: "running",
			pid: process.pid,
			workspace: run.workspace,
			command: args,
			started: new Date().toISOString(),
		}),
		{ flag: "wx" },
	);
	const log = await fs.open(join(run.directory, "command.log"), "wx");
	const child = spawn(args[0], args.slice(1), {
		cwd,
		detached: true,
		env: {
			...process.env,
			D6_RUN_ROOT: run.workspace,
			D6_RUN_DIR: run.directory,
			TMPDIR: join(run.directory, "tmp"),
			npm_config_cache: join(run.directory, "tmp/npm-cache"),
			npm_config_update_notifier: "false",
			XDG_CACHE_HOME: join(run.directory, "tmp/cache"),
			NODE_COMPILE_CACHE: join(run.directory, "tmp/node-cache"),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	for (const [stream, dest] of [
		[child.stdout, process.stdout],
		[child.stderr, process.stderr],
	])
		stream.on("data", (bytes) => {
			dest.write(bytes);
			void log.write(bytes);
		});
	let terminating = false;
	const stop = (signal) => {
		if (terminating) return;
		terminating = true;
		try {
			process.kill(-child.pid, signal);
		} catch {}
		const timer = setTimeout(() => {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {}
		}, 3000);
		timer.unref();
	};
	process.on("SIGTERM", () => stop("SIGTERM"));
	process.on("SIGINT", () => stop("SIGINT"));
	const result = await new Promise((done) => {
		child.once("error", (error) => done({ code: 1, error: error.message }));
		child.once("close", (code, signal) => done({ code, signal }));
	});
	await log.close();
	await archiveOutputs(run);
	const after = await inventory();
	const changed = difference(run.before, after);
	await fs.writeFile(
		join(run.directory, "source-after.json"),
		JSON.stringify(after),
		{ flag: "wx" },
	);
	await fs.writeFile(
		join(run.directory, "receipt.json"),
		JSON.stringify(
			{
				command: args,
				cwd: relative(repository, process.cwd()),
				...result,
				sourceChanges: changed,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	await fs.writeFile(
		join(run.directory, "run.json"),
		JSON.stringify({
			status: result.code === 0 ? "finished" : "incomplete",
			...result,
		}),
	);
	console.log(
		`D6 receipt: ${join(run.directory, "receipt.json")}; source changes: ${changed.length}`,
	);
	if (process.env.D6_KEEP_WORKSPACE !== "1") {
		await fs.rm(run.workspace, { recursive: true });
		await fs.rm(join(run.directory, "tmp"), { recursive: true });
	}
	process.exitCode = result.code ?? (result.signal ? 130 : 1);
}
