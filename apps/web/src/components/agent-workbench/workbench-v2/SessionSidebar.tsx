import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Filter, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LoadingState } from '../../ui/LoadingState.tsx';
import { useT } from '../../../i18n/index.ts';
import { formatCompactDateTime } from '../../../lib/format.ts';
import type { WorkbenchSession, WorkbenchStatus } from './types.ts';
import { classNames, compactPath, StatusBadge } from './utils.tsx';

type SessionSidebarProps = {
  sessions: WorkbenchSession[];
  activeSessionId?: string;
  collapsed?: boolean;
  loading?: boolean;
  onToggleCollapse?: () => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
};

function sessionToneClasses(status: WorkbenchStatus): string {
  if (status === 'failed') return 'border-l-danger/70';
  if (status === 'cancelled') return 'border-l-warning/70';
  return 'border-l-success/70';
}

function sessionTime(session: WorkbenchSession): number {
  const value = Date.parse(session.updatedAt);
  return Number.isFinite(value) ? value : 0;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  collapsed = false,
  loading = false,
  onToggleCollapse,
  onSelectSession,
  onNewSession,
}: SessionSidebarProps) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sessions;
    return sessions.filter((session) =>
      [session.title, session.projectPath, session.model, session.provider ?? '', session.status].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    );
  }, [query, sessions]);
  const sortedSessions = useMemo(
    () => filteredSessions.slice().sort((a, b) => sessionTime(b) - sessionTime(a)),
    [filteredSessions]
  );
  const activeSession = sessions.find((session) => session.id === activeSessionId);

  useEffect(() => {
    if (!activeSessionId) return;
    setExpandedSessions((current) => ({ ...current, [activeSessionId]: true }));
  }, [activeSessionId]);

  function handleSessionClick(sessionId: string) {
    onSelectSession(sessionId);
    setExpandedSessions((current) => ({ ...current, [sessionId]: !current[sessionId] }));
  }

  if (collapsed) {
    return (
      <aside
        data-testid="session-sidebar"
        data-collapsed="true"
        className="agent-panel panel-swap-enter flex min-h-0 flex-col items-center gap-2 overflow-hidden py-2"
      >
        <button
          type="button"
          data-testid="session-sidebar-toggle"
          onClick={onToggleCollapse}
          aria-label={t.workbench.toolCallCard.expand}
          title={t.workbench.toolCallCard.expand}
          className="grid h-8 w-8 place-items-center rounded-xs text-text-tertiary hover:bg-bg-surface-2 hover:text-text-primary"
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNewSession}
          aria-label={t.workbench.newSession}
          title={t.workbench.newSession}
          className="grid h-8 w-8 place-items-center rounded-xs text-text-tertiary hover:bg-bg-surface-2 hover:text-text-primary"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-testid="session-sidebar"
      className="agent-panel panel-swap-enter flex min-h-0 flex-col overflow-hidden"
    >
      <div className="border-b border-border-soft px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary">{t.workbench.title}</div>
            <div className="mt-0.5 truncate text-xs text-text-tertiary">
              {activeSession ? compactPath(activeSession.projectPath) : t.workbench.v2.chooseOrStartSession}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-secondary h-8 px-2 text-xs" onClick={onNewSession}>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              {t.workbench.newSession}
            </button>
            {onToggleCollapse && (
              <button
                type="button"
                data-testid="session-sidebar-toggle"
                onClick={onToggleCollapse}
                aria-label={t.workbench.toolCallCard.collapse}
                title={t.workbench.toolCallCard.collapse}
                className="grid h-8 w-7 flex-shrink-0 place-items-center rounded-xs text-text-tertiary hover:bg-bg-surface-2 hover:text-text-primary"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="relative mt-3">
          <Filter
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="input-base h-8 px-8 py-1 text-xs"
            placeholder={t.workbench.searchSessions}
            aria-label={t.workbench.searchSessions}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading && sortedSessions.length === 0 && (
          <LoadingState
            data-testid="session-sidebar-loading"
            label={t.loading}
            className="min-h-24 rounded-sm bg-bg-surface-2 px-3 py-4 ring-1 ring-border-soft"
          />
        )}

        {sortedSessions.length > 0 && (
          <div className="space-y-1.5">
            {sortedSessions.map((session) => (
              <article
                key={session.id}
                className={classNames(
                  'overflow-hidden rounded-sm border border-l-[3px] transition-[background-color,border-color,box-shadow] duration-140',
                  sessionToneClasses(session.status),
                  session.id === activeSessionId
                    ? 'border-accent/35 bg-accent/10'
                    : 'border-border-soft bg-bg-surface-1 hover:border-border-strong hover:bg-bg-surface-2'
                )}
              >
                <button
                  type="button"
                  data-testid="mock-session"
                  onClick={() => handleSessionClick(session.id)}
                  aria-expanded={Boolean(expandedSessions[session.id])}
                  title={session.title}
                  className="w-full px-2.5 py-2.5 text-left"
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold leading-5 text-text-primary">{session.title}</div>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-text-tertiary">
                        <span className="max-w-[86px] truncate font-medium">{session.provider ?? t.workbench.common.defaultValue}</span>
                        <span className="h-1 w-1 shrink-0 rounded-pill bg-border-strong" aria-hidden="true" />
                        <time className="shrink-0 tabular-nums" dateTime={session.updatedAt}>
                          {formatCompactDateTime(session.updatedAt)}
                        </time>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <StatusBadge status={session.status} className="mt-0.5" />
                      {expandedSessions[session.id] ? (
                        <ChevronUp aria-hidden="true" className="mt-1 h-3.5 w-3.5 text-text-tertiary" />
                      ) : (
                        <ChevronDown aria-hidden="true" className="mt-1 h-3.5 w-3.5 text-text-tertiary" />
                      )}
                    </div>
                  </div>
                  <div className="mt-2 truncate text-[11px] leading-none text-text-disabled">
                    {compactPath(session.projectPath)}
                  </div>
                </button>

                {expandedSessions[session.id] && (
                  <div className="border-t border-border-soft bg-bg-surface-2 px-2.5 py-2 text-[11px] leading-5 text-text-tertiary">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      <span className="truncate">{t.workbench.review.sessionFields.status}</span>
                      <span className="truncate text-right text-text-secondary">{t.workbench.statusLabels[session.status]}</span>
                      <span className="truncate">{t.workbench.composer.provider}</span>
                      <span className="truncate text-right text-text-secondary">{session.provider ?? t.workbench.common.defaultValue}</span>
                      <span className="truncate">{t.workbench.model}</span>
                      <span className="truncate text-right text-text-secondary">{session.model}</span>
                      <span className="truncate">{t.workbench.header.permission}</span>
                      <span className="truncate text-right text-text-secondary">{session.permissionMode}</span>
                      <span className="truncate">{t.workbench.review.sessionFields.cwd}</span>
                      <span className="truncate text-right font-mono text-text-secondary">{compactPath(session.projectPath)}</span>
                      <span className="truncate">{t.workbench.v2.checkpointCreated}</span>
                      <span className="truncate text-right text-text-secondary">{session.checkpoints.length}</span>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {!loading && !sortedSessions.length && (
          <div className="rounded-sm bg-bg-surface-2 px-3 py-4 text-sm text-text-tertiary ring-1 ring-border-soft">
            {query.trim() ? t.workbench.v2.noSessionsMatch : t.workbench.sessionSidebar.noSessionsTitle}
          </div>
        )}
      </div>
    </aside>
  );
}
