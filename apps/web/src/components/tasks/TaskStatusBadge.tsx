import type { HTMLAttributes, ReactNode } from 'react';
import type { TaskStatus } from '../../types.ts';
import { cn } from '../../lib/utils.ts';

const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  queued: 'bg-accent-soft border-accent/30 text-accent',
  running: 'bg-info-soft border-info/30 text-info',
  waiting_approval: 'bg-warning-soft border-warning/30 text-warning',
  completed: 'bg-success-soft border-success/30 text-success',
  failed: 'bg-danger-soft border-danger/30 text-danger',
  cancelled: 'bg-bg-surface-3 border-border-default text-text-tertiary',
};

interface TaskStatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: TaskStatus;
  label?: ReactNode;
  showRunningDot?: boolean;
}

export function TaskStatusBadge({
  status,
  label,
  showRunningDot = false,
  className,
  ...props
}: TaskStatusBadgeProps) {
  return (
    <span className={cn('status-badge border', TASK_STATUS_STYLES[status], className)} {...props}>
      {showRunningDot && status === 'running' && (
        <span className="h-1.5 w-1.5 rounded-full bg-info animate-pulse" />
      )}
      {label ?? status}
    </span>
  );
}
