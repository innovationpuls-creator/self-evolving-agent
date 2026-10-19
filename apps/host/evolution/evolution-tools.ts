import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { EvolutionError, evolutionInput, type EvolutionContext, type EvolutionService } from './evolution.js';

export const evolutionToolNames = ['suggestion_submit'];
export function evolutionTools(
  evolution: EvolutionService,
  getContext: (toolCallId: string) => Promise<EvolutionContext>,
): ToolDefinition[] {
  return [
    {
      name: 'suggestion_submit',
      label: '提交进化建议',
      description:
        'Save a capability improvement idea with evidence, expected value and uncertainty for user discussion.',
      promptSnippet: 'Submit useful capability improvement suggestions without implementing them.',
      promptGuidelines: [
        'A suggestion is an idea, not a confirmed defect or authorization to develop. Distinguish observations from hypotheses. High priority is only for ideas worth proactively bringing to the user, with a reason.',
      ],
      executionMode: 'sequential',
      parameters: Type.Object(
        {
          title: Type.String({ minLength: 1, maxLength: 240 }),
          goal: Type.String({ minLength: 1, maxLength: 8000 }),
          reason: Type.String({ minLength: 1, maxLength: 8000 }),
          value: Type.String({ minLength: 1, maxLength: 8000 }),
          uncertainty: Type.String({ minLength: 1, maxLength: 8000 }),
          action: Type.String({ minLength: 1, maxLength: 8000 }),
          priority: Type.Union([Type.Literal('normal'), Type.Literal('high')]),
          attentionReason: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
          evidence: Type.Array(
            Type.Object(
              {
                sessionId: Type.Optional(Type.String({ format: 'uuid' })),
                entryId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
                traceId: Type.Optional(Type.String({ format: 'uuid' })),
                memoryId: Type.Optional(Type.String({ format: 'uuid' })),
                revision: Type.Optional(Type.Integer({ minimum: 1 })),
                skillId: Type.Optional(Type.String({ format: 'uuid' })),
                knowledgeRevision: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
                reflectionId: Type.Optional(Type.String({ format: 'uuid' })),
              },
              { additionalProperties: false },
            ),
            { maxItems: 100 },
          ),
        },
        { additionalProperties: false },
      ),
      async execute(toolCallId, input, signal) {
        try {
          signal?.throwIfAborted();
          const ctx = await getContext(toolCallId);
          signal?.throwIfAborted();
          const result = evolution.create(ctx, evolutionInput.parse(input));
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
        } catch (error) {
          const result =
            error instanceof EvolutionError
              ? { error: error.message, code: error.code }
              : { error: '建议未保存，请检查来源和输入后重试', code: 'EVOLUTION_FAILED' };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {}, isError: true };
        }
      },
    },
  ];
}
