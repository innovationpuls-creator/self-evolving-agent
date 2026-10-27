export type Api = <T>(path: string, method?: string, data?: unknown, signal?: AbortSignal) => Promise<T>;
export interface EvidenceReference {
  sessionId: string;
  entryId: string;
  toolCallId?: string;
}
export type EvidenceTarget =
  | { sessionId: string; entryId?: string; toolCallId?: string; traceId?: string }
  | { traceId: string; sessionId?: string; entryId?: string; toolCallId?: string };
export interface Evidence extends EvidenceReference {
  available: boolean;
  reason?: string;
  source: 'checkpoint' | 'previous_checkpoint';
  onSelectedBranch?: boolean;
  content?: string;
  total: number;
  nextOffset?: number;
  truncated: boolean;
  nested?: boolean;
}
