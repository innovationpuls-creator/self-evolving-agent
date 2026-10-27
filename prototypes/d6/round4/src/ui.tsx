import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import * as Dialog from '@radix-ui/react-dialog';
export function Node({ active = false, selected = false }: { active?: boolean; selected?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="4" fill="currentColor" />
      {selected && (
        <motion.circle
          initial={{ r: 6 }}
          animate={{ r: 10 }}
          transition={{ duration: reduced ? 0 : 0.22 }}
          cx="14"
          cy="14"
          fill="none"
          stroke="currentColor"
        />
      )}
      {active && (
        <motion.circle
          cx="14"
          cy="14"
          r="10"
          fill="none"
          stroke="currentColor"
          strokeDasharray="18 45"
          animate={reduced ? {} : { rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '14px 14px' }}
        />
      )}
    </svg>
  );
}
export function Panel({
  title,
  children,
  open,
  close,
  drawer = false,
}: {
  title: string;
  children: ReactNode;
  open: boolean;
  close: () => void;
  drawer?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="r4-overlay" />
        <Dialog.Content className={`r4-dialog ${drawer ? 'drawer' : ''}`}>
          <div className="dialog-title">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close aria-label="关闭">×</Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">查看内容并作出选择，关闭返回原位置</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Scope({ names }: { names: string[] }) {
  return (
    <div className="scope">
      <span className="scope-label">授权的 Skill</span>
      <div className="scope-values">
        {names.length ? names.map((n) => <code key={n}>{n}</code>) : <span>未选择</span>}
      </div>
    </div>
  );
}
