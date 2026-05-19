import type { LabelHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';

interface FormFieldProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, 'children'> {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  labelClassName?: string;
  hintClassName?: string;
}

export function FormField({
  label,
  children,
  hint,
  labelClassName,
  hintClassName,
  className,
  ...props
}: FormFieldProps) {
  return (
    <label className={cn('block min-w-0', className)} {...props}>
      <span className={cn('mb-1.5 block text-sm font-medium text-text-secondary', labelClassName)}>
        {label}
      </span>
      {children}
      {hint && (
        <span className={cn('mt-1 block text-sm text-text-tertiary', hintClassName)}>{hint}</span>
      )}
    </label>
  );
}
