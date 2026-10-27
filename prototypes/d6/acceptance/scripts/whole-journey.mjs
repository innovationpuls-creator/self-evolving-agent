import { requireIsolation } from "./isolation.mjs";
requireIsolation(import.meta.url);
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
	api,
	launch,
	context,
	url,
	record,
	check,
	save,
	shot,
} from "../../capability-integration/scripts/common.mjs";
const runtime = new URL(
	"../../capability-integration/.runtime/",
	import.meta.url,
);
const m = JSON.parse(await fs.readFile(new URL("manifest.json", runtime)));
const b = await launch({ slowMo: 100 });
const poll = async (fn) => {
	const deadline = Date.now() + 45000;
	while (Date.now() < deadline) {
		const v = await fn();
		if (v) return v;
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error("user journey deadline");
};
async function control(steps) {
	const id = randomUUID();
	await fs.writeFile(
		new URL("control.json", runtime),
		JSON.stringify({ id, steps }),
		{ mode: 0o600 },
	);
	await poll(async () => {
		try {
			return (
				JSON.parse(await fs.readFile(new URL("control-result.json", runtime)))
					.id === id
			);
		} catch {
			return false;
		}
	});
}
try {
	for (const width of [1440, 850, 390]) {
		const c = await context(b, width, true),
			p = await c.newPage();
		p.setDefaultTimeout(12000);
		record(p, width);
		await c.tracing.start({ screenshots: true, snapshots: true });
		const nav = async (name) => {
			if (!(await p.locator(".sidebar").isVisible()))
				await p.getByRole("button", { name: "打开导航", exact: true }).click();
			await p
				.getByRole("navigation", { name: "主要模块", exact: true })
				.getByRole("button", { name, exact: true })
				.click();
		};
		await check(
			"新建会话→读取文件→实际Tool结果→继续讨论→跨会话查找→Memory修订来源→原生Reflection→返回任务",
			width,
			async () => {
				await p.goto(url({ page: "session", sessionId: m.sourceSession }));
				if (!(await p.locator(".sidebar").isVisible()))
					await p
						.getByRole("button", { name: "打开导航", exact: true })
						.click();
				await p.getByRole("button", { name: "新会话", exact: true }).click();
				await p.getByLabel("Host 工作目录").fill(m.sourceProject);
				await p.getByRole("button", { name: "创建会话", exact: true }).click();
				await p.getByLabel("发送给 Agent", { exact: true }).waitFor();
				const id = JSON.parse(new URL(p.url()).searchParams.get("r")).sessionId;
				assert.ok(id && id !== m.sourceSession);
				const file = `${m.sourceProject}/request-policy-${width}.md`;
				await fs.writeFile(
					file,
					"# 项目请求规则\n\n最多重试 3 次，单次超时 12 秒。\n",
				);
				const title = `项目请求规则 ${width}`;
				await control([
					{ tool: "read", args: { path: file } },
					{ text: "文件规定最多重试 3 次，单次超时 12 秒。" },
				]);
				const composer = p.getByLabel("发送给 Agent", { exact: true });
				await composer.fill(
					`请读取 request-policy-${width}.md，核对项目请求规则。`,
				);
				await p.getByRole("button", { name: "发送任务", exact: true }).click();
				await poll(async () => {
					const s = (await api(`/sessions/${id}`)).data;
					return !s.busy && s.messages.some((e) => e.role === "toolResult");
				});
				await p.locator(".execution-summary > summary").first().click();
				await shot(p, "journey-tool", width);
				const view = (await api(`/sessions/${id}`)).data;
				assert.ok(
					view.messages.some(
						(e) =>
							e.role === "toolResult" &&
							JSON.stringify(e.content).includes("12"),
					),
				);
				await control([
					{
						tool: "memory_save",
						args: {
							knowledge: {
								title,
								content: "当前项目最多重试 3 次，单次超时 12 秒。",
								kind: "fact",
								scope: "project",
							},
							reason: "来自本轮项目规则文件核对",
						},
					},
					{ text: "已记录当前项目请求规则，可在记忆中查看本次来源。" },
				]);
				await composer.fill("将刚才核对的项目规则记为项目事实，并保留来源。");
				await p.getByRole("button", { name: "发送任务", exact: true }).click();
				const memory = await poll(async () => {
					const r = (
						await api(
							`/memory?${new URLSearchParams({ project: m.sourceProject, query: title })}`,
						)
					).data;
					return r.items?.find((e) => e.title === title);
				});
				await poll(async () => !(await api(`/sessions/${id}`)).data.busy);
				await composer.fill("返回后继续核对请求失败时的处理。");
				await nav("记忆");
				await p.getByLabel("搜索记忆内容").fill(title);
				await p.locator(".aw-memory-row").filter({ hasText: title }).click();
				await p.getByRole("button", { name: "编辑记忆", exact: true }).click();
				await p
					.getByLabel("知识内容")
					.fill("当前项目最多重试 3 次，单次超时 12 秒；只重试临时网络失败。");
				const reason = p.getByLabel("修改依据");
				await reason.fill("明确请求重试适用范围");
				await p.getByRole("button", { name: "保存修订", exact: true }).click();

				await poll(
					async () =>
						(
							await api(
								`/memory/${memory.id}?${new URLSearchParams({ project: m.sourceProject, includeHistory: "true" })}`,
							)
						).data.current.revision === 2,
				);
				const viewSaved = p.getByRole("button", {
					name: "查看记录",
					exact: true,
				});
				if (await viewSaved.count()) await viewSaved.click();
				await shot(p, "journey-memory", width);
				// Start a native signed Worker only after the foreground task and deterministic responses settle.
				await control([{ text: "本次没有新增发现。" }]);
				await api("/reflections/expedite", "POST", { sessionId: id });
				const job = await poll(async () => {
					const jobs = (await api(`/reflections?view=summary&sessionId=${id}`))
						.data.jobs;
					return jobs?.find((j) =>
						["succeeded", "failed", "waiting_user", "interrupted"].includes(
							j.status,
						),
					);
				});
				assert.equal(job.status, "succeeded", JSON.stringify(job));
				await nav("反思记录");
				// Session-specific catalogue is reached via the task's contextual action below.
				if (!(await p.locator(".sidebar").isVisible()))
					await p
						.getByRole("button", { name: "打开导航", exact: true })
						.click();
				const search = p.getByRole("button", { name: /搜索会话/ });
				await search.click();
				const searchbox = p.getByRole("textbox", { name: /搜索/ });
				await searchbox.fill(`request-policy-${width}.md`);
				await p
					.getByRole("dialog")
					.getByRole("button")
					.filter({ hasText: `request-policy-${width}.md` })
					.first()
					.click();
				assert.equal(
					await composer.inputValue(),
					"返回后继续核对请求失败时的处理。",
				);
				await p.locator('[data-focus="session-reflections"]').click();
				await p.locator(`[data-job="${job.id}"]`).click();
				await shot(p, "journey-reflection", width);
				const evidenceToggle = p.locator(
					".host-reflection-references > summary",
				);
				if (await evidenceToggle.count()) await evidenceToggle.click();
				const firstSource = p.locator('[data-focus="evidence-0"]');
				if (await firstSource.count()) {
					await firstSource.click();
					await p
						.getByRole("heading", { name: "依据与来源", exact: true })
						.waitFor();
					await shot(p, "journey-source", width);
				}
				return {
					session: id,
					memory: memory.id,
					memoryRevision: 2,
					reflection: job,
					mode: "Faux instructions; real Pi tools, encrypted formal Host, signed native Reflection Worker",
				};
			},
		);
		await check(
			"短窗口授权与长内容：权限提示和确认按钮可达，无横向页面溢出",
			width,
			async () => {
				await p.setViewportSize({ width, height: 520 });
				await p.goto(url({ page: "session", sessionId: m.sourceSession }));
				const a = (
					await api("/activities", "POST", {
						sessionId: m.sourceSession,
						goal: "核对短窗口下的授权范围与执行权限，保留完整任务背景。".repeat(
							30,
						),
					})
				).data;
				await p.goto(url({ page: "session", sessionId: a.sessionId }));
				await p
					.getByRole("button", { name: "审阅开发授权", exact: true })
					.click();
				const dialog = p.getByRole("dialog");
				const risk = dialog.getByText(/当前没有操作系统沙箱/);
				await risk.scrollIntoViewIfNeeded();
				assert.ok(await risk.isVisible());
				await shot(p, "short-authorization", width);
				const cancel = dialog.getByRole("button", {
					name: "返回讨论",
					exact: true,
				});
				await cancel.scrollIntoViewIfNeeded();
				const box = await cancel.boundingBox();
				assert.ok(
					box && box.y >= 0 && box.y + box.height <= 520,
					JSON.stringify(box),
				);
				await cancel.click();
				assert.ok(
					await p.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				);
				return {
					height: 520,
					cancellationControl: box,
					permissionNoticeReachable: true,
				};
			},
		);
		await c.tracing.stop({
			path: new URL(
				`../../capability-integration/evidence/whole-journey-${width}.zip`,
				import.meta.url,
			).pathname,
		});
		const video = p.video();
		await c.close();
		await video.saveAs(
			new URL(
				`../../capability-integration/evidence/videos/whole-journey-${width}.webm`,
				import.meta.url,
			).pathname,
		);
	}
	await save("whole-journey");
} finally {
	await b.close();
}
