import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'icon';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    'border-accent/60 bg-accent text-[var(--accent-foreground)] shadow-[0_0_0_1px_rgb(var(--accent)/0.18),0_12px_28px_-18px_rgb(var(--accent)/0.9)] hover:bg-accent-hover',
  secondary:
    'border-border-default bg-bg-surface-2 text-text-primary hover:border-border-strong hover:bg-bg-surface-3',
  ghost:
    'border-transparent bg-transparent text-text-secondary hover:bg-bg-surface-3 hover:text-text-primary',
  danger:
    'border-danger/35 bg-danger-soft text-danger hover:border-danger/55 hover:bg-danger/20',
  outline:
    'border-border-default bg-transparent text-text-secondary hover:border-border-strong hover:bg-bg-surface-2 hover:text-text-primary',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  icon: 'h-9 w-9 p-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-xs border font-semibold outline-none',
        'tracking-normal transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-140',
        'focus-visible:ring-1 focus-visible:ring-ring active:translate-y-px disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
