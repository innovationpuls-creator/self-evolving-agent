import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui';
import { useDemo } from '../state/store';
import type { Page } from '../state/model';

export function WorkspacePage({ children, page }: { children: ReactNode; page: string }) {
  return (
    <div className="aw" data-aw-page={page}>
      {children}
    </div>
  );
}
export function Heading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="aw-heading">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function Return({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <Button kind="ghost" className="aw-return" onClick={onClick}>
      <ArrowLeft size={15} />
      {children}
    </Button>
  );
}
export function Related({
  title,
  meta,
  page,
  object,
  onNavigate,
}: {
  title: string;
  meta: string;
  page: Page;
  onNavigate?: () => void;
  object?: { type: 'memory' | 'skills' | 'reflection' | 'trace' | 'evolution'; id: string };
}) {
  const x = useDemo();
  return (
    <button
      type="button"
      className="aw-related"
      onClick={() => {
        onNavigate?.();
        if (object) x.setObject(object.type, object.id);
        x.go(page);
      }}
    >
      <span>
        <small>{meta}</small>
        <strong>{title}</strong>
      </span>
      <ArrowUpRight size={16} />
    </button>
  );
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="aw-empty">
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function RowArrow() {
  return <ChevronRight size={17} className="aw-row-arrow" />;
}
export const skillNames: Record<string, string> = {
  'text-diff': '文档比较',
  'project-notes': '项目说明',
  'research-notes': '研究笔记',
};
export const skillName = (id: string) => skillNames[id] ?? id;

// These messages belong to A's reading/maintenance surfaces, not the B route.
export const workspaceStateMessages: Record<
  'memory' | 'reflection' | 'evolution',
  { empty: [string, string]; loading: string; error: [string, string] }
> = {
  memory: {
    empty: ['尚未保存记忆', '可以添加项目背景、事实或做事偏好。'],
    loading: '正在读取记忆…',
    error: ['记忆读取失败', '已保存的记忆没有被删除。可以重新读取。'],
  },
  reflection: {
    empty: ['还没有任务检查记录', '任务结束后留下的检查结果会保留在这里。'],
    loading: '正在读取任务检查记录…',
    error: ['任务检查记录读取失败', '这不代表检查失败。重新读取后查看实际结果。'],
  },
  evolution: {
    empty: ['还没有改进建议或讨论', '可以从希望 Agent 改变的行为开始讨论。'],
    loading: '正在读取改进建议与讨论…',
    error: ['改进建议读取失败', '重新读取不会启动开发，也不会重试已有活动。'],
  },
};
