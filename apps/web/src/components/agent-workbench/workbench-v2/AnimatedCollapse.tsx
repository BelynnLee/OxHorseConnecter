import type { ReactNode } from 'react';
import { classNames } from './utils.tsx';

type AnimatedCollapseProps = {
  open: boolean;
  children: ReactNode;
  className?: string;
};

export function AnimatedCollapse({ open, children, className }: AnimatedCollapseProps) {
  return (
    <div className={classNames('agent-collapse', open && 'agent-collapse-open', className)}>
      <div className="agent-collapse-content min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
