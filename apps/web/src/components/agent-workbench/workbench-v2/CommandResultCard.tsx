import { useMemo, useState } from 'react';
import { useT } from '../../../i18n/index.ts';
import { summarizeCommandResult, type CommandResultSummary } from './commandResultUtils.ts';
import type { MessageTimelineItem } from './types.ts';
import { classNames, CopyTextButton, formatTime } from './utils.tsx';

type CommandResultCardProps = {
  item: MessageTimelineItem;
};

const maxStructuredEntries = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarClass(value: unknown): string {
  if (value === null) return 'text-text-tertiary';
  if (typeof value === 'number') return 'text-info';
  if (typeof value === 'boolean') return value ? 'text-success' : 'text-warning';
  return 'text-text-secondary';
}

function JsonScalar({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : value === null ? 'null' : String(value);
  return (
    <span className={classNames('break-words font-mono text-[11px]', scalarClass(value))}>
      {text}
    </span>
  );
}

function JsonValueView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (!Array.isArray(value) && !isRecord(value)) return <JsonScalar value={value} />;

  if (Array.isArray(value)) {
    const visible = value.slice(0, maxStructuredEntries);
    const remaining = value.length - visible.length;
    return (
      <div className={classNames('grid gap-1', depth > 0 && 'border-l border-border-soft pl-3')}>
        {visible.map((entry, index) => (
          <div key={`${depth}-${index}`} className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]">
            <span className="font-mono text-[11px] text-text-tertiary">[{index}]</span>
            <JsonValueView value={entry} depth={depth + 1} />
          </div>
        ))}
        {remaining > 0 && (
          <div className="text-[11px] text-text-tertiary">... {remaining} more</div>
        )}
      </div>
    );
  }

  const entries = Object.entries(value);
  const visible = entries.slice(0, maxStructuredEntries);
  const remaining = entries.length - visible.length;
  return (
    <div className={classNames('grid gap-1', depth > 0 && 'border-l border-border-soft pl-3')}>
      {visible.map(([key, entry]) => (
        <div
          key={`${depth}-${key}`}
          className="grid gap-1 sm:grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)]"
        >
          <span className="min-w-0 break-words font-mono text-[11px] text-text-tertiary">
            {key}
          </span>
          <JsonValueView value={entry} depth={depth + 1} />
        </div>
      ))}
      {remaining > 0 && <div className="text-[11px] text-text-tertiary">... {remaining} more</div>}
    </div>
  );
}

function resultTypeLabel(summary: CommandResultSummary, t: ReturnType<typeof useT>['t']): string {
  if (!summary.parsed) return t.workbench.v2.commandResultText(summary.lineCount);
  if (summary.kind === 'array')
    return t.workbench.v2.commandResultJsonArray(summary.itemCount ?? 0);
  if (summary.kind === 'object')
    return t.workbench.v2.commandResultJsonObject(summary.fieldCount ?? 0);
  return t.workbench.v2.commandResultJsonValue;
}

export function CommandResultCard({ item }: CommandResultCardProps) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeCommandResult(item.content), [item.content]);
  const repeatCount = item.repeatCount ?? 1;
  const repeatLabel = repeatCount > 1 ? t.workbench.v2.commandResultRepeat(repeatCount) : undefined;
  const resultLabel = resultTypeLabel(summary, t);
  const preview =
    summary.preview || (summary.parsed ? resultLabel : t.workbench.v2.commandResultEmpty);

  return (
    <article
      className="overflow-hidden rounded-sm border border-border-soft bg-bg-surface-1 shadow-sm"
      data-testid="command-result-card"
    >
      <div className="flex flex-wrap items-start gap-2 px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 rounded-xs text-left outline-none transition-colors hover:bg-bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40"
          data-testid="command-result-toggle"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          <span className={classNames('agent-chevron mt-0.5', expanded && 'agent-chevron-open')}>
            v
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase text-text-tertiary">
                {t.workbench.v2.commandResult}
              </span>
              <span className="rounded-pill border border-border-soft bg-bg-app px-2 py-0.5 font-mono text-[11px] text-text-tertiary">
                {resultLabel}
              </span>
              {repeatLabel && (
                <span
                  className="rounded-pill border border-info/30 bg-info-soft px-2 py-0.5 font-mono text-[11px] text-info"
                  data-testid="command-result-repeat"
                >
                  {repeatLabel}
                </span>
              )}
            </span>
            <span
              className="mt-1 block min-w-0 truncate text-sm text-text-secondary"
              title={preview}
            >
              {preview}
            </span>
          </span>
        </button>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
          <span className="rounded-pill border border-border-soft bg-bg-app px-2 py-1 font-mono text-xs text-text-tertiary">
            {t.workbench.v2.lineCount(summary.lineCount)}
          </span>
          <span className="text-[11px] text-text-tertiary">{formatTime(item.timestamp)}</span>
          <CopyTextButton
            text={item.content}
            label={t.workbench.v2.commandResultCopyRaw}
            dataTestId="command-result-copy-raw"
          />
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-border-soft bg-bg-surface-2 p-3">
          {summary.parsed ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase text-text-tertiary">
                {t.workbench.v2.commandResultStructured}
              </div>
              <div
                data-testid="command-result-structured"
                className="max-h-72 overflow-y-auto rounded-xs border border-border-soft bg-bg-app p-3"
              >
                <JsonValueView value={summary.value} />
              </div>
            </div>
          ) : (
            <div className="rounded-xs border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-text-secondary">
              {t.workbench.v2.commandResultInvalidJson}
            </div>
          )}

          <details className="rounded-xs border border-border-soft bg-bg-surface-1 px-2 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase text-text-tertiary">
              {t.workbench.v2.commandResultRaw}
            </summary>
            <pre
              data-testid="command-result-raw"
              className="mt-2 max-h-56 overflow-auto rounded-xs bg-bg-app p-3 font-mono text-xs leading-5 text-text-secondary"
            >
              {item.content || ' '}
            </pre>
          </details>
        </div>
      )}
    </article>
  );
}
