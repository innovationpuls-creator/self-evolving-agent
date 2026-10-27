import { z } from 'zod';
import type { EvidenceTarget } from '../features/diagnostics/evidence';

export type View =
  | { kind: 'chat'; evidence?: EvidenceTarget }
  | { kind: 'settings' }
  | { kind: 'skills'; id?: string; project?: string; knowledgeRevision?: string }
  | { kind: 'memory'; id?: string; project?: string; revision?: number }
  | { kind: 'reflection' | 'suggestions'; id?: string };

const positionSchema = z.object({
  id: z.string().max(128).optional(),
  offset: z.number().int().min(0).optional(),
  filter: z.string().max(40).optional(),
  scope: z.string().max(40).optional(),
  revision: z.number().int().positive().optional(),
  history: z.boolean().optional(),
});
export type Position = z.infer<typeof positionSchema>;
const navigationSchema = z.object({
  kind: z.enum(['chat', 'settings', 'skills', 'memory', 'diagnostics', 'reflection', 'suggestions']),
  sessionId: z.string().uuid().optional(),
  diagnosticSessionId: z.string().uuid().optional(),
  id: z.string().max(128).optional(),
  project: z.string().max(4096).optional(),
  revision: z.number().int().positive().optional(),
  knowledgeRevision: z.string().max(128).optional(),
  evidence: z
    .object({
      sessionId: z.string().uuid().optional(),
      traceId: z.string().uuid().optional(),
      entryId: z.string().max(128).optional(),
      toolCallId: z.string().max(128).optional(),
    })
    .refine((value) => !!value.sessionId || !!value.traceId)
    .optional(),
});
function read(key: string): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Navigation remains usable without storage. */
  }
}
export function readNavigation() {
  const saved = navigationSchema.safeParse(read('agent-navigation')).data;
  if (saved?.kind === 'diagnostics') {
    const sessionId = saved.sessionId ?? saved.diagnosticSessionId ?? saved.evidence?.sessionId;
    return {
      ...saved,
      kind: 'chat' as const,
      sessionId,
      evidence: saved.evidence ?? (sessionId ? { sessionId } : undefined),
    };
  }
  return saved;
}
export function saveNavigation(view: View, sessionId?: string) {
  const value = navigationSchema.parse({
    ...view,
    sessionId,
    diagnosticSessionId: undefined,
  });
  write('agent-navigation', value);
}
export function readPosition(name: string): Position {
  return positionSchema.safeParse(read(`agent-position-${name}`)).data ?? {};
}
export function savePosition(name: string, value: Position) {
  write(`agent-position-${name}`, positionSchema.parse(value));
}
