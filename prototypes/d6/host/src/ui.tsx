import type { ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
export { Button } from '../../src/components/ui';
// A's existing Notice markup and tokens without the demo-store dependency.
export function Notice({
  title,
  children,
  tone = 'neutral',
}: {
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'warn';
}) {
  return (
    <div className={`notice ${tone}`}>
      <div className="notice-icon">{tone === 'neutral' ? <Info size={17} /> : <AlertTriangle size={17} />}</div>
      <div>
        <strong>{title}</strong>
        {children && <div className="notice-copy">{children}</div>}
      </div>
    </div>
  );
}
