import { useMemo } from 'react';
import type { TaskEvent } from '../types.ts';
import { formatDateTime } from '../lib/format.ts';
import { useT } from '../i18n/index.ts';

type TimelineApprovalStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired';

interface TimelineItem {
  id: string;
  createdAt: string;
  tool: string;
  action: string;
  inputSummary?: string;
  approvalStatus: TimelineApprovalStatus;
  approvalReason?: string;
  rawOutput: string;
}

const APPROVAL_COLORS: Record<TimelineApprovalStatus, string> = {
  not_required: 'bg-bg-surface-3 border-border-default text-text-tertiary',
  pending:      'bg-warning-soft border-warning/30 text-warning',
  approved:     'bg-success-soft border-success/30 text-success',
  rejected:     'bg-danger-soft border-danger/30 text-danger',
  expired:      'bg-bg-surface-3 border-border-default text-text-disabled',
};

function getEventSeq(event: TaskEvent): number | undefined {
  return (event as TaskEvent & { seq?: number }).seq;
}

function sortEvents(events: TaskEvent[]): TaskEvent[] {
  return [...events].sort((left, right) => {
    const leftSeq = getEventSeq(left);
    const rightSeq = getEventSeq(right);

    if (typeof leftSeq === 'number' && typeof rightSeq === 'number') {
      return leftSeq - rightSeq;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function summarizeOutput(rawOutput: string): string {
  const normalized = rawOutput.trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= 240) {
    return normalized;
  }

  return `${normalized.slice(0, 240)}...`;
}

function buildTimelineItems(events: TaskEvent[]): TimelineItem[] {
  const ordered = sortEvents(events);
  const items: Array<TimelineItem & { outputChunks: string[] }> = [];
  let current: (TimelineItem & { outputChunks: string[] }) | null = null;

  for (const event of ordered) {
    const payload = event.payload as Record<string, unknown>;

    if (event.type === 'task.tool_call') {
      current = {
        id: event.id,
        createdAt: event.createdAt,
        tool: String(payload.tool ?? 'tool'),
        action: String(payload.action ?? 'run'),
        inputSummary:
          typeof payload.inputSummary === 'string' ? payload.inputSummary : undefined,
        approvalStatus: payload.requiresApproval ? 'pending' : 'not_required',
        rawOutput: '',
        outputChunks: [],
      };
      items.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    if (event.type === 'task.approval_requested') {
      current.approvalStatus = 'pending';
      current.approvalReason =
        typeof payload.reason === 'string' ? payload.reason : current.approvalReason;
      continue;
    }

    if (event.type === 'task.approval_resolved') {
      const status = payload.status;
      if (
        status === 'approved' ||
        status === 'rejected' ||
        status === 'expired'
      ) {
        current.approvalStatus = status;
      }
      continue;
    }

    if (event.type === 'task.log') {
      const message =
        typeof payload.message === 'string' ? payload.message.trim() : '';
      const stream = typeof payload.stream === 'string' ? payload.stream : '';
      const shouldCapture = stream === 'system' || current.tool === 'codex';

      if (message && shouldCapture) {
        current.outputChunks.push(message);
      }
    }
  }

  return items.map(({ outputChunks, ...item }) => ({
    ...item,
    rawOutput: outputChunks.join('\n\n').trim(),
  }));
}

interface CommandTimelineProps {
  events: TaskEvent[];
}

export function CommandTimeline({ events }: CommandTimelineProps) {
  const { t } = useT();
  const items = useMemo(() => buildTimelineItems(events), [events]);

  return (
    <section className="bg-bg-surface-2 border border-border-default rounded-md overflow-hidden">
      <div className="border-b border-border-soft px-5 py-3">
        <h2 className="text-sm font-semibold text-text-primary">{t.timeline.title}</h2>
      </div>
      <div className="divide-y divide-border-soft">
        {items.length === 0 ? (
          <div className="px-5 py-6 text-sm text-text-tertiary">{t.timeline.noItems}</div>
        ) : (
          items.map((item) => {
            const outputSummary = summarizeOutput(item.rawOutput);

            return (
              <div key={item.id} className="px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-xs bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent font-mono">
                        {item.tool}
                      </span>
                      <span className="text-xs text-text-disabled">{formatDateTime(item.createdAt)}</span>
                    </div>
                    <div className="mt-2 break-words font-mono text-sm text-text-secondary">
                      {item.action}
                    </div>
                  </div>
                  <span
                    className={`status-badge border flex-shrink-0 ${APPROVAL_COLORS[item.approvalStatus]}`}
                  >
                    {t.timeline.approvalLabels[item.approvalStatus]}
                  </span>
                </div>

                {item.inputSummary ? (
                  <p className="mt-2 text-sm text-text-tertiary">{item.inputSummary}</p>
                ) : null}

                {item.approvalReason ? (
                  <p className="mt-2 text-sm text-warning">{item.approvalReason}</p>
                ) : null}

                {outputSummary ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-text-secondary font-mono leading-relaxed">
                    {outputSummary}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-text-disabled">{t.timeline.noOutput}</p>
                )}

                {item.rawOutput ? (
                  <details className="mt-3 overflow-hidden rounded-sm border border-border-default bg-bg-surface-3">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors">
                      {t.timeline.fullOutput}
                    </summary>
                    <pre className="overflow-x-auto border-t border-border-soft px-3 py-3 text-xs leading-5 text-text-secondary font-mono">
                      {item.rawOutput}
                    </pre>
                  </details>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
