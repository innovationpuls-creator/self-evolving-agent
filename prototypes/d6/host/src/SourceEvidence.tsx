import { useCallback, useState } from 'react';
import { EvidenceView } from '../../../../apps/web/src/features/diagnostics/EvidenceView';
import { MemoryToolFeedback } from '../../../../apps/web/src/features/chat/MemoryToolFeedback';
import type { Message } from '../../../../apps/web/src/features/chat/session-state';
import type { Evidence, EvidenceReference } from '../../../../apps/web/src/features/diagnostics/evidence';
import type { Api } from './data';
import type { Route } from './navigation';
export function nativeMemoryOperation(content?: string): Message | undefined {
  if (!content) return;
  try {
    const entry = JSON.parse(content),
      message = entry?.message,
      feedback = message?.details?.memory;
    if (
      entry.type === 'message' &&
      message?.role === 'toolResult' &&
      !message.isError &&
      ['memory_save', 'memory_revise', 'memory_retire'].includes(message.toolName) &&
      typeof feedback?.id === 'string' &&
      /^[a-f0-9-]{36}$/.test(feedback.id) &&
      Number.isSafeInteger(feedback.revision) &&
      feedback.revision > 0 &&
      Array.isArray(feedback.sources)
    )
      return message as Message;
  } catch {
    /* Truncated/native summaries cannot establish a saved memory operation. */
  }
}
export function SourceEvidence({
  api,
  reference,
  route,
  go,
}: {
  api: Api;
  reference: EvidenceReference;
  route: Extract<Route, { page: 'source' }>;
  go: (route: Route) => void;
}) {
  const [message, setMessage] = useState<Message>();
  const observed = useCallback<Api>(
    async <T,>(path: string, method?: string, data?: unknown, signal?: AbortSignal) => {
      try {
        const value = await api<T>(path, method, data, signal);
        if (!signal?.aborted) {
          const evidence = value as Evidence;
          setMessage(evidence.available && !evidence.truncated ? nativeMemoryOperation(evidence.content) : undefined);
        }
        return value;
      } catch (error) {
        if (!signal?.aborted) setMessage(undefined);
        throw error;
      }
    },
    [api],
  );
  return (
    <>
      {message && (
        <MemoryToolFeedback
          message={message}
          api={api}
          project={route.project}
          onMemory={(id, revision, project) =>
            go({
              page: 'result',
              target: { kind: 'memory', id, revision, project: project || route.project },
              originSession: route.originSession,
            })
          }
          onEvidence={(target) => go({ ...route, reference: target })}
        />
      )}
      <EvidenceView api={observed} reference={reference} />
    </>
  );
}
