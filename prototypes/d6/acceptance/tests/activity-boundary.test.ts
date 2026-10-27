import { requireIsolation } from "../scripts/isolation.mjs";
requireIsolation(import.meta.url);
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { startHost } from "../../../../apps/host/transport/server";

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const wait = async (check: () => boolean | Promise<boolean>) => {
	const deadline = Date.now() + 15000;
	while (!(await check())) {
		assert.ok(Date.now() < deadline, "controlled probe deadline");
		await new Promise((done) => setTimeout(done, 20));
	}
};

test("Activity OS boundary: synthetic canaries only; no user files or credentials", async () => {
	const root = await mkdtemp(join(tmpdir(), "activity-boundary-"));
	const project = join(root, "project");
	await mkdir(project);
	const outside = join(root, "outside-candidate.txt");
	await writeFile(outside, "synthetic-readable-canary");
	process.env.D6_SYNTHETIC_SECRET = "synthetic-env-canary";
	const server = createServer((_req, res) =>
		res.end("synthetic-loopback-canary"),
	);
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const port = (server.address() as { port: number }).port;
	const host = await startHost({
		dataDir: join(root, "data"),
		key: randomBytes(32),
		token: randomBytes(32).toString("hex"),
	});
	const fake = fauxProvider({
		models: [{ id: "boundary" }],
		tokensPerSecond: 100000,
	});
	host.service.runtime.registerNativeProvider(fake.provider);
	const evidence: Record<string, unknown> = {
		mode: "real formal Host + Pi native Tools; deterministic Faux instructions; synthetic canaries",
		root,
	};
	try {
		const session = await host.service.create(
			project,
			fake.provider.id,
			"boundary",
		);
		const activity = await host.service.createActivity(
			session.id,
			"Controlled permission audit on synthetic canaries",
		);
		const call = async (
			name: string,
			args: Parameters<typeof fauxToolCall>[1],
		) => {
			const id = `canary-${Date.now()}-${Math.random()}`;
			fake.setResponses([
				fauxAssistantMessage(fauxToolCall(name, args, { id }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("Controlled probe completed."),
			]);
			await host.service.prompt(
				activity.sessionId,
				"Run the controlled canary probe.",
			);
			await wait(
				async () => !(await host.service.viewSession(activity.sessionId)).busy,
			);
			const view = await host.service.viewSession(activity.sessionId);
			const result = view.messages.find(
				(m) => m.role === "toolResult" && m.toolCallId === id,
			);
			assert.ok(result?.role === "toolResult", `missing ${name} result`);
			return result;
		};
		evidence.beforeGrant = await call("bash", {
			command: "echo must-not-execute",
		});
		assert.ok((evidence.beforeGrant as { isError: boolean }).isError);
		fake.setResponses([fauxAssistantMessage("Controlled grant received.")]);
		await host.service.authorizeActivity(activity.id, {
			baseRevision: activity.revision,
			goal: activity.goal,
			existingSkills: [],
			newSkills: ["boundary-canary"],
		});
		await wait(
			async () => !(await host.service.viewSession(activity.sessionId)).busy,
		);
		evidence.outsideWriteTool = await call("write", {
			path: outside,
			content: "must-not-write",
		});
		assert.ok((evidence.outsideWriteTool as { isError: boolean }).isError);
		assert.equal(await readFile(outside, "utf8"), "synthetic-readable-canary");
		const script = `const fs=require('node:fs');const cp=require('node:child_process');(async()=>{const before=fs.readFileSync(${JSON.stringify(outside)},'utf8');fs.writeFileSync(${JSON.stringify(outside)},'synthetic-shell-write');const response=await fetch('http://127.0.0.1:${port}/');console.log(JSON.stringify({before,env:process.env.D6_SYNTHETIC_SECRET,network:await response.text(),uid:process.getuid(),child:cp.execFileSync(process.execPath,['-e','process.stdout.write(process.env.D6_SYNTHETIC_SECRET)'],{encoding:'utf8'})}));})()`;
		const shell = await call("bash", {
			command: `${quote(process.execPath)} -e ${quote(script)}`,
			timeout: 10,
		});
		const text = shell.content
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		assert.ok(!shell.isError, text);
		for (const canary of [
			"synthetic-readable-canary",
			"synthetic-env-canary",
			"synthetic-loopback-canary",
		])
			assert.ok(text.includes(canary), text);
		assert.equal(await readFile(outside, "utf8"), "synthetic-shell-write");
		evidence.shell = shell;
		// A detached child writes only this test-owned marker, then exits on its own.
		const residual = join(root, "post-cancel-child.txt");
		const detached = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(residual)},'synthetic-child-after-cancel'),1200)`)}],{detached:true,stdio:'ignore'});c.unref();console.log(c.pid)`;
		evidence.detachedSpawn = await call("bash", {
			command: `${quote(process.execPath)} -e ${quote(detached)}`,
			timeout: 5,
		});
		await host.service.cancelActivity(activity.id);
		await wait(async () => {
			try {
				return (
					(await readFile(residual, "utf8")) === "synthetic-child-after-cancel"
				);
			} catch {
				return false;
			}
		});
		evidence.afterCancel = {
			status: host.service.activities.get(activity.id).status,
			detachedChildWrote: true,
		};
		const denied = await call("bash", { command: "echo must-not-execute" });
		assert.ok(denied.isError);
		evidence.newCallAfterCancel = denied;
		evidence.conclusion =
			"write/edit and grant state enforce application checks; shell inherits user filesystem/environment/loopback/subprocess authority; completed-shell detached child outlives Activity cancellation";
	} finally {
		delete process.env.D6_SYNTHETIC_SECRET;
		await host.close();
		await new Promise<void>((done) => server.close(() => done()));
		await mkdir(new URL("../evidence/", import.meta.url), { recursive: true });
		await writeFile(
			new URL("../evidence/activity-boundary.json", import.meta.url),
			JSON.stringify(evidence, null, 2),
			{ flag: "wx" },
		);
	}
});
