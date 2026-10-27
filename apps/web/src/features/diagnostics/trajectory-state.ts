import { messageText, type Message, type Session, type Tree } from '../chat/session-state.js';

export interface TrajectoryCall {
  id: string;
  name: string;
  args: unknown;
  assistantEntryId?: string;
  resultEntryId?: string;
  result?: Message;
}
export interface TrajectoryTurn {
  id: string;
  entryId?: string;
  message: Message;
  live?: boolean;
  calls: TrajectoryCall[];
}
export interface TrajectoryGroup {
  id: string;
  traceId?: string;
  user?: Tree['entry'];
  complete: boolean;
  status?: string;
  turns: TrajectoryTurn[];
  entries: Tree['entry'][];
}

export function branchPath(tree: Tree[], leafId?: string): Tree['entry'][] {
  if (!leafId) return [];
  for (const node of tree) {
    if (node.entry.id === leafId) return [node.entry];
    const path = branchPath(node.children, leafId);
    if (path.length) return [node.entry, ...path];
  }
  return [];
}

/** Native branch membership is authoritative; diagnostic indexes only enrich it. */
export function projectTrajectory(session: Session): TrajectoryGroup[] {
  const groups: TrajectoryGroup[] = [];
  let group: TrajectoryGroup | undefined;
  const append = (entry: Tree['entry'], live = false) => {
    if (!group) {
      group = { id: `history:${entry.id}`, complete: false, turns: [], entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
    const message = entry.message;
    if (!message) return;
    if (message.role === 'user') group.user = entry;
    if (message.role === 'assistant') {
      const turn: TrajectoryTurn = { id: entry.id, entryId: live ? undefined : entry.id, message, live, calls: [] };
      if (Array.isArray(message.content))
        for (const part of message.content)
          if (part.type === 'toolCall' && part.id)
            turn.calls.push({
              id: part.id,
              name: part.name ?? 'Tool',
              args: part.arguments,
              assistantEntryId: turn.entryId,
            });
      group.turns.push(turn);
    }
    if (message.role === 'toolResult') {
      const call = group.turns.flatMap((turn) => turn.calls).find((item) => item.id === message.toolCallId);
      if (call) {
        call.result = message;
        call.resultEntryId = live ? undefined : entry.id;
      }
    }
  };
  const path = branchPath(session.tree ?? [], session.leafId);
  for (const entry of path) {
    if (entry.type === 'custom' && entry.customType === 'diagnostic_trace_v1') {
      const traceId = entry.data?.traceId;
      if (typeof traceId !== 'string') continue;
      if (entry.data?.phase === 'start') {
        group = { id: traceId, traceId, complete: false, turns: [], entries: [] };
        groups.push(group);
      } else if (entry.data?.phase === 'end' && group?.traceId === traceId) {
        group.complete = true;
        if (typeof entry.data.status === 'string') group.status = entry.data.status;
      }
      continue;
    }
    if (entry.type === 'custom' && entry.customType === 'reflection_settled_v1') continue;
    if (entry.message?.role === 'user' && (!group?.traceId || group.complete)) group = undefined;
    append(entry);
  }
  if (session.busy && group && !group.complete) {
    const native = path.flatMap((entry) => (entry.message ? [entry.message] : []));
    const pending = [...(session.messages ?? []), ...(session.streamingMessage ? [session.streamingMessage] : [])];
    const lastNativeTime = native.at(-1)?.timestamp;
    for (const message of pending) {
      const found = native.some(
        (saved) =>
          saved === message ||
          (saved.timestamp != null &&
            saved.timestamp === message.timestamp &&
            saved.role === message.role &&
            (message.role !== 'toolResult' || saved.toolCallId === message.toolCallId)),
      );
      if (found || (lastNativeTime != null && message.timestamp != null && message.timestamp < lastNativeTime))
        continue;
      if (!['user', 'assistant', 'toolResult'].includes(message.role)) continue;
      append(
        { id: `live:${message.role}:${message.timestamp ?? pending.indexOf(message)}`, type: 'message', message },
        true,
      );
    }
  }
  return groups;
}

export function turnText(turn: TrajectoryTurn) {
  return messageText(turn.message) || (turn.live ? '正在生成…' : '模型调用');
}
export function matchesSearch(text: string, query: string) {
  const haystack = text.toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}
