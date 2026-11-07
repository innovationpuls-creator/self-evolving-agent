// Pure local line comparison. No filesystem, network, subprocess, or model calls.
export const MAX_CHARS = 12000;
export const MAX_LINES = 400;
export const MAX_OUTPUT_BYTES = 45000;

function parse(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const trailing_newline = normalized.endsWith('\n');
  const lines = normalized === '' ? [] : normalized.split('\n');
  if (trailing_newline) lines.pop();
  return { lines, trailing_newline };
}

export function compareText(old_text, new_text, signal) {
  if (signal?.aborted) throw new Error('text_diff cancelled');
  if (typeof old_text !== 'string' || typeof new_text !== 'string') {
    throw new TypeError('old_text and new_text must be strings');
  }
  if (old_text.length + new_text.length > MAX_CHARS) {
    throw new RangeError(`Combined input exceeds ${MAX_CHARS} UTF-16 code units; compare smaller sections`);
  }
  const old = parse(old_text), next = parse(new_text);
  const a = old.lines, b = next.lines;
  if (a.length + b.length > MAX_LINES) {
    throw new RangeError(`Combined input exceeds ${MAX_LINES} lines; compare smaller sections`);
  }
  // Suffix LCS; deterministic deletion-first tie breaking for repeated lines.
  const width = b.length + 1;
  const dp = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? 1 + dp[(i + 1) * width + j + 1]
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const lines = [], summary = { added: 0, deleted: 0, unchanged: 0 };
  let i = 0, j = 0;
  function push(type, text, old_line, new_line) {
    summary[type]++;
    lines.push({ type, text, old_line, new_line });
  }
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push('unchanged', a[i], i + 1, j + 1); i++; j++;
    } else if (i < a.length && (j === b.length || dp[(i + 1) * width + j] >= dp[i * width + j + 1])) {
      push('deleted', a[i], i + 1, null); i++;
    } else {
      push('added', b[j], null, j + 1); j++;
    }
  }
  const trailing_newline_changed = old.trailing_newline !== next.trailing_newline;
  return {
    changed: summary.added > 0 || summary.deleted > 0 || trailing_newline_changed,
    summary,
    line_endings: 'CRLF normalized to LF; lone CR preserved as content',
    old_trailing_newline: old.trailing_newline,
    new_trailing_newline: next.trailing_newline,
    trailing_newline_changed,
    lines,
  };
}

export function diffResult(old_text, new_text, signal) {
  const result = compareText(old_text, new_text, signal);
  const text = JSON.stringify(result);
  if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) {
    throw new RangeError(`Result exceeds ${MAX_OUTPUT_BYTES} UTF-8 bytes; compare smaller sections (nothing truncated)`);
  }
  return { content: [{ type: 'text', text }], details: result, structuredContent: result };
}
