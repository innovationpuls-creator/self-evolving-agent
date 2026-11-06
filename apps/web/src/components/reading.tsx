import { ArrowLeft } from 'lucide-react';
import { Button, Notice } from './ui';
export const date = (time: number) =>
  new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time);
export const projectName = (path?: string) => path?.split('/').filter(Boolean).at(-1) || '项目未返回';
export function Failure({ error, retry }: { error: string; retry: () => void }) {
  return (
    <Notice title="读取未完成" tone="warn">
      <p role="alert">{error}</p>
      <Button onClick={retry}>重新读取</Button>
    </Notice>
  );
}
export function Back({ back, children = '返回' }: { back: () => void; children?: React.ReactNode }) {
  return (
    <Button kind="ghost" className="aw-return" onClick={back}>
      <ArrowLeft size={15} />
      {children}
    </Button>
  );
}
