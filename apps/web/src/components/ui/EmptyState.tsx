import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';

interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

/**
 * Centered placeholder for empty lists or "no data" sections.
 * Use `children` for custom content; otherwise compose with `title` / `description` / `action`.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  if (children) {
    return (
      <div
        className={cn(
          'flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border-soft bg-bg-surface-1 p-6 text-center text-sm text-text-tertiary',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border-soft bg-bg-surface-1 p-6 text-center',
        className,
      )}
      {...props}
    >
      {icon && <div className="text-text-tertiary">{icon}</div>}
      {title && <div className="text-sm font-medium text-text-secondary">{title}</div>}
      {description && <div className="text-xs text-text-tertiary">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
