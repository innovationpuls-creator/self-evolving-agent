import fs from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);
export const runs = join(repository, "prototypes/d6/acceptance/runs");
const omitted = new Set([
	"node_modules",
	".git",
	".agents",
	".impeccable",
	"runs",
]);
const generated = new Set([
	"evidence",
	".runtime",
	"dist",
	"out",
	"release",
	"coverage",
	"test-results",
]);

export async function inventory(root = repository) {
	const entries = {};
	async function walk(directory) {
		for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
			if (omitted.has(entry.name)) continue;
			const path = join(directory, entry.name),
				name = relative(root, path);
			if (entry.isSymbolicLink())
				entries[name] = { link: await fs.readlink(path) };
			else if (entry.isDirectory()) await walk(path);
			else if (entry.isFile()) {
				const stat = await fs.stat(path);
				entries[name] = {
					bytes: stat.size,
					sha256: createHash("sha256")
						.update(await fs.readFile(path))
						.digest("hex"),
				};
			}
		}
	}
	// Native packaged outputs are inventoried separately when used; never traverse app dependencies here.
	for (const name of [
		"apps",
		"packages",
		"tests",
		"scripts",
		"docs",
		"prototypes/d6",
	])
		await walk(join(root, name));
	for (const name of [
		"AGENTS.md",
		"DECISIONS.md",
		"package.json",
		"tsconfig.json",
	]) {
		const bytes = await fs.readFile(join(root, name));
		entries[name] = {
			bytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	}
	return entries;
}

export function difference(before, after) {
	return [...new Set([...Object.keys(before), ...Object.keys(after)])]
		.sort()
		.flatMap((path) =>
			JSON.stringify(before[path]) === JSON.stringify(after[path])
				? []
				: [{ path, before: before[path], after: after[path] }],
		);
}

export async function prepare(label = "run") {
	await fs.mkdir(runs, { recursive: true, mode: 0o700 });
	const directory = join(
		runs,
		`${new Date().toISOString().replaceAll(":", "-")}-${label}-${randomUUID().slice(0, 8)}`,
	);
	const workspace = join(directory, "workspace");
	await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
	const before = await inventory();
	await fs.writeFile(
		join(directory, "source-before.json"),
		JSON.stringify(before),
		{ flag: "wx" },
	);
	const filter = (path) => {
		const parts = relative(repository, path).split(sep);
		return !parts.some(
			(part) =>
				omitted.has(part) ||
				generated.has(part) ||
				part.endsWith(".tsbuildinfo"),
		);
	};
	async function copy(source, destination) {
		if (!filter(source)) return;
		const stat = await fs.lstat(source);
		if (stat.isSymbolicLink()) {
			// Do not copy arbitrary absolute links into a writable test tree.
			return;
		}
		if (stat.isDirectory()) {
			await fs.mkdir(destination, { recursive: true });
			for (const name of await fs.readdir(source))
				await copy(join(source, name), join(destination, name));
		} else if (stat.isFile()) await fs.copyFile(source, destination);
	}
	for (const name of ["apps", "packages", "tests", "scripts", "prototypes/d6"])
		await copy(join(repository, name), join(workspace, name));
	for (const entry of await fs.readdir(repository, { withFileTypes: true })) {
		if (
			(entry.isFile() && /\.(json|md)$/.test(entry.name)) ||
			entry.name === ".gitignore"
		)
			await fs.copyFile(
				join(repository, entry.name),
				join(workspace, entry.name),
			);
	}
	// Dependencies are reused. Product data, credentials, historical evidence and build outputs are never copied.
	for (const name of ["", "prototypes/d6"]) {
		await fs.symlink(
			join(repository, name, "node_modules"),
			join(workspace, name, "node_modules"),
			"dir",
		);
	}
	await fs.writeFile(
		join(workspace, ".d6-run.json"),
		JSON.stringify({ workspace, source: repository }),
		{ flag: "wx", mode: 0o400 },
	);
	await fs.mkdir(join(directory, "tmp"), { mode: 0o700 });
	for (const name of [
		"host",
		"integration",
		"reflection-lifecycle",
		"memory-management",
		"capability-integration",
		"acceptance",
	]) {
		for (const output of [
			"evidence",
			"evidence/after",
			"evidence/before",
			"evidence/videos",
			".runtime",
		])
			await fs.mkdir(join(workspace, "prototypes/d6", name, output), {
				recursive: true,
				mode: 0o700,
			});
	}
	return { directory, workspace, before };
}

export function requireIsolation(url) {
	const root = process.env.D6_RUN_ROOT;
	const path = fileURLToPath(url);
	let valid = false;
	try {
		const marker = JSON.parse(readFileSync(join(root, ".d6-run.json"), "utf8"));
		valid =
			marker.workspace === realpathSync(root) &&
			marker.source !== marker.workspace;
	} catch {}
	if (!valid || !path.startsWith(`${resolve(root)}${sep}`))
		throw new Error(
			"D6 output requires an isolated run. Use node prototypes/d6/acceptance/scripts/run.mjs -- <command> from the repository root.",
		);
}

export async function verifySourceBoundary(url) {
	requireIsolation(url);
	const marker = JSON.parse(
		await fs.readFile(join(process.env.D6_RUN_ROOT, ".d6-run.json"), "utf8"),
	);
	const before = JSON.parse(
		await fs.readFile(
			join(process.env.D6_RUN_DIR, "source-before.json"),
			"utf8",
		),
	);
	const changed = difference(before, await inventory(marker.source));
	const output = new URL("../evidence/isolation.json", url);
	await fs.mkdir(new URL(".", output), { recursive: true });
	const value = {
		status: changed.length ? "changed" : "passed",
		initialFiles: Object.keys(before).length,
		changed,
		scope:
			"source plus ignored historical evidence, build output and runtime files; dependency trees excluded; run outputs separately inventoried",
	};
	await fs.writeFile(output, JSON.stringify(value, null, 2));
	console.log(JSON.stringify(value));
	if (changed.length) process.exitCode = 1;
}
