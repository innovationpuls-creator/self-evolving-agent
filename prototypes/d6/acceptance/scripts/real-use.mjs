import { requireIsolation } from "./isolation.mjs";
requireIsolation(import.meta.url);
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import {
	api,
	launch,
	context,
	url,
	record,
	check,
	shot,
	save,
	out,
} from "../../capability-integration/scripts/common.mjs";
const runtime = new URL(
	"../../capability-integration/.runtime/",
	import.meta.url,
);
const poll = async (read) => {
	const deadline = Date.now() + 180000;
	while (Date.now() < deadline) {
		const value = await read();
		if (value) return value;
		await new Promise((done) => setTimeout(done, 500));
	}
	throw new Error("real model task deadline");
};
const b = await launch({ slowMo: 120 });
const c = await context(b, 1440, true),
	p = await c.newPage();
p.setDefaultTimeout(15000);
record(p, 1440);
const events = [];
p.on("websocket", (ws) =>
	ws.on("framereceived", ({ payload }) => {
		try {
			const data = JSON.parse(payload);
			events.push({ type: data.type, event: data.event?.type });
		} catch {}
	}),
);
await c.tracing.start({ screenshots: true, snapshots: true });
try {
	await check(
		"真实模型普通任务→实际文件Tool→原生Reflection→来源→返回草稿",
		1440,
		async () => {
			// Use the product's existing import operation. No credential value is read or logged by the test.
			const imported = await api("/credentials", "POST", {
				provider: "openai-codex",
				importExisting: true,
			});
			assert.equal(
				imported.status,
				200,
				"existing configured provider credential is required; no mock fallback",
			);
			const model = (await api("/models")).data.models.find(
				(m) => m.provider === "openai-codex" && m.id === "gpt-6-luna",
			);
			assert.ok(model, "existing real model unavailable");
			const project = new URL("projects/real-user-task/", runtime).pathname;
			await fs.mkdir(project, { recursive: true });
			await fs.writeFile(
				`${project}POLICY.md`,
				"# 项目请求策略\n\n请求最多重试 3 次，单次超时 12 秒。只在临时网络错误时重试。\n",
			);
			const created = await api("/sessions", "POST", {
				cwd: project,
				provider: model.provider,
				model: model.id,
			});
			assert.equal(created.status, 201);
			const id = created.data.id;
			await p.goto(url({ page: "session", sessionId: id }));
			const composer = p.getByLabel("发送给 Agent", { exact: true });
			await composer.fill(
				"请读取 POLICY.md，核对项目请求的重试次数、超时和重试条件，并说明依据。本任务只核对配置，不开发技能，不修改项目文件。",
			);
			await p.getByRole("button", { name: "发送任务", exact: true }).click();
			const session = await poll(async () => {
				const s = (await api(`/sessions/${id}`)).data;
				return !s.busy && s.messages.some((m) => m.role === "assistant") && s;
			});
			assert.ok(!session.error, session.error);
			assert.ok(
				session.messages.some(
					(m) =>
						m.role === "toolResult" &&
						!m.isError &&
						JSON.stringify(m.content).includes("12"),
				),
				"actual file Tool result required",
			);
			assert.ok(
				!session.messages.some(
					(m) => m.role === "assistant" && m.stopReason === "error",
				),
				"model error",
			);
			await composer.fill("返回后继续核对重试失败的处理。");
			await shot(p, "real-task", 1440);
			await api("/reflections/expedite", "POST", { sessionId: id });
			const job = await poll(async () => {
				const catalog = (await api(`/reflections?view=summary&sessionId=${id}`))
					.data;
				return catalog.jobs.find(
					(j) => !["pending", "running"].includes(j.status),
				);
			});
			const detail = (await api(`/reflections/${job.id}`)).data;
			await fs.writeFile(
				new URL("real-use-actual.json", out),
				JSON.stringify({ model, job, record: detail.record, events }, null, 2),
			);
			assert.equal(job.status, "succeeded", JSON.stringify(job));
			await p.locator('[data-focus="session-reflections"]').click();
			await p.locator(`[data-job="${job.id}"]`).click();
			await shot(p, "real-reflection", 1440);
			// Findings may be empty; the test never demands a specific autonomous Memory change.
			const toggle = p.locator(".host-reflection-references > summary");
			if (await toggle.count()) await toggle.click();
			const source = p.locator('[data-focus="evidence-0"]');
			if (await source.count()) {
				await source.click();
				await p
					.getByRole("heading", { name: "依据与来源", exact: true })
					.waitFor();
				await shot(p, "real-source", 1440);
				await p.goBack();
			}
			await p.goBack();
			await p.goBack();
			assert.equal(
				await composer.inputValue(),
				"返回后继续核对重试失败的处理。",
			);
			for (const width of [850, 390]) {
				await p.setViewportSize({ width, height: 844 });
				await shot(p, "real-reentry", width);
				assert.ok(
					await p.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				);
			}
			return {
				session: id,
				model,
				status: job.status,
				changes: detail.record?.changes,
				streamingUpdates: events.filter((e) => e.event === "message_update")
					.length,
			};
		},
	);
} finally {
	await save("real-use");
	await c.tracing.stop({ path: new URL("real-use.zip", out).pathname });
	const video = p.video();
	await c.close();
	await video.saveAs(new URL("videos/real-use-1440.webm", out).pathname);
	await b.close();
}
