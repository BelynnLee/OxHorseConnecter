import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';
import { Spinner } from './Spinner.tsx';

interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
  spinnerClassName?: string;
}

export function LoadingState({ label, spinnerClassName, className, ...props }: LoadingStateProps) {
  return (
    <div
      className={cn('flex flex-1 items-center justify-center gap-3 text-text-tertiary', className)}
      {...props}
    >
      <Spinner className={spinnerClassName} />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
