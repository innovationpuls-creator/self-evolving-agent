import { useEffect, useState } from 'react';
import type { Api, Evidence, EvidenceReference } from './evidence';

const pageSize = 8192;
export function EvidenceView({
  api,
  reference,
  refresh = 0,
  titled = true,
}: {
  api: Api;
  reference: EvidenceReference;
  refresh?: number;
  /** False when an enclosing disclosure already names the record. */
  titled?: boolean;
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
        if (active) setError(reason instanceof Error ? reason.message : '原始记录读取失败，请重试。');
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
    <section className="diagnostics-evidence" aria-label="原始记录" aria-busy={busy}>
      {titled && <h3>原始记录</h3>}
      <p className="diagnostics-id">
        会话 {reference.sessionId}
        <br />
        记录 {reference.entryId}
        {reference.toolCallId && (
          <>
            <br />
            步骤 {reference.toolCallId}
          </>
        )}
      </p>
      {busy && !value && <p role="status">正在读取原始记录…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            重新读取
          </button>
        </p>
      )}
      {value && (
        <>
          {value.source === 'previous_checkpoint' && (
            <p className="notice">来自上一有效检查点，可能缺少最新执行进度。</p>
          )}
          {value.onSelectedBranch === false && <p className="notice">此证据来自历史分支；查看不会切换当前执行分支。</p>}
          {value.nested && <p>内部步骤只保留了摘要，完整结果没有单独保存。</p>}
          {!value.available && (
            <p className="notice">
              {value.reason === 'not_persisted_native'
                ? '这一步的完整结果没有被保存。'
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
              上一段
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
              下一段
            </button>
          </div>
        </>
      )}
    </section>
  );
}
