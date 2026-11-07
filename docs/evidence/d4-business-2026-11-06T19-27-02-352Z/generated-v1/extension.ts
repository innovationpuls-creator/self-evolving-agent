import { Type } from 'typebox';
import { diffResult } from './diff.mjs';

export default function (pi) {
  const nullableLine = Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]);
  pi.registerTool({
    name: 'text_diff',
    label: 'Text Diff',
    description: 'Compare old_text and new_text locally for document review. Return ordered line-level added, deleted and unchanged content with old/new line numbers and counts. Supports Chinese, empty strings and repeated lines. CRLF equals LF; final newline changes are reported separately. Max combined 12000 UTF-16 code units / 400 lines, result 45000 UTF-8 bytes; exceeding limits fails without truncation.',
    exposure: 'deferred',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object({
      old_text: Type.String({ description: 'Original text, including whitespace and final newline; may be empty.' }),
      new_text: Type.String({ description: 'Revised text, including whitespace and final newline; may be empty.' }),
    }, { additionalProperties: false }),
    outputSchema: Type.Object({
      changed: Type.Boolean(),
      summary: Type.Object({ added: Type.Integer(), deleted: Type.Integer(), unchanged: Type.Integer() }),
      line_endings: Type.String(),
      old_trailing_newline: Type.Boolean(),
      new_trailing_newline: Type.Boolean(),
      trailing_newline_changed: Type.Boolean(),
      lines: Type.Array(Type.Object({
        type: Type.Union([Type.Literal('added'), Type.Literal('deleted'), Type.Literal('unchanged')]),
        text: Type.String(), old_line: nullableLine, new_line: nullableLine,
      })),
    }),
    async execute(_id, params, signal) {
      return diffResult(params.old_text, params.new_text, signal);
    },
  });
}
