export interface Model {
  provider: string;
  id: string;
  name: string;
}
export interface Message {
  role: string;
  content: string | Array<{ type: string; text?: string; name?: string; arguments?: unknown; id?: string }>;
  toolName?: string;
  toolCallId?: string;
  display?: boolean;
  customType?: string;
  isError?: boolean;
  errorMessage?: string;
}
export interface Tree {
  entry: { id: string; type: string; customType?: string; message?: Message };
  children: Tree[];
}
export interface Session {
  id: string;
  title: string;
  cwd: string;
  provider: string;
  model: string;
  busy: boolean;
  stateVersion: number;
  execution?: { name: string; phase: 'running' | 'updating' };
  skillFailed?: boolean;
  queued?: number;
  interrupted?: boolean;
  error?: string;
  unavailable?: boolean;
  messages?: Message[];
  streamingMessage?: Message;
  tree?: Tree[];
  leafId?: string;
  thinkingLevel?: string;
  thinkingLevels?: string[];
}
export type SessionEvent =
  | { type: 'state'; sessionId: string; state: Session }
  | {
      type: 'update';
      sessionId: string;
      stateVersion: number;
      event: { type: string; message?: Message; toolName?: string };
    };

export function applySessionEvent(state: Session, event: SessionEvent): Session {
  const version = event.type === 'state' ? event.state.stateVersion : event.stateVersion;
  if (version <= state.stateVersion) return state;
  if (event.type === 'state') return event.state;
  const update = event.event;
  if (update.type === 'tool_execution_start' || update.type === 'tool_execution_update')
    return {
      ...state,
      stateVersion: version,
      execution: {
        name: update.toolName ?? 'Tool',
        phase: update.type === 'tool_execution_start' ? 'running' : 'updating',
      },
    };
  if (update.type === 'tool_execution_end') return { ...state, stateVersion: version, execution: undefined };
  if (update.type === 'message_start' || update.type === 'message_update')
    return { ...state, stateVersion: version, streamingMessage: update.message };
  if (update.type === 'message_end' && update.message)
    return {
      ...state,
      stateVersion: version,
      messages: [...(state.messages ?? []), update.message],
      streamingMessage: undefined,
    };
  return { ...state, stateVersion: version };
}
export function messageText(message: Message) {
  if (typeof message.content === 'string') return message.content;
  return (
    message.content
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n') ?? ''
  );
}

export function pendingToolNames(session: Session): string[] {
  if (!session.busy) return [];
  const pending = new Map<string, string>();
  for (const message of session.messages ?? []) {
    if (message.role === 'user') pending.clear();
    if (message.role === 'assistant' && Array.isArray(message.content))
      for (const part of message.content)
        if (part.type === 'toolCall' && part.id) pending.set(part.id, part.name ?? 'Tool');
    if (message.role === 'toolResult' && message.toolCallId) pending.delete(message.toolCallId);
  }
  return [...pending.values()];
}
