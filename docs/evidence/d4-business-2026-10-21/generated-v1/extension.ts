import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { diffText, MAX_CHARS } from './diff.ts';

const counts = Type.Object({ added: Type.Integer(), removed: Type.Integer(), unchanged: Type.Integer() });
const lineNumber = Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]);

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'text_diff',
    label: 'Text Diff',
    description: 'Compare old_text and new_text locally at line level for document review (文本差异、文档修改核对). Returns added, removed and unchanged lines with line numbers and counts. Exact whitespace; CRLF equals LF; trailing newline reported separately. No files or network. Limits: 100000 UTF-16 units per text, 4000 lines per text, 4000000 LCS cells.',
    exposure: 'deferred',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object({
      old_text: Type.String({ maxLength: MAX_CHARS, description: 'Original document text; empty string allowed' }),
      new_text: Type.String({ maxLength: MAX_CHARS, description: 'Revised document text; empty string allowed' }),
    }, { additionalProperties: false }),
    outputSchema: Type.Object({
      summary: counts,
      lines: Type.Array(Type.Object({
        type: Type.Union([Type.Literal('added'), Type.Literal('removed'), Type.Literal('unchanged')]),
        text: Type.String(), old_line: lineNumber, new_line: lineNumber,
      })),
      old_line_count: Type.Integer(), new_line_count: Type.Integer(),
      trailing_newline: Type.Object({ old: Type.Boolean(), new: Type.Boolean(), changed: Type.Boolean() }),
      equal: Type.Boolean(), newline_policy: Type.String(),
    }),
    async execute(_id, params, signal) {
      const result = diffText(params.old_text, params.new_text, signal);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result, structuredContent: result };
    },
  });
}
