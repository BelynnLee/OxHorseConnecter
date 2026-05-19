import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ChevronLeft,
  Clock,
  FileText,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Network,
  Palette,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { THEMES, useTheme, type Theme } from '../contexts/ThemeContext.tsx';
import { PageHeaderProvider } from '../contexts/PageHeaderProvider.tsx';
import { LOCALE_LABELS, SUPPORTED_LOCALES, useT, type Locale } from '../i18n/index.ts';
import { cn } from '../lib/utils.ts';
import { Backdrop } from './Backdrop.tsx';
import { Button } from './ui/Button.tsx';

interface NavItem {
  icon: ComponentType<{ className?: string }>;
  label: string;
  to: string;
}

function LocaleSelect({
  locale,
  setLocale,
  compact = false,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  compact?: boolean;
}) {
  const { t } = useT();
  return (
    <label className="relative flex min-w-0 items-center">
      <Languages className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-text-tertiary" />
      <select
        aria-label={t.nav.language}
        title={LOCALE_LABELS[locale].label}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="h-8 min-w-0 rounded-xs border border-border-default bg-bg-surface-1 py-1 pl-7 pr-2 text-xs font-medium text-text-secondary outline-none transition-colors duration-140 hover:border-border-strong hover:text-text-primary focus:border-accent"
      >
        {SUPPORTED_LOCALES.map((value) => (
          <option key={value} value={value}>
            {compact ? LOCALE_LABELS[value].short : LOCALE_LABELS[value].label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  const { t } = useT();
  return (
    <label className="relative flex min-w-0 items-center">
      <Palette className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-text-tertiary" />
      <select
        aria-label={t.nav.theme}
        value={theme}
        onChange={(event) => setTheme(event.target.value as Theme)}
        className="h-8 min-w-0 rounded-xs border border-border-default bg-bg-surface-1 py-1 pl-7 pr-2 text-xs font-medium text-text-secondary outline-none transition-colors duration-140 hover:border-border-strong hover:text-text-primary focus:border-accent"
      >
        {THEMES.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SidebarNavLink({
  item,
  collapsed = false,
  onNavigate,
}: {
  item: NavItem;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.to === '/devices'}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          cn(
            'group relative flex min-w-0 items-center py-2.5',
            collapsed ? 'justify-center px-0' : 'gap-3 px-5',
            'text-[12px] font-semibold uppercase tracking-[0.12em]',
            'outline-none transition-[color,opacity,background-color,padding] duration-200',
            'focus-visible:ring-1 focus-visible:ring-ring',
            isActive
              ? 'text-text-primary opacity-100'
              : 'text-text-secondary opacity-60 hover:bg-bg-surface-2 hover:text-text-primary hover:opacity-100',
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon className="h-4 w-4 shrink-0" />
            <span
              aria-hidden={collapsed || undefined}
              className={cn(
                'nav-label truncate',
                collapsed ? 'nav-label-collapsed' : 'nav-label-expanded',
              )}
            >
              {item.label}
            </span>
            {isActive && (
              <span
                aria-hidden
                className="absolute bottom-1.5 left-0 top-1.5 w-px bg-accent shadow-[0_0_16px_rgb(var(--accent)/0.45)]"
              />
            )}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-1 left-1.5 right-1.5 bg-text-primary opacity-0 transition-opacity duration-200 group-hover:opacity-[0.045]"
            />
          </>
        )}
      </NavLink>
    </li>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, locale, setLocale } = useT();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 768px)').matches,
  );
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('rac:layout:navCollapsed') === '1';
  });
  useEffect(() => {
    window.localStorage.setItem('rac:layout:navCollapsed', navCollapsed ? '1' : '0');
  }, [navCollapsed]);
  const desktopCollapsed = isDesktop && navCollapsed && !mobileOpen;
  const isWorkspacePage = pathname.startsWith('/workbench') || pathname.startsWith('/runs') || pathname.startsWith('/tasks');

  const navItems = useMemo<NavItem[]>(
    () => [
      { to: '/devices', label: t.nav.devices, icon: Monitor },
      { to: '/workbench', label: t.nav.workbench, icon: LayoutDashboard },
      { to: '/control-plane', label: t.nav.controlPlane, icon: Network },
      { to: '/templates', label: t.nav.templates, icon: FileText },
      { to: '/config', label: t.nav.config, icon: Settings },
      { to: '/settings', label: t.nav.settings, icon: ShieldCheck },
    ],
    [t],
  );

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const updateViewportState = () => {
      setIsDesktop(query.matches);
      if (query.matches) setMobileOpen(false);
    };
    updateViewportState();
    query.addEventListener('change', updateViewportState);
    return () => query.removeEventListener('change', updateViewportState);
  }, []);

  const contentPaddingClass = isWorkspacePage
    ? 'px-2 py-2 md:px-3 md:py-3'
    : 'px-3 py-3 sm:px-5 sm:py-4 lg:px-6 lg:py-5';
  const contentWidthClass = isWorkspacePage ? 'max-w-none' : 'max-w-7xl';
  const sidebarHiddenFromA11y = !isDesktop && !mobileOpen;

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-bg-app text-text-primary">
      <Backdrop />

      <header className="fixed left-0 right-0 top-0 z-40 flex h-12 items-center justify-between border-b border-border-soft bg-bg-surface-1 px-3 backdrop-blur-md md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(true)}
          aria-label={t.nav.toggleMenu}
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <div className="min-w-0 text-center text-[13px] font-bold uppercase leading-none tracking-[0.12em] text-text-primary blend-lighter">
          {t.nav.brand}
        </div>
        <div className="h-9 w-9" />
      </header>

      {mobileOpen && (
        <button
          type="button"
          aria-label={t.nav.toggleMenu}
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 backdrop-blur-sm md:hidden"
          style={{ background: 'var(--overlay-backdrop)' }}
        />
      )}

      <aside
        id="app-sidebar"
        aria-label={t.nav.toggleMenu}
        aria-hidden={sidebarHiddenFromA11y ? true : undefined}
        {...(sidebarHiddenFromA11y ? { inert: '' } : {})}
        className={cn(
          'app-sidebar nav-rail fixed left-0 top-0 z-50 flex h-full min-h-0 flex-col border-r border-border-soft backdrop-blur-md',
          'md:sticky md:translate-x-0',
          desktopCollapsed ? 'w-14' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div
          className={cn(
            'flex h-16 shrink-0 items-center border-b border-border-soft transition-[padding] duration-200',
            desktopCollapsed ? 'justify-center px-1' : 'justify-between px-5',
          )}
        >
          <div
            aria-hidden={desktopCollapsed || undefined}
            className={cn(
              'nav-fade min-w-0',
              desktopCollapsed ? 'pointer-events-none w-0 opacity-0' : 'opacity-100',
            )}
          >
            <div className="text-[15px] font-bold uppercase leading-[0.95] tracking-[0.12em] text-text-primary blend-lighter">
              {t.nav.brand}
            </div>
            <div className="mt-1 flex items-center gap-1.5 truncate text-[10px] uppercase tracking-[0.14em] text-text-tertiary">
              <Sparkles className="h-3 w-3 shrink-0" />
              {t.nav.subtitle}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(false)}
            aria-label={t.nav.toggleMenu}
            className="md:hidden"
          >
            <X className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNavCollapsed((value) => !value)}
            aria-label={t.nav.toggleMenu}
            aria-expanded={!desktopCollapsed}
            title={t.nav.toggleMenu}
            className="hidden md:inline-flex"
            data-testid="layout-nav-toggle"
          >
            <ChevronLeft
              className={cn(
                'h-4 w-4 transition-transform duration-300 ease-out',
                desktopCollapsed && 'rotate-180',
              )}
            />
          </Button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto border-t border-border-soft py-2">
          <ul className="flex flex-col">
            {navItems.map((item) => (
              <SidebarNavLink
                key={item.to}
                item={item}
                collapsed={desktopCollapsed}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
          </ul>
        </nav>

        <div
          key={desktopCollapsed ? 'bottom-collapsed' : 'bottom-expanded'}
          className={cn(
            'agent-message-enter border-t border-border-soft py-3',
            desktopCollapsed ? 'flex flex-col items-center gap-2 px-1' : 'px-4',
          )}
        >
          {desktopCollapsed ? (
            <>
              <div
                className="grid h-8 w-8 shrink-0 place-items-center border border-border-default bg-bg-surface-3 text-xs font-semibold text-text-primary"
                title={user?.username ?? 'admin'}
              >
                {user?.username?.[0]?.toUpperCase() ?? 'A'}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                aria-label={t.nav.logout}
                title={t.nav.logout}
                className="text-danger"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center border border-border-default bg-bg-surface-3 text-xs font-semibold text-text-primary">
                  {user?.username?.[0]?.toUpperCase() ?? 'A'}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text-primary">{user?.username ?? 'admin'}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                    <Clock className="h-3 w-3" />
                    <span>{t.nav.session}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ThemeSelect />
                <LocaleSelect locale={locale} setLocale={setLocale} compact />
              </div>

              <Button variant="ghost" size="sm" onClick={logout} className="mt-3 w-full justify-start text-danger">
                <LogOut className="h-4 w-4" />
                {t.nav.logout}
              </Button>
            </>
          )}
        </div>
      </aside>

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col pt-12 md:pt-0">
        <PageHeaderProvider>
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${contentPaddingClass}`}>
            <div className={`mx-auto flex min-h-0 w-full flex-1 flex-col ${contentWidthClass}`}>
              <Outlet />
            </div>
          </div>
        </PageHeaderProvider>
      </div>
    </div>
  );
}
