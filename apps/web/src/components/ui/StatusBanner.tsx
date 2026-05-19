import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils.ts';

type BannerTone = 'error' | 'success' | 'info' | 'warning';

const tones: Record<BannerTone, { container: string; icon: ReactNode }> = {
  error: {
    container: 'border-danger/30 bg-danger-soft text-danger',
    icon: <AlertCircle className="h-4 w-4 flex-shrink-0" />,
  },
  success: {
    container: 'border-success/30 bg-success-soft text-success',
    icon: <CheckCircle2 className="h-4 w-4 flex-shrink-0" />,
  },
  info: {
    container: 'border-info/30 bg-info-soft text-info',
    icon: <Info className="h-4 w-4 flex-shrink-0" />,
  },
  warning: {
    container: 'border-warning/30 bg-warning-soft text-warning',
    icon: <AlertTriangle className="h-4 w-4 flex-shrink-0" />,
  },
};

interface StatusBannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  tone?: BannerTone;
  message?: string;
  children?: ReactNode;
  /** Optional override for the leading icon. Pass `null` to hide it. */
  icon?: ReactNode | null;
}

/**
 * Inline status banner for page-level error / success / info / warning notices.
 * Renders nothing when `message` is empty and no children are provided.
 */
export function StatusBanner({
  tone = 'info',
  message,
  children,
  icon,
  className,
  ...props
}: StatusBannerProps) {
  const content = children ?? message;
  if (!content) return null;
  const tokens = tones[tone];
  const leadingIcon = icon === undefined ? tokens.icon : icon;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 rounded-sm border text-sm',
        tokens.container,
        className,
      )}
      {...props}
    >
      {leadingIcon}
      <span className="min-w-0 break-words">{content}</span>
    </div>
  );
}
