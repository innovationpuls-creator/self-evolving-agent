import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  applySessionEvent,
  pendingToolNames,
  type Session,
  type SessionEvent,
} from '../apps/web/src/features/chat/session-state.js';
import { Markdown } from '../apps/web/src/components/Markdown.js';

const baseline: Session = {
  id: 'a',
  title: 'A',
  cwd: '/a',
  provider: 'p',
  model: 'm',
  busy: true,
  stateVersion: 4,
  messages: [{ role: 'user', content: 'work' }],
  streamingMessage: { role: 'assistant', content: 'par' },
};
const update = (stateVersion: number, type: string, content: string): SessionEvent => ({
  type: 'update',
  sessionId: 'a',
  stateVersion,
  event: { type, message: { role: 'assistant', content } },
});
test('snapshot baseline replays newer stream events exactly once and ignores delayed old state', () => {
  let value = baseline;
  for (const event of [
    update(3, 'message_update', 'old'),
    update(5, 'message_update', 'partial'),
    update(6, 'message_end', 'complete'),
    update(6, 'message_end', 'complete'),
    { type: 'state', sessionId: 'a', state: baseline } as SessionEvent,
  ])
    value = applySessionEvent(value, event);
  assert.equal(value.stateVersion, 6);
  assert.equal(value.streamingMessage, undefined);
  assert.deepEqual(
    value.messages?.map((m) => m.content),
    ['work', 'complete'],
  );
});
test('reconnect snapshot retains unfinished message without adding it to completed history', () => {
  const value = applySessionEvent(baseline, update(5, 'message_update', 'part two'));
  assert.equal(value.messages?.length, 1);
  assert.equal(value.streamingMessage?.content, 'part two');
});
test('Markdown renders GFM without HTML, active URLs or automatic image requests', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      // biome-ignore lint/correctness/noChildrenProp: Required component children are exercised without JSX in this Node test.
      children:
        '# Heading\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n![remote](https://remote.invalid/private.png)\n\n| A | B |\n| - | - |\n| 1 | 2 |',
    }),
  );
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script|javascript:|<img|remote.invalid/);
  assert.match(html, /图片：remote/);
});

test('Tool execution events retain the active stage without fabricating a completed message', () => {
  let value = applySessionEvent(baseline, {
    type: 'update',
    sessionId: 'a',
    stateVersion: 5,
    event: { type: 'tool_execution_start', toolName: 'bash' },
  });
  assert.equal(value.execution?.name, 'bash');
  assert.equal(value.messages?.length, 1);
  value = applySessionEvent(value, {
    type: 'update',
    sessionId: 'a',
    stateVersion: 6,
    event: { type: 'tool_execution_update', toolName: 'bash' },
  });
  assert.equal(value.execution?.phase, 'updating');
  value = applySessionEvent(value, {
    type: 'update',
    sessionId: 'a',
    stateVersion: 7,
    event: { type: 'tool_execution_end', toolName: 'bash' },
  });
  assert.equal(value.execution, undefined);
});

test('reconnect derives all unfinished native Tools and removes only matching results', () => {
  const value: Session = {
    ...baseline,
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'first', name: 'read' },
          { type: 'toolCall', id: 'second', name: 'bash' },
        ],
      },
      { role: 'toolResult', toolCallId: 'first', content: 'done' },
    ],
  };
  assert.deepEqual(pendingToolNames(value), ['bash']);
  assert.deepEqual(pendingToolNames({ ...value, busy: false }), []);
});

test('an interrupted historical Tool never becomes the current turn stage', () => {
  const value: Session = {
    ...baseline,
    messages: [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'old', name: 'bash' }] },
      { role: 'user', content: 'new task' },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'new', name: 'read' }] },
      { role: 'toolResult', toolCallId: 'new', content: 'done' },
    ],
  };
  assert.deepEqual(pendingToolNames(value), []);
});
