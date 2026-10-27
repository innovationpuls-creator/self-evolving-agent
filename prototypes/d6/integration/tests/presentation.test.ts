import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Session, Message } from '../../../../apps/web/src/features/chat/session-state';
import { presentSession } from '../../src/real/session-presentation';
import { parseProductRoute } from '../../src/real/navigation';
const session = (messages: Message[]): Session => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'same original title',
  cwd: '/project',
  provider: 'test',
  model: 'test',
  busy: false,
  stateVersion: 1,
  messages,
});
test('native Tool requests and errors stay addressable without empty Agent paragraphs', () => {
  const value = session([
    { role: 'user', content: 'read policy' },
    { role: 'assistant', content: [{ type: 'toolCall', id: 'call', name: 'read', arguments: { path: 'POLICY.md' } }] },
    { role: 'toolResult', toolCallId: 'call', toolName: 'read', isError: true, content: 'Permission denied' },
    { role: 'assistant', content: '', errorMessage: 'interrupted' },
    { role: 'assistant', content: '', display: false },
  ]);
  const blocks = presentSession(value);
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['message', 'tools', 'message'],
  );
  assert.equal(blocks[1].entries.length, 2);
  assert.equal(blocks[1].entries[1].message.isError, true);
  assert.equal(blocks[2].entries[0].message.errorMessage, 'interrupted');
});
test('stream projection retains actual content rather than inferring completion', () => {
  const value = session([{ role: 'user', content: 'request' }]);
  value.busy = true;
  value.streamingMessage = { role: 'assistant', content: 'partial' };
  const blocks = presentSession(value);
  assert.equal(blocks.at(-1)?.entries[0].message, value.streamingMessage);
  assert.equal(value.busy, true);
});
test('extended A routes preserve exact project, revision and origin context', () => {
  const route = {
    page: 'result',
    target: { kind: 'memory', id: '00000000-0000-4000-8000-000000000002', project: '/a/project', revision: 2 },
    originSession: '00000000-0000-4000-8000-000000000001',
  };
  assert.deepEqual(parseProductRoute(JSON.stringify(route)), route);
  assert.deepEqual(parseProductRoute(JSON.stringify({ page: 'trajectory', sessionId: 'invalid' })), {
    page: 'session',
  });
  assert.deepEqual(parseProductRoute(JSON.stringify({ page: 'memory', offset: -1 })), { page: 'session' });
});
