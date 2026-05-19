import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';

export function SectionPanel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        'border border-border-default bg-bg-surface-2 p-4 shadow-sm backdrop-blur-sm',
        className,
      )}
      {...props}
    />
  );
}

interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  titleClassName?: string;
  subtitleClassName?: string;
}

export function SectionHeader({
  icon,
  title,
  subtitle,
  actions,
  titleClassName,
  subtitleClassName,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'mb-4 flex items-start justify-between gap-3 border-b border-border-soft pb-3',
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-2">
        {icon && <span className="mt-0.5 flex-shrink-0 text-text-tertiary">{icon}</span>}
        <div className="min-w-0">
          <h2 className={cn('text-sm font-bold uppercase tracking-[0.075em] text-text-primary blend-lighter', titleClassName)}>{title}</h2>
          {subtitle && (
            <p className={cn('mt-1 text-sm leading-5 text-text-tertiary', subtitleClassName)}>{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
