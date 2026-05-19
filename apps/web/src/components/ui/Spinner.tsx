import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';

export function Spinner({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('inline-block h-4 w-4 animate-spin rounded-full border border-current/25 border-t-current', className)}
      {...props}
    />
  );
}
