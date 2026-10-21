export const MAX_CHARS = 100_000;
export const MAX_LINES = 4_000;
export const MAX_CELLS = 4_000_000;

type Line =
  | { type: 'added'; text: string; old_line: null; new_line: number }
  | { type: 'removed'; text: string; old_line: number; new_line: null }
  | { type: 'unchanged'; text: string; old_line: number; new_line: number };

function split(text: string) {
  const normalized = text.replace(/\r\n/g, '\n');
  const trailing = normalized.endsWith('\n');
  const lines = normalized === '' ? [] : normalized.split('\n');
  if (trailing) lines.pop();
  return { lines, trailing };
}

/** Exact line LCS with deterministic deletion-first ties; no I/O or external state. */
export function diffText(oldText: string, newText: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (typeof oldText !== 'string' || typeof newText !== 'string') {
    throw new TypeError('old_text and new_text must be strings');
  }
  if (oldText.length > MAX_CHARS || newText.length > MAX_CHARS) {
    throw new RangeError(`Each text must contain at most ${MAX_CHARS} UTF-16 code units`);
  }
  const old = split(oldText);
  const next = split(newText);
  const a = old.lines;
  const b = next.lines;
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    throw new RangeError(`Each text must contain at most ${MAX_LINES} lines`);
  }
  const width = b.length + 1;
  const cells = (a.length + 1) * width;
  if (cells > MAX_CELLS) {
    throw new RangeError(`Comparison exceeds ${MAX_CELLS} LCS cells; compare smaller sections`);
  }
  // Every LCS length is <= 4000, so Uint16 stores every value exactly.
  const table = new Uint16Array(cells);
  for (let i = a.length - 1; i >= 0; i--) {
    signal?.throwIfAborted();
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? 1 + table[(i + 1) * width + j + 1]
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const lines: Line[] = [];
  const summary = { added: 0, removed: 0, unchanged: 0 };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const before = a[i];
    const after = b[j];
    if (before !== undefined && after !== undefined && before === after) {
      lines.push({ type: 'unchanged', text: before, old_line: ++i, new_line: ++j });
      summary.unchanged++;
    } else if (before !== undefined && (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      lines.push({ type: 'removed', text: before, old_line: ++i, new_line: null });
      summary.removed++;
    } else if (after !== undefined) {
      lines.push({ type: 'added', text: after, old_line: null, new_line: ++j });
      summary.added++;
    }
  }
  const trailingChanged = old.trailing !== next.trailing;
  return {
    summary,
    lines,
    old_line_count: a.length,
    new_line_count: b.length,
    trailing_newline: { old: old.trailing, new: next.trailing, changed: trailingChanged },
    equal: summary.added === 0 && summary.removed === 0 && !trailingChanged,
    newline_policy: 'CRLF and LF are equivalent; standalone CR is content',
  };
}
