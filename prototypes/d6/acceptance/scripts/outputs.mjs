import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { constants } from "node:fs";

export async function archiveOutputs(run) {
	async function copyEvidence(source, destination) {
		await fs.mkdir(destination, { recursive: true });
		for (const entry of await fs.readdir(source, { withFileTypes: true })) {
			const from = join(source, entry.name),
				to = join(destination, entry.name);
			if (entry.isSymbolicLink())
				throw new Error(`Evidence cannot contain links: ${from}`);
			if (entry.isDirectory()) await copyEvidence(from, to);
			else await fs.copyFile(from, to, constants.COPYFILE_EXCL);
		}
	}
	const outputs = {};
	async function collect(path, name = "") {
		for (const entry of await fs.readdir(path, { withFileTypes: true })) {
			if (["node_modules", ".git"].includes(entry.name)) continue;
			const absolute = join(path, entry.name),
				key = join(name, entry.name);
			if (entry.isSymbolicLink())
				outputs[key] = { link: await fs.readlink(absolute) };
			else if (entry.isDirectory()) {
				if (entry.name === "evidence") {
					await copyEvidence(absolute, join(run.directory, "evidence", name));
				}
				await collect(absolute, key);
			} else
				outputs[key] = {
					bytes: (await fs.stat(absolute)).size,
					category: key.includes(".runtime")
						? "temporary-product-data"
						: key.includes("evidence")
							? "run-evidence"
							: "source-or-build",
				};
		}
	}
	await collect(run.workspace);
	const secrets = new Set();
	for (const name of Object.keys(outputs).filter(
		(name) => name.includes(".runtime") && name.endsWith(".json"),
	)) {
		try {
			const value = JSON.parse(
				await fs.readFile(join(run.workspace, name), "utf8"),
			);
			for (const key of ["key", "token"])
				if (typeof value[key] === "string" && value[key].length > 20)
					secrets.add(value[key]);
		} catch {}
	}
	const redactor = spawn(
		"python3",
		[new URL("./redact.py", import.meta.url).pathname],
		{ stdio: ["pipe", "inherit", "inherit"] },
	);
	redactor.stdin.end(
		JSON.stringify({ directory: run.directory, secrets: [...secrets] }),
	);
	const redacted = await new Promise((done) => redactor.once("exit", done));
	if (redacted !== 0)
		throw new Error(
			"Evidence redaction failed; private workspace retained for diagnosis",
		);
	await fs.writeFile(
		join(run.directory, "output-inventory.json"),
		JSON.stringify(outputs),
		{ flag: "wx" },
	);
}
