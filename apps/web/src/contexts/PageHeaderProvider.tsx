import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeaderContext } from './page-header-context.ts';
import { useT } from '../i18n/index.ts';
import { cn } from '../lib/utils.ts';

function routeTitle(pathname: string, t: ReturnType<typeof useT>['t']): string {
  if (pathname.startsWith('/workbench') || pathname.startsWith('/runs') || pathname.startsWith('/tasks')) return t.nav.workbench;
  if (pathname.startsWith('/control-plane')) return t.nav.controlPlane;
  if (pathname.startsWith('/evals')) return t.nav.evals;
  if (pathname.startsWith('/templates')) return t.nav.templates;
  if (pathname.startsWith('/history')) return t.nav.history;
  if (pathname.startsWith('/config')) return t.nav.config;
  if (pathname.startsWith('/settings')) return t.nav.settings;
  return t.nav.devices;
}

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { t } = useT();
  const [titleOverride, setTitle] = useState<ReactNode | null>(null);
  const [afterTitle, setAfterTitle] = useState<ReactNode>(null);
  const [end, setEnd] = useState<ReactNode>(null);

  useLayoutEffect(() => {
    setTitle(null);
    setAfterTitle(null);
    setEnd(null);
  }, [pathname]);

  const value = useMemo(
    () => ({
      setAfterTitle,
      setEnd,
      setTitle,
    }),
    [],
  );
  const title = titleOverride ?? routeTitle(pathname, t);
  const isWorkspacePage =
    pathname.startsWith('/workbench') ||
    pathname.startsWith('/runs') ||
    pathname.startsWith('/tasks');

  return (
    <PageHeaderContext.Provider value={value}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className={cn(
            'app-page-header flex shrink-0 items-center border-b border-border-soft bg-bg-surface-1 px-3 backdrop-blur-md sm:px-5',
            isWorkspacePage ? 'min-h-12' : 'min-h-14',
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <h1 className="min-w-0 truncate text-[13px] font-bold uppercase leading-none tracking-[0.1em] text-text-primary blend-lighter sm:text-sm">
              {title}
            </h1>
            {afterTitle}
          </div>
          {end ? <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">{end}</div> : null}
        </header>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </PageHeaderContext.Provider>
  );
}
