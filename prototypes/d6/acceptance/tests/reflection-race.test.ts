const required = <T>(value: T | undefined): T => {
	assert.notEqual(value, undefined);
	return value as T;
};
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import {
	fauxAssistantMessage,
	fauxToolCall,
	type AssistantMessage,
} from "@earendil-works/pi-ai";
import { AgentService } from "../../../../apps/host/runtime/agent";
import { snapshot } from "../../../../apps/host/storage/storage";
import type { ReflectionExecutor } from "../../../../apps/host/reflection/reflection-service";

const evidence: unknown[] = [];
const base = fileURLToPath(new URL("..", import.meta.url));
const output = join(base, `evidence/persistence-${process.pid}.json`);
await mkdir(join(base, "evidence"), { recursive: true });
const waitFor = async (check: () => boolean) => {
	const until = Date.now() + 20000;
	while (!check()) {
		assert.ok(Date.now() < until, "Reflection deadline");
		await new Promise((r) => setTimeout(r, 10));
	}
};

for (const outcome of ["succeeded", "failed", "interrupted"] as const) {
	test(`committed effects survive reflection_save, ${outcome}, restart and duplicate Tool Call`, async () => {
		const root = resolve(
			base,
			`.runtime/mechanism-${process.env.D6_SAMPLE_ID || "collision-control"}-${outcome}-${Date.now()}`,
		);
		await mkdir(root, { recursive: true });
		const key = randomBytes(32);
		let committed = false;
		const timeline: unknown[] = [];
		let exception: unknown;
		const note = (event: string, value?: unknown) =>
			timeline.push({ at: performance.now(), event, value });
		const stages: unknown[] = [];
		let host: AgentService;
		const executor: ReflectionExecutor = {
			async available() {
				note("executor.available");
				return { available: true };
			},
			async execute(start, handle, signal) {
				note("executor.start", start);
				try {
					const run = start as { sessionId: string; project: string };
					const manager = SessionManager.inMemory(run.project, {
						id: run.sessionId,
					});
					const invoke = async () => {
						note("model.request");
						const message = (await handle("model", {
							modelId: "reflection-host-approved",
							context: {
								messages: [
									{
										role: "user",
										content:
											"Controlled mechanism test, not real model behavior.",
									},
								],
							},
						})) as AssistantMessage;
						note("model.response", message);
						manager.appendMessage(message);
						await handle("checkpoint", snapshot(manager));
						const call = message.content.find((p) => p.type === "toolCall");
						assert.ok(call?.type === "toolCall");
						note("checkpoint.saved");
						const input = {
							name: call.name,
							toolCallId: call.id,
							args: call.arguments,
						};
						const attempts =
							call.name === "memory_save"
								? await Promise.all([
										handle("tool", input),
										handle("tool", input),
									])
								: [await handle("tool", input)];
						const first = attempts.find(
							(value) => !(value as { isError?: boolean }).isError,
						) as {
							content: unknown[];
							isError?: boolean;
						};
						assert.ok(first, "one committed outcome must be observable");
						assert.ok(!first.isError, JSON.stringify(first));
						const repeated = (await handle("tool", input)) as {
							content: unknown[];
						};
						assert.deepEqual(
							repeated.content,
							first.content,
							"same persisted result content on replay",
						);
						const record = required(host.reflection.list()[0]);
						stages.push({
							after: call.name,
							summary: record.summary,
							changes: record.changes,
						});
						return record;
					};
					const afterMemory = await invoke();
					assert.equal(afterMemory.changes.length, 1);
					const afterSuggestion = await invoke();
					assert.equal(afterSuggestion.changes.length, 2);
					const afterSummary = await invoke();
					assert.deepEqual(
						afterSummary.changes,
						afterSuggestion.changes,
						"summary must retain earlier effects",
					);
					assert.equal(afterSummary.summary, "受控机制总结");
					committed = true;
					if (outcome === "failed")
						throw new Error("controlled post-commit execution failure");
					if (outcome === "interrupted") {
						await new Promise<void>((_done, reject) => {
							signal.addEventListener("abort", () => reject(signal.reason), {
								once: true,
							});
							if (signal.aborted) reject(signal.reason);
						});
					}
					await handle("complete", {});
					stages.push({
						after: "complete",
						changes: required(host.reflection.list()[0]).changes,
					});
				} catch (error) {
					exception =
						error instanceof Error
							? { name: error.name, message: error.message, stack: error.stack }
							: String(error);
					note("executor.error", exception);
					throw error;
				}
			},
		};
		host = new AgentService(join(root, "data"), key, {
			reflectionExecutor: executor,
			reflectionDelayMs: 0,
		});
		try {
			await host.init();
			note("host.init");
			const fake = fauxProvider({
				models: [{ id: "mechanism" }],
				tokensPerSecond: 100000,
			});
			host.runtime.registerNativeProvider(fake.provider);
			fake.setResponses([
				fauxAssistantMessage("ordinary task has no Memory writes"),
				fauxAssistantMessage(
					fauxToolCall("memory_save", {
						knowledge: {
							title: "受控机制事实",
							content: "用于验证事务保存，不代表模型自主发现。",
							kind: "fact",
							scope: "project",
						},
						reason: "isolated mechanism fixture",
						evidence: [],
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall("suggestion_submit", {
						title: "受控建议",
						goal: "机制测试",
						reason: "fixture",
						value: "test",
						uncertainty: "controlled",
						action: "do not execute",
						evidence: [],
						priority: "normal",
					}),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage(
					fauxToolCall("reflection_save", {
						summary: "受控机制总结",
						findings: [],
						uncertainties: [],
						evidence: [],
					}),
					{ stopReason: "toolUse" },
				),
			]);
			const session = await host.create(root, fake.provider.id, "mechanism");
			note("prompt.before");
			await host.prompt(session.id, "isolated ordinary task");
			note("prompt.returned", await host.viewSession(session.id));
			await waitFor(
				() => committed || host.reflection.jobs.list()[0]?.status === "failed",
			);
			note("wait.returned", host.reflection.jobs.list());
			assert.equal(
				committed,
				true,
				JSON.stringify({
					stages,
					exception,
					jobs: host.reflection.jobs.list(),
				}),
			);
			if (outcome === "interrupted") await host.reflection.close();
			await waitFor(() => host.reflection.jobs.list()[0]?.status === outcome);
			const before = required(host.reflection.list()[0]);
			assert.equal(before.status, outcome);
			assert.equal(before.changes.length, 2);
			assert.equal(
				host.memory.search({ actor: "user", project: root }).total,
				1,
			);
			assert.equal(host.evolution.list({ actor: "user" }, {}).total, 1);
			await host.close();
			const db = new DatabaseSync(join(root, "data/product.sqlite"));
			const stored = JSON.parse(
				String(
					required(
						db
							.prepare("SELECT data FROM reflections WHERE id=?")
							.get(before.id),
					).data,
				),
			);
			const effectCount = Number(
				required(
					db.prepare("SELECT count(*) AS n FROM reflection_effects").get(),
				).n,
			);
			db.close();
			assert.equal(stored.changes.length, 2);
			assert.equal(
				effectCount,
				3,
				"one row per effect including summary despite repeated calls",
			);
			host = new AgentService(join(root, "data"), key, {
				reflectionExecutor: executor,
				reflectionDelayMs: 0,
			});
			await host.init();
			const recovered = host.reflection.get(before.id);
			assert.deepEqual(recovered.changes, before.changes);
			assert.equal(recovered.status, outcome);
			assert.equal(host.reflection.jobs.list().length, 1);
			evidence.push({
				mode: "controlled formal Host mechanism, Faux model",
				outcome,
				stages,
				effectCount,
				reopenedStatus: recovered.status,
				preservedChanges: recovered.changes,
				passed: true,
			});
			await writeFile(output, JSON.stringify(evidence, null, 2));
		} catch (error) {
			note(
				"test.error",
				error instanceof Error
					? { name: error.name, message: error.message, stack: error.stack }
					: String(error),
			);
			throw error;
		} finally {
			await mkdir(join(base, "evidence"), { recursive: true });
			await writeFile(
				join(base, `evidence/diagnostic-${process.pid}-${outcome}.json`),
				JSON.stringify(
					{
						outcome,
						committed,
						stages,
						timeline,
						exception,
						jobs: host.reflection?.jobs.list(),
						records: host.reflection?.list(),
					},
					null,
					2,
				),
			);
			await host.close();
		}
	});
}
