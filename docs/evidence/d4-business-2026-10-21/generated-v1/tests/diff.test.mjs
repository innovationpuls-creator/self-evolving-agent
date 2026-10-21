import test from 'node:test';
import assert from 'node:assert/strict';
import { diffText } from '../diff.ts';

test('empty strings are zero lines', () => {
  const r = diffText('', '');
  assert.deepEqual(r.lines, []);
  assert.deepEqual(r.summary, { added: 0, removed: 0, unchanged: 0 });
  assert.equal(r.equal, true);
});
test('Chinese additions, removals, unchanged lines and 1-based numbering', () => {
  const r = diffText('标题\n旧内容\n结尾', '标题\n新内容\n结尾');
  assert.deepEqual(r.lines, [
    { type: 'unchanged', text: '标题', old_line: 1, new_line: 1 },
    { type: 'removed', text: '旧内容', old_line: 2, new_line: null },
    { type: 'added', text: '新内容', old_line: null, new_line: 2 },
    { type: 'unchanged', text: '结尾', old_line: 3, new_line: 3 },
  ]);
  assert.deepEqual(r.summary, { added: 1, removed: 1, unchanged: 2 });
});
test('one empty side and a single blank line', () => {
  assert.deepEqual(diffText('', '中文\n中文').summary, { added: 2, removed: 0, unchanged: 0 });
  assert.deepEqual(diffText('中文\n中文', '').summary, { added: 0, removed: 2, unchanged: 0 });
  assert.deepEqual(diffText('', '\n').lines, [{ type: 'added', text: '', old_line: null, new_line: 1 }]);
});
test('repeated lines use deterministic deletion-first ties', () => {
  const r = diffText('甲\n乙\n甲', '甲\n甲\n乙');
  assert.deepEqual(r.lines.map(x => x.type), ['unchanged', 'removed', 'unchanged', 'added']);
  assert.deepEqual(diffText('甲\n乙\n甲', '甲\n甲\n乙'), r);
});
test('CRLF normalization, trailing newline, whitespace and standalone CR', () => {
  assert.equal(diffText('甲\r\n乙\r\n', '甲\n乙\n').equal, true);
  const r = diffText('甲', '甲\n');
  assert.equal(r.equal, false);
  assert.deepEqual(r.summary, { added: 0, removed: 0, unchanged: 1 });
  assert.deepEqual(r.trailing_newline, { old: false, new: true, changed: true });
  assert.equal(diffText('a ', 'a').equal, false);
  assert.equal(diffText('\t', ' ').equal, false);
  assert.equal(diffText('a\rb', 'a\nb').equal, false);
  assert.equal(diffText('😀\n\n终', '😀\n\n终').summary.unchanged, 3);
});
test('limits and input types reject explicitly, without silent truncation', () => {
  assert.throws(() => diffText('a'.repeat(100001), ''), /100000/);
  assert.throws(() => diffText(Array(4001).fill('x').join('\n'), ''), /4000 lines/);
  assert.throws(() => diffText(Array(2000).fill('x').join('\n'), Array(2000).fill('y').join('\n')), /4000000/);
  assert.throws(() => diffText(null, ''), TypeError);
  assert.equal(diffText('x'.repeat(100000), '').summary.removed, 1);
  assert.equal(diffText(Array(4000).fill('x').join('\n'), '').summary.removed, 4000);
});
test('aborted calls fail', () => {
  assert.throws(() => diffText('a', 'b', AbortSignal.abort()), { name: 'AbortError' });
});
test('seeded randomized reconstruction, line numbers and optimal edit length (1000 pairs)', () => {
  let seed = 321;
  const rand = n => { seed = (1664525 * seed + 1013904223) >>> 0; return seed % n; };
  const alphabet = ['甲', '重复', '', ' x', '😀'];
  const normalize = s => { const a = s === '' ? [] : s.split('\n'); if (s.endsWith('\n')) a.pop(); return a; };
  for (let k = 0; k < 1000; k++) {
    const old = Array.from({ length: rand(10) }, () => alphabet[rand(5)]).join('\n');
    const next = Array.from({ length: rand(10) }, () => alphabet[rand(5)]).join('\n');
    const a = normalize(old), b = normalize(next), r = diffText(old, next);
    assert.deepEqual(r.lines.filter(x => x.type !== 'added').map(x => x.text), a);
    assert.deepEqual(r.lines.filter(x => x.type !== 'removed').map(x => x.text), b);
    assert.deepEqual(r.lines.filter(x => x.old_line !== null).map(x => x.old_line), a.map((_, i) => i + 1));
    assert.deepEqual(r.lines.filter(x => x.new_line !== null).map(x => x.new_line), b.map((_, i) => i + 1));
    // Independent edit-distance recurrence (insertion/deletion only).
    const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = a[i-1] === b[j-1] ? d[i-1][j-1] : 1 + Math.min(d[i-1][j], d[i][j-1]);
    assert.equal(r.summary.added + r.summary.removed, d[a.length][b.length]);
  }
});
