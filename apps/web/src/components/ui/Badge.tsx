import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';

type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'outline';

const tones: Record<BadgeTone, string> = {
  default: 'border-accent/35 bg-accent-soft text-accent',
  success: 'border-success/35 bg-success-soft text-success',
  warning: 'border-warning/35 bg-warning-soft text-warning',
  danger: 'border-danger/35 bg-danger-soft text-danger',
  info: 'border-info/35 bg-info-soft text-info',
  muted: 'border-border-default bg-bg-surface-3 text-text-tertiary',
  outline: 'border-border-default bg-transparent text-text-secondary',
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export function Badge({ className, tone = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1.5 rounded-pill border px-2 text-xs font-semibold leading-none',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
