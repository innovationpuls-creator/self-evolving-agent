import { useEffect, useState } from 'react';
import type { Api, Evidence, EvidenceReference } from './evidence';

const pageSize = 8192;
export function EvidenceView({
  api,
  reference,
  refresh = 0,
}: {
  api: Api;
  reference: EvidenceReference;
  refresh?: number;
}) {
  const [offset, setOffset] = useState(0);
  const [value, setValue] = useState<Evidence>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setBusy(true);
    setError('');
    const query = new URLSearchParams({ ...reference, offset: String(offset), limit: String(pageSize) });
    void api<Evidence>(`/diagnostics/evidence?${query}`, 'GET', undefined, controller.signal)
      .then((result) => {
        if (active) setValue(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '证据读取失败');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, reference.sessionId, reference.entryId, reference.toolCallId, offset, refresh, retry]);
  return (
    <section className="diagnostics-evidence" aria-label="原始执行证据" aria-busy={busy}>
      <h3>原始执行证据</h3>
      <p className="diagnostics-id">
        Session {reference.sessionId}
        <br />
        Entry {reference.entryId}
        {reference.toolCallId && (
          <>
            <br />
            Tool Call {reference.toolCallId}
          </>
        )}
      </p>
      {busy && !value && <p role="status">正在读取原始证据…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            重试证据
          </button>
        </p>
      )}
      {value && (
        <>
          {value.source === 'previous_checkpoint' && (
            <p className="notice">来自上一有效检查点，可能缺少最新执行进度。</p>
          )}
          {value.onSelectedBranch === false && <p className="notice">此证据来自历史分支；查看不会切换当前执行分支。</p>}
          {value.nested && <p>嵌套调用仅保留原生摘要，完整子调用结果未单独保存。</p>}
          {!value.available && (
            <p className="notice">
              {value.reason === 'not_persisted_native'
                ? 'Pi 原生历史未保存这项完整结果。'
                : `证据暂不可用：${value.reason ?? '未知原因'}`}
            </p>
          )}
          {value.content !== undefined && <pre>{value.content}</pre>}
          <div className="diagnostics-controls">
            <button
              type="button"
              disabled={busy || !offset}
              onClick={() => {
                setOffset(Math.max(0, offset - pageSize));
                setValue(undefined);
              }}
            >
              前一段证据
            </button>
            <small>
              {value.total ? offset + 1 : 0}–{Math.min(offset + (value.content?.length ?? 0), value.total)} /{' '}
              {value.total}
            </small>
            <button
              type="button"
              disabled={busy || value.nextOffset === undefined}
              onClick={() => {
                if (value.nextOffset !== undefined) {
                  setOffset(value.nextOffset);
                  setValue(undefined);
                }
              }}
            >
              后一段证据
            </button>
          </div>
        </>
      )}
    </section>
  );
}
