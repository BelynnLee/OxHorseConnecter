import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { browseDirs, type BrowseResult } from '../api.ts';
import { useT } from '../i18n/index.ts';

interface DirPickerProps {
  value: string;
  onChange: (path: string) => void;
  onSelect?: (path: string) => void;
  browseStartPath?: string;
  browseDeviceId?: string;
  browseDisabled?: boolean;
  browseDisabledTitle?: string;
  selectedValue?: string;
  disabled?: boolean;
  placeholder?: string;
  inputTestId?: string;
  browseAriaLabel?: string;
  showBrowseLabel?: boolean;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  dropdownClassName?: string;
}

type Breadcrumb = {
  label: string;
  path: string;
  current: boolean;
};

function normalizeForCompare(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, '/');
  if (/^[A-Za-z]:\/?$/.test(normalized)) return `${normalized.slice(0, 2)}/`;
  if (normalized === '/') return normalized;
  return normalized.replace(/\/+$/, '');
}

function samePath(a: string, b: string): boolean {
  const normalizedA = normalizeForCompare(a);
  const normalizedB = normalizeForCompare(b);
  const windowsPath = /^[A-Za-z]:/.test(normalizedA) || /^[A-Za-z]:/.test(normalizedB);
  return windowsPath
    ? normalizedA.toLowerCase() === normalizedB.toLowerCase()
    : normalizedA === normalizedB;
}

function buildBreadcrumbs(pathValue: string): Breadcrumb[] {
  const normalized = pathValue.replace(/\\/g, '/');
  if (!normalized) return [];

  const driveMatch = normalized.match(/^([A-Za-z]:)(?:\/|$)/);
  if (driveMatch) {
    const drive = driveMatch[1];
    const parts = normalized.slice(drive.length).replace(/^\/+/, '').split('/').filter(Boolean);
    const crumbs: Breadcrumb[] = [{ label: drive, path: `${drive}/`, current: parts.length === 0 }];
    let pathSoFar = `${drive}/`;
    parts.forEach((part, idx) => {
      pathSoFar = pathSoFar.endsWith('/') ? `${pathSoFar}${part}` : `${pathSoFar}/${part}`;
      crumbs.push({ label: part, path: pathSoFar, current: idx === parts.length - 1 });
    });
    return crumbs;
  }

  if (normalized.startsWith('//')) {
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length < 2) return [{ label: normalized, path: normalized, current: true }];
    const root = `//${parts[0]}/${parts[1]}`;
    const rest = parts.slice(2);
    const crumbs: Breadcrumb[] = [
      { label: `${parts[0]}/${parts[1]}`, path: root, current: rest.length === 0 },
    ];
    let pathSoFar = root;
    rest.forEach((part, idx) => {
      pathSoFar = `${pathSoFar}/${part}`;
      crumbs.push({ label: part, path: pathSoFar, current: idx === rest.length - 1 });
    });
    return crumbs;
  }

  const absolute = normalized.startsWith('/');
  const parts = normalized.split('/').filter(Boolean);
  const crumbs: Breadcrumb[] = [];
  if (absolute) crumbs.push({ label: '/', path: '/', current: parts.length === 0 });
  parts.forEach((part, idx) => {
    const pathSoFar = absolute
      ? `/${parts.slice(0, idx + 1).join('/')}`
      : parts.slice(0, idx + 1).join('/');
    crumbs.push({ label: part, path: pathSoFar, current: idx === parts.length - 1 });
  });
  return crumbs;
}

