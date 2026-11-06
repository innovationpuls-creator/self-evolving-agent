import { messageText, type Session, type Tree, type Message } from './session-state';
import { projectTrajectory } from '../diagnostics/trajectory-state';
type PresentedEntry = Tree['entry'] & { message: Message };
export type SessionBlock = { kind: 'message' | 'tools'; entries: PresentedEntry[] };
export function presentSession(session: Session): SessionBlock[] {
  const groups = projectTrajectory(session),
    native = groups.flatMap((g) => g.entries);
  const entries: Tree['entry'][] = native.length
    ? native
    : [...(session.messages || []), ...(session.streamingMessage ? [session.streamingMessage] : [])].map(
        (message, i) => ({ id: `projection:${i}`, type: 'message', message }),
      );
  const visible = entries.filter((e): e is PresentedEntry => {
    const m = e.message;
    return (
      !!m &&
      m.display !== false &&
      (m.role === 'toolResult' ||
        !!messageText(m).trim() ||
        !!m.errorMessage ||
        (Array.isArray(m.content) && m.content.some((p) => p.type === 'toolCall')))
    );
  });
  const blocks: SessionBlock[] = [];
  for (const e of visible) {
    const kind =
      e.message?.role === 'toolResult' ||
      (e.message?.role === 'assistant' && !messageText(e.message).trim() && !e.message.errorMessage)
        ? 'tools'
        : 'message';
    const prior = blocks.at(-1);
    if (kind === 'tools' && prior?.kind === 'tools') prior.entries.push(e);
    else blocks.push({ kind, entries: [e] });
  }
  return blocks;
}
