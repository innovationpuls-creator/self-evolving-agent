import { useReflectionCatalog, reflectionStatusLabels, type ReflectionApi } from './reflection-state';
import './reflection.css';

export function ReflectionStatus({
  api,
  sessionId,
  onOpen,
}: {
  api: ReflectionApi;
  sessionId?: string;
  onOpen: () => void;
}) {
  const { catalog, error } = useReflectionCatalog(api, sessionId);
  if (!catalog && !error) return null;
  const jobs = [...(catalog?.jobs ?? [])].sort((a, b) => b.updated - a.updated);
  const active =
    jobs.find((job) => job.status === 'running') ??
    jobs.find((job) => job.status === 'waiting_user') ??
    jobs.find((job) => job.status === 'pending') ??
    jobs[0];
  if (!active && catalog?.availability.available && !error) return null;
  const unavailable = catalog && !catalog.availability.available;
  const status = error ? 'unknown' : (active?.status ?? 'waiting_user');
  const waiting = jobs.filter((job) => job.status === 'pending').length;
  const label = error ? '状态待刷新' : active ? reflectionStatusLabels[active.status] : '暂不可用';
  return (
    <div className="reflection-status" role="status">
      <button
        type="button"
        data-reflection-status={status}
        onClick={onOpen}
        title={error || (unavailable ? catalog.availability.reason : active?.error)}
      >
        <span className="reflection-status-dot" aria-hidden="true" />
        反思{label}
        {waiting > 1 ? ` · ${waiting} 项等待` : ''}
      </button>
    </div>
  );
}
