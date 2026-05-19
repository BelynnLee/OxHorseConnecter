import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';

interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  contentClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
  hintClassName?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  contentClassName,
  labelClassName,
  valueClassName,
  hintClassName,
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(
        'w-full border border-border-default bg-bg-surface-2 text-text-primary shadow-sm backdrop-blur-sm',
        className
      )}
      {...props}
    >
      <div className={cn('flex items-center justify-between gap-3 p-4 py-3', contentClassName)}>
        <div className="min-w-0">
          <p
            className={cn(
              'text-[11px] font-semibold uppercase tracking-[0.12em] text-text-tertiary',
              labelClassName
            )}
          >
            {label}
          </p>
          <p className={cn('mt-1 text-2xl font-semibold text-text-primary', valueClassName)}>
            {value}
          </p>
          {hint && (
            <p className={cn('mt-0.5 text-[11px] text-text-tertiary', hintClassName)}>{hint}</p>
          )}
        </div>
        {icon && <div className="flex-shrink-0">{icon}</div>}
      </div>
    </div>
  );
}
