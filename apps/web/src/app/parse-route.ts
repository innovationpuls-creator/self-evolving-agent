import type { Route } from './reference-route';
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const optionalId = (value: unknown) => value === undefined || uuid(value);
export function parseRoute(raw: string | null): Route {
  const fallback: Route = { page: 'session' };
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return fallback;
    if (
      value.page === 'session' &&
      optionalId(value.sessionId) &&
      (value.entryId === undefined || typeof value.entryId === 'string')
    )
      return value;
    if (
      value.page === 'reflections' &&
      optionalId(value.sessionId) &&
      Number.isSafeInteger(value.offset) &&
      value.offset >= 0
    )
      return value;
    if (
      value.page === 'reflection' &&
      uuid(value.jobId) &&
      optionalId(value.recordId) &&
      optionalId(value.originSession)
    )
      return value;
    if (value.page === 'result' && value.target && uuid(value.target.id) && optionalId(value.originSession)) {
      const target = value.target;
      if (
        target.kind === 'memory' &&
        typeof target.project === 'string' &&
        (target.revision === undefined || (Number.isSafeInteger(target.revision) && target.revision > 0))
      )
        return value;
      if (
        target.kind === 'suggestion' ||
        (target.kind === 'skill' &&
          ['file', 'version', 'knowledgeRevision'].every(
            (key) => target[key] === undefined || typeof target[key] === 'string',
          ))
      )
        return value;
    }
    if (
      value.page === 'source' &&
      value.reference &&
      typeof value.project === 'string' &&
      optionalId(value.originSession)
    ) {
      const ref = value.reference;
      if (!['sessionId', 'traceId', 'memoryId', 'skillId', 'reflectionId'].some((key) => uuid(ref[key])))
        return fallback;
      if (['sessionId', 'traceId', 'memoryId', 'skillId', 'reflectionId'].some((key) => !optionalId(ref[key])))
        return fallback;
      if (ref.entryId !== undefined && (typeof ref.entryId !== 'string' || !uuid(ref.sessionId))) return fallback;
      return value;
    }
  } catch {
    /* Malformed links do not create API requests. */
  }
  return fallback;
}
