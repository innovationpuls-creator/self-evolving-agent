import { Type } from "typebox";

export default function reflectionProbeExtension(pi) {
  pi.registerTool({
    name: "reflection_probe",
    label: "Reflection probe",
    description: "Return a deterministic marker from the bundled prototype extension.",
    parameters: Type.Object({ note: Type.String() }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `reflection-extension:${params.note}` }],
        details: { extension: "reflection-probe" },
      };
    },
  });
}
