import type { ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';

export interface SegmentedTab<T extends string> {
  id: T;
  icon?: ReactNode;
  label: ReactNode;
}

interface SegmentedTabsProps<T extends string> {
  className?: string;
  onChange: (id: T) => void;
  tabs: Array<SegmentedTab<T>>;
  value: T;
}

export function SegmentedTabs<T extends string>({
  className,
  onChange,
  tabs,
  value,
}: SegmentedTabsProps<T>) {
  return (
    <div
      className={cn(
        'flex max-w-full flex-wrap gap-1 border-b border-border-soft pb-3',
        className,
      )}
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            aria-selected={active}
            className={cn(
              'inline-flex h-8 min-w-0 items-center gap-2 rounded-xs border px-3 text-xs font-semibold outline-none transition-colors duration-140',
              'focus-visible:ring-1 focus-visible:ring-ring',
              active
                ? 'border-accent/50 bg-accent-soft text-accent'
                : 'border-border-default bg-bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary',
            )}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            type="button"
          >
            {tab.icon && <span className="shrink-0">{tab.icon}</span>}
            <span className="truncate">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
