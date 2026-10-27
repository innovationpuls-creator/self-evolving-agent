import { requireIsolation } from "../scripts/isolation.mjs";
requireIsolation(import.meta.url);
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { AgentService } from "../../../../apps/host/runtime/agent";

for (const phase of ["executor-start", "before-first-effect"]) {
	test(`Reflection diagnostic retention at ${phase}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "reflection-diagnostics-"));
		const host = new AgentService(join(root, "data"), randomBytes(32), {
			reflectionDelayMs: 0,
			reflectionExecutor: {
				async available() {
					return { available: true };
				},
				async execute(_start, handle) {
					if (phase === "before-first-effect")
						await handle("model", {
							modelId: "reflection-host-approved",
							context: {
								messages: [
									{ role: "user", content: "Synthetic diagnostic probe" },
								],
							},
						});
					throw new Error(`SYNTHETIC_${phase}`);
				},
			},
		});
		try {
			await host.init();
			const fake = fauxProvider({
				models: [{ id: "diagnostic" }],
				tokensPerSecond: 100000,
			});
			host.runtime.registerNativeProvider(fake.provider);
			fake.setResponses([
				fauxAssistantMessage("ordinary task ended"),
				fauxAssistantMessage("controlled reflection response"),
			]);
			const session = await host.create(root, fake.provider.id, "diagnostic");
			await host.prompt(session.id, "Synthetic task");
			const end = Date.now() + 10000;
			while (host.reflection.jobs.list()[0]?.status !== "failed") {
				assert.ok(Date.now() < end);
				await new Promise((done) => setTimeout(done, 10));
			}
			const job = host.reflection.jobs.list()[0];
			const record = host.reflection.list()[0];
			assert.equal(record.changes.length, 0);
			assert.ok(
				!JSON.stringify({ job, record }).includes(`SYNTHETIC_${phase}`),
			);
			await mkdir(new URL("../evidence/", import.meta.url), {
				recursive: true,
			});
			await writeFile(
				new URL(`../evidence/reflection-error-${phase}.json`, import.meta.url),
				JSON.stringify(
					{
						injectedFailure: `SYNTHETIC_${phase}`,
						job,
						record,
						observation:
							"Persisted failure has no original exception or phase; zero effects is not evidence of a persistence failure",
					},
					null,
					2,
				),
				{ flag: "wx" },
			);
		} finally {
			await host.close();
		}
	});
}
