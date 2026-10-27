import assert from 'node:assert/strict';
import test from 'node:test';
import { branchPath, projectTrajectory, matchesSearch } from '../apps/web/src/features/diagnostics/trajectory-state.js';
import type { Session, Tree, Message } from '../apps/web/src/features/chat/session-state.js';

const entry = (id: string, message?: Message): Tree['entry'] => ({ id, type: 'message', message });
const marker = (id: string, phase: string): Tree['entry'] => ({
  id,
  type: 'custom',
  customType: 'diagnostic_trace_v1',
  data: { traceId: 'trace-one', phase },
});
const assistant: Message = {
  role: 'assistant',
  timestamp: 2,
  content: [{ type: 'toolCall', id: 'call-one', name: 'read', arguments: { path: 'a.txt' } }],
};
const result: Message = {
  role: 'toolResult',
  toolCallId: 'call-one',
  toolName: 'read',
  timestamp: 3,
  content: [{ type: 'text', text: 'recorded result' }],
};
function session(entries: Tree['entry'][], leafId = entries.at(-1)?.id): Session {
  let children: Tree[] = [];
  for (const item of entries.toReversed()) children = [{ entry: item, children }];
  return {
    id: 'session-one',
    title: 'Task',
    cwd: '/tmp',
    provider: 'provider',
    model: 'model',
    busy: false,
    stateVersion: 1,
    tree: children,
    leafId,
  };
}
const history = () => [
  marker('start', 'start'),
  entry('user', { role: 'user', timestamp: 1, content: 'read a file' }),
  entry('assistant', assistant),
  entry('result', result),
  entry('answer', { role: 'assistant', timestamp: 4, content: 'done' }),
  marker('end', 'end'),
];

test('native branch membership excludes abandoned results and later Turns within the same Trace', () => {
  const partial = projectTrajectory(session(history(), 'assistant'));
  assert.equal(partial.length, 1);
  assert.equal(partial[0]?.complete, false);
  assert.equal(partial[0]?.turns.length, 1);
  assert.equal(partial[0]?.turns[0]?.calls[0]?.result, undefined);
  const full = projectTrajectory(session(history()));
  assert.equal(full[0]?.complete, true);
  assert.equal(full[0]?.turns.length, 2);
  assert.equal(full[0]?.turns[0]?.calls[0]?.resultEntryId, 'result');
});

test('a new Trace stays visible before its user Entry is checkpointed and streams without false evidence IDs', () => {
  const value = session([marker('start', 'start')]);
  value.busy = true;
  value.messages = [{ role: 'user', timestamp: 1, content: 'read a file' }];
  value.streamingMessage = assistant;
  const first = projectTrajectory(value);
  assert.equal(first[0]?.traceId, 'trace-one');
  assert.equal(first[0]?.turns[0]?.live, true);
  assert.equal(first[0]?.turns[0]?.entryId, undefined);
  const next = session(history().slice(0, 3));
  next.busy = true;
  next.messages = [...value.messages, assistant];
  assert.equal(projectTrajectory(next)[0]?.turns.length, 1);
});

test('native Tool IDs distinguish simultaneous Tool results with the same timestamp', () => {
  const two: Message = {
    ...assistant,
    content: [
      ...(Array.isArray(assistant.content) ? assistant.content : []),
      { type: 'toolCall', id: 'call-two', name: 'read', arguments: { path: 'b.txt' } },
    ],
  };
  const value = session([
    marker('start', 'start'),
    entry('user', { role: 'user', timestamp: 1, content: 'files' }),
    entry('assistant', two),
    entry('result', result),
  ]);
  value.busy = true;
  value.messages = [two, result, { ...result, toolCallId: 'call-two' }];
  const projected = projectTrajectory(value);
  assert.equal(projected[0]?.turns[0]?.calls[1]?.result?.toolCallId, 'call-two');
});

test('legacy entries survive without invented Trace IDs and session data never crosses projections', () => {
  const a = projectTrajectory(
    session([
      entry('old-user', { role: 'user', content: 'old task' }),
      entry('old-answer', { role: 'assistant', content: 'old answer' }),
    ]),
  );
  assert.equal(a[0]?.traceId, undefined);
  assert.equal(a[0]?.turns[0]?.entryId, 'old-answer');
  assert.deepEqual(projectTrajectory(session([])), []);
  assert.deepEqual(branchPath(session(history()).tree ?? [], 'missing'), []);
});

test('search uses case-insensitive AND terms over loaded content', () => {
  assert.equal(matchesSearch('Read FILE.txt tool error', 'read ERROR'), true);
  assert.equal(matchesSearch('read FILE.txt', 'read error'), false);
});

test('native ended status stays truthful and sibling branches do not leak', () => {
  const entries = history();
  const end = entries.at(-1);
  assert.ok(end);
  end.data = { ...end.data, status: 'failed' };
  const value = session(entries);
  value.tree?.[0]?.children.push({
    entry: entry('abandoned', { role: 'assistant', content: 'discarded sibling' }),
    children: [],
  });
  const projected = projectTrajectory(value);
  assert.equal(projected[0]?.status, 'failed');
  assert.ok(!JSON.stringify(projected).includes('discarded sibling'));
});

test('streamed text evolves in the pending Turn and becomes a single persisted Turn', () => {
  const value = session([marker('start', 'start'), entry('user', { role: 'user', timestamp: 1, content: 'Task' })]);
  value.busy = true;
  value.streamingMessage = { role: 'assistant', timestamp: 2, content: 'partial' };
  assert.equal(projectTrajectory(value)[0]?.turns[0]?.message.content, 'partial');
  value.streamingMessage = { ...value.streamingMessage, content: 'partial completed' };
  assert.equal(projectTrajectory(value)[0]?.turns[0]?.message.content, 'partial completed');
  const persisted = session([
    marker('start', 'start'),
    entry('user', { role: 'user', timestamp: 1, content: 'Task' }),
    entry('saved-answer', value.streamingMessage),
  ]);
  persisted.busy = true;
  persisted.messages = [value.streamingMessage];
  assert.equal(projectTrajectory(persisted)[0]?.turns.length, 1);
  assert.equal(projectTrajectory(persisted)[0]?.turns[0]?.entryId, 'saved-answer');
});
