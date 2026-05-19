import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-xs border border-border-default bg-bg-surface-1 px-3 py-1.5 text-sm text-text-primary outline-none',
        'placeholder:text-text-tertiary transition-[border-color,box-shadow,background-color] duration-140',
        'focus:border-accent focus:bg-bg-surface-1 focus:ring-1 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});
