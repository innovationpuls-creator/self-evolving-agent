import type { DiagnosticTrace } from '../../../../host/diagnostics/diagnostics';

export const statuses: Record<DiagnosticTrace['status'], string> = {
  running: '运行中',
  ended: '执行已结束',
  stopped: '已停止',
  failed: '执行失败',
  interrupted: '运行中断',
};
export const callStatuses: Record<string, string> = {
  running: '运行中',
  succeeded: '调用成功',
  success: '调用成功',
  completed: '调用已完成',
  failed: '调用失败',
  stopped: '已停止',
  interrupted: '调用中断',
  unknown: '状态未知',
  ok: '调用成功',
  error: '调用失败',
  unfinished: '调用未完成',
};
export const date = (value: number | undefined | null) =>
  value == null ? '未知' : new Date(value).toLocaleString('zh-CN');
export const duration = (value: number | undefined | null) =>
  value == null ? '耗时未知' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;

export function Metrics({ value }: { value: unknown }) {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  const usage = data?.usage && typeof data.usage === 'object' ? (data.usage as Record<string, unknown>) : data;
  const cost = usage?.cost && typeof usage.cost === 'object' ? (usage.cost as Record<string, unknown>) : undefined;
  const fields: [string, unknown][] = [
    ['输入 Tokens', usage?.input],
    ['输出 Tokens', usage?.output],
    ['缓存读取 Tokens', usage?.cacheRead],
    ['缓存写入 Tokens', usage?.cacheWrite],
    ['推理 Tokens', usage?.reasoning],
    ['整理前 Tokens', data?.tokensBefore],
    ['整理后 Tokens（估算）', data?.estimatedTokensAfter],
  ];
  return value && typeof value === 'object' && Object.keys(value).length ? (
    <div className="trajectory-metrics">
      <dl>
        {fields
          .filter(([, amount]) => typeof amount === 'number')
          .map(([label, amount]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{String(amount)}</dd>
            </div>
          ))}
      </dl>
      {fields.some(([, amount]) => amount === 0) && <small>Token 数为统计值，显示 0 不代表没有消耗。</small>}
      {typeof cost?.total === 'number' && cost.total > 0 && <p>估算费用：${cost.total.toFixed(6)}（非账单金额）</p>}
      <details>
        <summary>详细指标与关联</summary>
        <pre>{JSON.stringify(value, null, 2)}</pre>
      </details>
    </div>
  ) : null;
}
