import { restore, type Snapshot, type SensitiveData } from '../storage/storage.js';
import {
  DiagnosticError,
  diagnosticQuery,
  evidenceQuery,
  type DiagnosticContext,
  type DiagnosticService,
} from './diagnostics.js';

/** A decrypted, validated checkpoint; reading it must not activate a historical Agent. */
export interface DiagnosticCheckpoint {
  saved: { record: { cwd: string }; session: Snapshot };
  previous: boolean;
}
export type DiagnosticReader = Pick<DiagnosticHistory, 'search' | 'get' | 'evidence'>;

export class DiagnosticHistory {
  constructor(
    private readCheckpoint: (id: string) => Promise<DiagnosticCheckpoint | undefined>,
    private index: Pick<DiagnosticService, 'search' | 'get' | 'sessionEvents'>,
    private sensitive: SensitiveData,
  ) {}
  get(ctx: DiagnosticContext, id: string, input: unknown = {}) {
    return this.index.get(ctx, id, input);
  }
  private async checkpoint(ctx: DiagnosticContext, id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new DiagnosticError('证据不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
    const loaded = await this.readCheckpoint(id);
    if (!loaded) throw new DiagnosticError('证据不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
    if (ctx.actor === 'agent' && (!ctx.project || ctx.project !== loaded.saved.record.cwd))
      throw new DiagnosticError('证据不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
    return loaded;
  }
  async search(ctx: DiagnosticContext, input: unknown) {
    const q = diagnosticQuery.parse(input);
    let branch: string[] | undefined;
    if (q.branchLeafId) {
      if (!q.sessionId) throw new DiagnosticError('分支筛选需要 Session', 400, 'DIAGNOSTIC_BRANCH_REQUIRED');
      const loaded = await this.checkpoint(ctx, q.sessionId),
        manager = restore(loaded.saved.session);
      if (!manager.getEntry(q.branchLeafId)) throw new DiagnosticError('分支节点不存在', 404, 'DIAGNOSTIC_NOT_FOUND');
      branch = manager.getBranch(q.branchLeafId).map((e) => e.id);
    }
    const result = this.index.search(ctx, q, branch);
    if (q.sessionId) {
      try {
        const loaded = await this.checkpoint(ctx, q.sessionId);
        const sessionEvents = this.index.sessionEvents(ctx, q.sessionId, loaded.saved.record.cwd);
        return { ...result, sessionEvents, sessionEventsTruncated: sessionEvents.length === 100 };
      } catch {
        return { ...result, sessionEvents: [], sessionEventsUnavailable: true };
      }
    }
    return result;
  }
  async evidence(ctx: DiagnosticContext, input: unknown) {
    const q = evidenceQuery.parse(input);
    let loaded: Awaited<ReturnType<DiagnosticHistory['checkpoint']>>;
    try {
      loaded = await this.checkpoint(ctx, q.sessionId);
    } catch (error) {
      if (error instanceof DiagnosticError) throw error;
      throw new DiagnosticError('会话证据无法恢复', 503, 'DIAGNOSTIC_EVIDENCE_UNAVAILABLE');
    }
    const entry = loaded.saved.session.entries.find((e) => e.id === q.entryId);
    const selected = restore(loaded.saved.session)
      .getBranch()
      .some((e) => e.id === q.entryId);
    const base = {
      onSelectedBranch: selected,
      sessionId: q.sessionId,
      entryId: q.entryId,
      source: loaded.previous ? ('previous_checkpoint' as const) : ('checkpoint' as const),
      recovered: loaded.previous,
      truncated: false,
      total: 0,
    };
    if (!entry) return { ...base, available: false, reason: 'entry_missing_from_checkpoint' };
    let value: unknown = entry,
      nested = false;
    if (q.toolCallId) {
      if (entry.type !== 'message' || entry.message.role !== 'toolResult')
        return { ...base, available: false, reason: 'not_a_tool_result' };
      if (entry.message.toolCallId !== q.toolCallId) {
        const child = entry.message.nestedCalls?.calls.find((c) => c.id === q.toolCallId);
        if (!child) return { ...base, available: false, reason: 'nested_summary_missing' };
        nested = true;
        value = {
          sessionId: q.sessionId,
          entryId: q.entryId,
          summaryParentToolCallId: entry.message.toolCallId,
          parentToolCallId: null,
          parentAvailability: 'not_recorded_in_native_summary',
          call: child,
          complete: entry.message.nestedCalls?.complete,
          resultAvailability: 'not_persisted_native',
        };
      }
    }
    // Protection must complete on the entire selected Entry before any text is sliced.
    let text: string;
    try {
      text = JSON.stringify(this.sensitive.copy(value), null, 2);
    } catch {
      throw new DiagnosticError('证据敏感信息检查未完成', 503, 'DIAGNOSTIC_PROTECTION_FAILED');
    }
    const content = text.slice(q.offset, q.offset + q.limit),
      next = q.offset + content.length;
    return {
      ...base,
      available: !nested,
      nested,
      ...(nested ? { reason: 'not_persisted_native' } : {}),
      content,
      total: text.length,
      truncated: q.offset > 0 || next < text.length,
      ...(next < text.length ? { nextOffset: next } : {}),
    };
  }
}