function driveLetter(drivePath: string): string {
  return drivePath.replace(/[:\\/]/g, '').toUpperCase() + ':';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function shouldFallbackToBrowseRoot(error: unknown, dirPath: string | undefined): boolean {
  if (!dirPath?.trim()) return false;
  const message = errorMessage(error, '').toLowerCase();
  return message.includes('outside allowed_work_dir') || message.includes('directory not found');
}

export default function DirPicker({
  value,
  onChange,
  onSelect,
  browseStartPath,
  browseDeviceId,
  browseDisabled,
  browseDisabledTitle,
  selectedValue,
  disabled,
  placeholder,
  inputTestId,
  browseAriaLabel,
  showBrowseLabel = true,
  className,
  inputClassName,
  buttonClassName,
  dropdownClassName,
}: DirPickerProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const loadIdRef = useRef(0);
  const startPathRef = useRef<string | undefined>(browseStartPath || value || undefined);
  const browseDeviceIdRef = useRef<string | undefined>(browseDeviceId);

  const load = useCallback(async (dirPath?: string) => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    setLoading(true);
    setError('');
    try {
      const result = await browseDirs(dirPath?.trim() || undefined, browseDeviceId?.trim() || undefined);
      if (loadId !== loadIdRef.current) return;
      setBrowse(result);
    } catch (err: unknown) {
      if (loadId !== loadIdRef.current) return;
      if (shouldFallbackToBrowseRoot(err, dirPath)) {
        try {
          const fallback = await browseDirs(undefined, browseDeviceId?.trim() || undefined);
          if (loadId !== loadIdRef.current) return;
          setBrowse(fallback);
          setError('');
          return;
        } catch (fallbackErr: unknown) {
          if (loadId !== loadIdRef.current) return;
          setError(errorMessage(fallbackErr, errorMessage(err, t.dirPicker.errorBrowse)));
          return;
        }
      }
      setError(errorMessage(err, t.dirPicker.errorBrowse));
    } finally {
      if (loadId === loadIdRef.current) setLoading(false);
    }
  }, [browseDeviceId, t.dirPicker.errorBrowse]);

  function openPicker() {
    if (disabled || browseDisabled) return;
    browseDeviceIdRef.current = browseDeviceId;
    setOpen(true);
    load(browseStartPath || value || undefined);
  }

  function selectDir(pathValue: string) {
    (onSelect ?? onChange)(pathValue);
    setOpen(false);
  }

  function clearSelection() {
    onChange('');
    if (open) load();
  }

  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      openPicker();
    }
    if (e.key === 'Escape') setOpen(false);
  }

  useEffect(() => {
    startPathRef.current = browseStartPath || value || undefined;
  }, [browseStartPath, value]);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      browseDeviceIdRef.current = browseDeviceId;
      return;
    }
    if (browseDeviceIdRef.current === browseDeviceId) return;
    browseDeviceIdRef.current = browseDeviceId;
    load(startPathRef.current);
  }, [browseDeviceId, load, open]);

  function renderBreadcrumbs(pathValue: string) {
    const crumbs = buildBreadcrumbs(pathValue);
    if (crumbs.length === 0)
      return <span className="text-text-tertiary">{t.dirPicker.defaultBreadcrumb}</span>;
    return (
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {crumbs.map((crumb, idx) => (
          <div key={`${crumb.path}-${idx}`} className="flex min-w-0 shrink-0 items-center gap-0.5">
            {idx > 0 && <span className="text-text-tertiary select-none">/</span>}
            <button
              type="button"
              onClick={() => !crumb.current && load(crumb.path)}
              disabled={crumb.current}
              title={crumb.path}
              className={`max-w-36 truncate rounded-xs px-1 py-0.5 text-xs transition-colors ${
                crumb.current
                  ? 'cursor-default text-text-primary font-medium'
                  : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary'
              }`}
            >
              {crumb.label}
            </button>
          </div>
        ))}
      </div>
    );
  }

  const selectedPath = (selectedValue ?? value).trim();
  const currentSelected = Boolean(browse && selectedPath && samePath(selectedPath, browse.current));
  const hasDrives = browse?.drives && browse.drives.length > 0;
  const currentDrive = browse?.current
    ? browse.current.match(/^([A-Za-z]:)/)?.[1]?.toUpperCase()
    : null;

  return (
    <div ref={containerRef} className={`relative ${open ? 'z-[120]' : ''} ${className ?? ''}`}>
      {/* Input row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            data-testid={inputTestId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={inputClassName ?? 'input-base pr-8 font-mono text-sm'}
          />
          {selectedPath && !disabled && (
            <button
              type="button"
              onClick={clearSelection}
              aria-label={t.dirPicker.clear}
              className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-xs text-text-tertiary transition-colors hover:bg-bg-surface-3 hover:text-text-primary"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled || browseDisabled}
          aria-expanded={open}
          aria-label={browseAriaLabel ?? t.dirPicker.browse}
          title={browseDisabled ? browseDisabledTitle ?? t.dirPicker.browse : t.dirPicker.browse}
          className={
            buttonClassName ??
            'btn-secondary h-10 px-3 text-sm font-medium gap-1.5 flex items-center whitespace-nowrap'
          }
        >
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 7.5A2.5 2.5 0 015.5 5H10l2 2h6.5A2.5 2.5 0 0121 9.5v7A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5v-9z"
            />
          </svg>
          {showBrowseLabel && t.dirPicker.browse}
        </button>
      </div>

      {/* Floating dropdown — absolute so it doesn't push page content */}
      {open && (
        <div
          data-testid="dir-picker-dropdown"
          className={
            dropdownClassName ??
            'dir-picker-dropdown absolute left-0 right-0 top-full z-[130] mt-1 overflow-hidden rounded-sm border border-border-default'
          }
        >
          {/* Header */}
          <div className="border-b border-border-soft bg-bg-surface-3 px-3 py-2 space-y-1.5">
            {/* Action bar */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 min-w-0 flex-1">
                {/* Drive switcher — shown when at Windows drive root */}
                {hasDrives && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-text-tertiary mr-0.5">{t.dirPicker.drives}:</span>
                    {browse!.drives!.map((drive) => {
                      const label = driveLetter(drive);
                      const active = currentDrive === label;
                      return (
                        <button
                          key={drive}
                          type="button"
                          onClick={() => !active && load(drive)}
                          disabled={active}
                          className={`rounded-xs px-2 py-0.5 text-xs font-mono font-medium transition-colors ${
                            active
                              ? 'bg-accent text-primary-foreground cursor-default'
                              : 'text-text-secondary border border-border-default hover:bg-bg-surface-2 hover:text-text-primary'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Default + Up — shown when not at drive root */}
                {!hasDrives && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => load()}
                      className="rounded-xs px-2 py-0.5 text-xs text-text-secondary transition-colors hover:bg-bg-surface-2 hover:text-text-primary"
                    >
                      {t.dirPicker.defaultLocation}
                    </button>
                    {browse?.parent && (
                      <button
                        type="button"
                        onClick={() => load(browse.parent!)}
                        className="rounded-xs px-2 py-0.5 text-xs text-text-secondary transition-colors hover:bg-bg-surface-2 hover:text-text-primary"
                      >
                        {t.dirPicker.up}
                      </button>
                    )}
                  </div>
                )}
                {/* Up button also available when drives shown and not at root */}
                {hasDrives && browse?.parent && (
                  <button
                    type="button"
                    onClick={() => load(browse.parent!)}
                    className="rounded-xs px-2 py-0.5 text-xs text-text-secondary transition-colors hover:bg-bg-surface-2 hover:text-text-primary"
                  >
                    {t.dirPicker.up}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.dirPicker.close}
                className="shrink-0 rounded-xs p-1 text-text-tertiary transition-colors hover:bg-bg-surface-2 hover:text-text-primary"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Breadcrumbs */}
            <div className="font-mono text-xs min-h-[1.25rem]">
              {browse ? (
                renderBreadcrumbs(browse.current)
              ) : (
                <span className="text-text-tertiary">...</span>
              )}
            </div>
          </div>

          {/* "Use current directory" button */}
          {browse && (
            <button
              type="button"
              data-testid="dir-picker-current"
              onClick={() => selectDir(browse.current)}
              className={`flex w-full items-center justify-between gap-3 border-b border-border-soft px-3 py-2 text-left text-xs font-medium transition-colors ${
                currentSelected
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-secondary hover:bg-bg-surface-3 hover:text-text-primary'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {currentSelected && (
                  <svg
                    className="h-3.5 w-3.5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {currentSelected ? t.dirPicker.selectedCurrent : t.dirPicker.useCurrent}
              </span>
              <span className="text-text-tertiary tabular-nums">{browse.dirs.length}</span>
            </button>
          )}

          {/* Directory list */}
          <div className="dir-picker-list max-h-52 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 px-4 py-6 text-text-tertiary">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span className="text-sm">{t.dirPicker.loading}</span>
              </div>
            )}
            {error && (
              <div className="border-b border-danger/20 bg-danger-soft px-3 py-2">
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}
            {!loading && !error && browse?.dirs.length === 0 && (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-text-tertiary">{t.dirPicker.noSubdirectories}</p>
              </div>
            )}
            {!loading &&
              browse?.dirs.map((entry) => {
                const selected = Boolean(selectedPath && samePath(selectedPath, entry.path));
                return (
                  <div
                    key={entry.path}
                    className={`flex items-stretch border-b border-border-soft last:border-b-0 transition-colors ${selected ? 'bg-accent-soft' : 'hover:bg-bg-surface-3'}`}
                  >
                    <button
                      type="button"
                      onClick={() => load(entry.path)}
                      aria-label={`${t.dirPicker.openDirectory}: ${entry.name}`}
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:text-text-primary"
                    >
                      <svg
                        className="h-3.5 w-3.5 shrink-0 text-text-tertiary"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={1.8}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 7.5A2.5 2.5 0 015.5 5H10l2 2h6.5A2.5 2.5 0 0121 9.5v7A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5v-9z"
                        />
                      </svg>
                      <span className="min-w-0 truncate font-medium">{entry.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => selectDir(entry.path)}
                      className={`shrink-0 px-3 py-2 text-xs font-medium transition-colors ${
                        selected ? 'text-accent' : 'text-text-tertiary hover:text-accent'
                      }`}
                    >
                      {selected ? t.dirPicker.selected : t.dirPicker.choose}
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
