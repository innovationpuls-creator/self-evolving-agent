import { ChevronDown } from 'lucide-react';
export function TaskTitle({ title, detail = false }: { title: string; detail?: boolean }) {
  if (!detail) return <h2 title={title}>{title}</h2>;
  return (
    <details className="host-task-title">
      <summary aria-label="展开完整任务标题">
        <h1 tabIndex={-1}>{title}</h1>
        <ChevronDown size={16} />
      </summary>
    </details>
  );
}
