import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';

export function SurfaceItem({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xs bg-bg-app px-3 py-2 ring-1 ring-border-soft', className)}
      {...props}
    />
  );
}
