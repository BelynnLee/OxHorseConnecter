import { useLayoutEffect, type HTMLAttributes, type ReactNode } from 'react';
import { PanelTop } from 'lucide-react';
import { usePageHeader } from '../../contexts/usePageHeader.ts';

interface PageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned action slot (buttons, filters, etc.). */
  actions?: ReactNode;
}

/**
 * Standard page header: square icon tile + uppercase title + optional subtitle and actions.
 * Mirrors the existing layout used across HistoryPage / DevicesPage / SettingsPage so the
 * visual treatment stays consistent.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
  className: _className,
  ..._props
}: PageHeaderProps) {
  const { setAfterTitle, setEnd, setTitle } = usePageHeader();

  useLayoutEffect(() => {
    setTitle(title);
    setAfterTitle(
      subtitle || icon ? (
        <div className="hidden min-w-0 items-center gap-2 sm:flex">
          <span className="grid h-6 w-6 place-items-center border border-border-soft bg-bg-surface-2 text-text-tertiary">
            {icon ?? <PanelTop className="h-3.5 w-3.5" />}
          </span>
          {subtitle && (
            <span className="max-w-[42rem] truncate text-xs text-text-tertiary">{subtitle}</span>
          )}
        </div>
      ) : null,
    );
    setEnd(actions ?? null);
    return () => {
      setTitle(null);
      setAfterTitle(null);
      setEnd(null);
    };
  }, [actions, icon, setAfterTitle, setEnd, setTitle, subtitle, title]);

  return null;
}
