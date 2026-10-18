import { readFileSync } from "node:fs";
import { Type } from "typebox";

const VERSION = "v1";
const ALPHA = "td09_skill_alpha";
const BETA = "td09_skill_beta";
const valueSchema = Type.Object({
	value: Type.String(),
	readCanary: Type.Optional(Type.Boolean()),
});

function alphaDefinition(exposure = "deferred") {
	return {
		name: ALPHA,
		label: `TD-09 Alpha ${VERSION}`,
		description: `Return the Alpha fixture result from ${VERSION}. Search for TD-09 Alpha fixture.`,
		promptSnippet: "Use the TD-09 Alpha fixture for lifecycle checks.",
		parameters: valueSchema,
		exposure,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const harness = globalThis.__td09Harness;
			harness.alphaCalls.push({ version: VERSION, value: params.value });
			const gate = harness.gates.get(VERSION);
			if (gate) {
				harness.gates.delete(VERSION);
				gate.started();
				await gate.promise;
			}
			const details = {
				version: VERSION,
				pid: process.pid,
				cwd: ctx.cwd,
				value: params.value,
				canary: params.readCanary ? readFileSync(process.env.TD09_CANARY_PATH, "utf8").trim() : undefined,
			};
			harness.alphaResults.push(details);
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	};
}

export default function td09SpecialSkill(pi) {
	const harness = globalThis.__td09Harness;
	harness.extensionLoads.push(VERSION);
	harness.extensionReadEvidence.push({
		version: VERSION,
		pid: process.pid,
		canary: readFileSync(process.env.TD09_CANARY_PATH, "utf8").trim(),
	});

	let unsubscribeAgentStart = pi.on("agent_start", () => {
		harness.agentStartHooks.push(VERSION);
	});
	let unsubscribeToolCall = pi.on("tool_call", (event) => {
		harness.toolCallHooks.push({ version: VERSION, name: event.toolName });
	});

	pi.registerTool(alphaDefinition());
	pi.registerTool({
		name: BETA,
		label: `TD-09 Beta ${VERSION}`,
		description: `Return the Beta fixture result from ${VERSION}. Search for TD-09 Beta fixture.`,
		promptSnippet: "Use the TD-09 Beta fixture for lifecycle checks.",
		parameters: valueSchema,
		exposure: "deferred",
		async execute(_toolCallId, params) {
			return {
				content: [{ type: "text", text: `${VERSION}:${params.value}` }],
				details: { version: VERSION, value: params.value },
			};
		},
	});

	pi.registerTool({
		name: "td09_skill_gateway",
		label: "TD-09 Skill Gateway",
		description: "Call the deferred TD-09 Alpha tool through Pi nested tool execution.",
		parameters: Type.Object({ value: Type.String() }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const outcome = await ctx.executeTool(ALPHA, { value: params.value });
			const text = outcome.result.content.map((part) => part.type === "text" ? part.text : "").join("\n");
			return {
				content: [{ type: "text", text }],
				details: { nestedIsError: outcome.isError, nestedText: text },
			};
		},
	});

	pi.registerTool({
		name: "td09_skill_admin",
		label: "TD-09 Skill Lifecycle Controller",
		description: "Control fixture visibility and Hook subscriptions for the TD-09 experiment.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("remove-from-model"),
				Type.Literal("hide-alpha"),
				Type.Literal("disable-hooks"),
			]),
		}),
		async execute(_toolCallId, params) {
			if (params.action === "remove-from-model") {
				pi.setActiveTools(pi.getActiveTools().filter((name) => name !== ALPHA));
			} else if (params.action === "hide-alpha") {
				pi.registerTool(alphaDefinition("hidden"));
				pi.setActiveTools(pi.getActiveTools().filter((name) => name !== ALPHA));
			} else {
				unsubscribeAgentStart();
				unsubscribeToolCall();
				unsubscribeAgentStart = () => {};
				unsubscribeToolCall = () => {};
			}
			return {
				content: [{ type: "text", text: `Applied ${params.action} in ${VERSION}.` }],
				details: { version: VERSION, action: params.action },
			};
		},
	});
}
