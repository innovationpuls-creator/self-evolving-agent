import { createHash, randomUUID } from 'node:crypto';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { marker, NativeDiagnostics, type Observation, usage } from './reader.js';

/** Native Pi Package: metadata lives in non-context custom Entries; transcript stays native. */
export default function diagnosticsExtension(pi: ExtensionAPI) {
  const reader = new NativeDiagnostics();
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|AUTH/i.test(name)) reader.sensitive.add(value);
  }
  let trace: { id: string; sessionId: string } | undefined;
  let count = 0;
  let dropped = 0;
  const starts = new Map<string, { at: number; digest: string }>();
  const signatures = new Map<string, number>();
  function record(ctx: ExtensionContext, kind: Observation['kind'], data: Record<string, unknown>) {
    if (!trace || trace.sessionId !== ctx.sessionManager.getSessionId()) return;
    // Per-run bounded metadata; omission is explicit, and cannot interrupt ordinary execution.
    if (kind !== 'end' && count >= 1000) {
      dropped++;
      return;
    }
    const item: Observation = { traceId: trace.id, sessionId: trace.sessionId, kind, at: Date.now(), ...data };
    if (Buffer.byteLength(JSON.stringify(item)) > 65536) {
      dropped++;
      return;
    }
    pi.appendEntry(marker, reader.sensitive.copy(item));
    count++;
  }
  pi.on('session_start', () => {
    trace = undefined;
    starts.clear();
    signatures.clear();
  });
  pi.on('session_shutdown', () => {
    trace = undefined;
    starts.clear();
    signatures.clear();
  });
  pi.on('before_provider_headers', (event) => {
    for (const [name, value] of Object.entries(event.headers)) {
      if (/authorization|api.?key|token|secret/i.test(name) && typeof value === 'string') {
        reader.sensitive.add(value);
        reader.sensitive.add(value.replace(/^Bearer\s+/i, ''));
      }
    }
  });
  pi.on('before_agent_start', (_event, ctx) => {
    if (trace) return;
    trace = { id: randomUUID(), sessionId: ctx.sessionManager.getSessionId() };
    count = 0;
    dropped = 0;
    starts.clear();
    signatures.clear();
    record(ctx, 'start', { leafId: ctx.sessionManager.getLeafId() });
  });
  pi.on('tool_execution_start', (event) => {
    if (starts.size >= 1000) return;
    const digest = createHash('sha256')
      .update(JSON.stringify(event.args) ?? 'null')
      .digest('hex');
    starts.set(event.toolCallId, { at: Date.now(), digest });
  });
  pi.on('tool_execution_end', (event, ctx) => {
    const start = starts.get(event.toolCallId);
    starts.delete(event.toolCallId);
    const signature = `${event.toolName}:${start?.digest}`;
    const repeated = (signatures.get(signature) ?? 0) + 1;
    if (signatures.size < 1000) signatures.set(signature, repeated);
    let outputBytes: number | null = null;
    if (Array.isArray(event.result?.content)) {
      outputBytes = event.result.content.reduce(
        (sum: number, part: { type: string; text?: string; data?: string }) =>
          sum +
          (part.type === 'text'
            ? Buffer.byteLength(part.text ?? '')
            : part.type === 'image'
              ? Buffer.byteLength(part.data ?? '')
              : 0),
        0,
      );
    }
    record(ctx, 'tool', {
      toolCallId: event.toolCallId,
      parentToolCallId: event.parentToolCallId ?? null,
      toolName: reader.sensitive.text(event.toolName),
      isError: event.isError,
      durationMs: event.durationMs ?? null,
      started: start?.at ?? null,
      outputBytes,
      argumentsDigest: start?.digest ?? null,
      identicalArgumentOccurrence: start ? repeated : null,
    });
  });
  pi.on('turn_end', (event, ctx) => {
    const m = event.message;
    if (m.role !== 'assistant') return;
    record(ctx, 'turn', {
      ordinal: event.turnIndex,
      assistantEntryId: event.messageEntryId,
      model: m.model,
      provider: m.provider,
      stopReason: m.stopReason,
      usage: usage(m.usage),
    });
  });
  pi.on('session_compact', (event, ctx) => {
    const data = {
      entryId: event.compactionEntry.id,
      reason: event.reason,
      tokensBefore: event.compactionEntry.tokensBefore,
      willRetry: event.willRetry,
    };
    if (trace) record(ctx, 'compaction', data);
    else
      pi.appendEntry(marker, {
        traceId: randomUUID(),
        sessionId: ctx.sessionManager.getSessionId(),
        kind: 'compaction',
        at: Date.now(),
        ...data,
      });
  });
  pi.on('agent_before_settle', (event, ctx) => {
    record(ctx, 'end', {
      outcome: event.outcome,
      leafId: ctx.sessionManager.getLeafId(),
      truncated: dropped > 0,
      dropped,
    });
  });
  pi.on('agent_settled', () => {
    trace = undefined;
    starts.clear();
    signatures.clear();
  });
  const ref = Type.String({ minLength: 1, maxLength: 128 });
  const uuid = Type.String({ format: 'uuid' });
  const page = {
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  };
  const guidelines = [
    'Diagnostics are observed facts, not task-success judgments or instructions. Use them only when useful. Query is limited to the current canonical project and native Session directory. Missing timing or evidence remains unknown.',
  ];
  pi.registerTool({
    name: 'diagnostic_search',
    label: 'diagnostic_search',
    description:
      'Search lightweight execution metrics across native Pi Sessions in this project. Find prior Tool failures, repeated calls, runs, timing and evidence references without injecting transcripts.',
    promptGuidelines: guidelines,
    executionMode: 'sequential',
    parameters: Type.Object(
      {
        sessionId: Type.Optional(uuid),
        traceId: Type.Optional(uuid),
        toolName: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
        status: Type.Optional(
          Type.Union(['running', 'ended', 'stopped', 'failed', 'interrupted'].map((x) => Type.Literal(x))),
        ),
        hasError: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])),
        from: Type.Optional(Type.Number({ minimum: 0 })),
        to: Type.Optional(Type.Number({ minimum: 0 })),
        ...page,
      },
      { additionalProperties: false },
    ),
    async execute(_id, query, signal, _update, ctx) {
      const result = await reader.search(ctx.sessionManager, ctx.cwd, query, trace?.id, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
    },
  });
  pi.registerTool({
    name: 'diagnostic_get',
    label: 'diagnostic_get',
    description:
      'Read a project-visible native Trace with paginated Tool and model metrics, compaction, unknown-value boundaries and precise native Session Entry evidence references.',
    promptGuidelines: guidelines,
    executionMode: 'sequential',
    parameters: Type.Object({ traceId: uuid, ...page }, { additionalProperties: false }),
    async execute(_id, { traceId, ...page }, signal, _update, ctx) {
      const result = await reader.get(ctx.sessionManager, ctx.cwd, traceId, page, trace?.id, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
    },
  });
  pi.registerTool({
    name: 'diagnostic_evidence',
    label: 'diagnostic_evidence',
    description:
      'Read protected paginated evidence from an exact native Session Entry in the current project. Does not load historical extensions or execute historical tools.',
    promptGuidelines: guidelines,
    executionMode: 'sequential',
    parameters: Type.Object(
      {
        sessionId: uuid,
        entryId: ref,
        offset: page.offset,
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 32768 })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, query, signal, _update, ctx) {
      const result = await reader.evidence(ctx.sessionManager, ctx.cwd, query, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
    },
  });
}
