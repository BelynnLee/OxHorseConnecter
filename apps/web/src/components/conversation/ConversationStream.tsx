import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Approval } from '../../types.ts';

export type ConversationRole = 'user' | 'assistant' | 'system' | 'tool';
export type ConversationKind =
  | 'message'
  | 'step'
  | 'tool'
  | 'file'
  | 'approval'
  | 'error'
  | 'summary'
  | 'debug';
export type ConversationStatus = 'streaming' | 'completed' | 'failed' | 'running';

export interface ConversationItem {
  id: string;
  role: ConversationRole;
  kind: ConversationKind;
  content: string;
  status: ConversationStatus;
  createdAt: string;
  turnId?: string;
  toolCallId?: string;
  approval?: Approval;
}

export interface ConversationLabels {
  running: string;
  placeholder: string;
  backToBottom: string;
  labels: Record<ConversationRole, string> & {
    stepRunning: string;
    step: string;
    file: string;
    approval: string;
    error: string;
    summary: string;
  };
}

interface ConversationActivity {
  show: boolean;
  label: string;
}

interface ConversationStreamProps {
  items: ConversationItem[];
  labels: ConversationLabels;
  version: unknown;
  emptyTitle: string;
  emptySubtitle?: string;
  activity?: ConversationActivity;
  className?: string;
  contentClassName?: string;
  renderItem?: (item: ConversationItem) => ReactNode | undefined;
}

function labelFor(item: ConversationItem, labels: ConversationLabels): string {
  if (item.kind === 'step') {
    return item.status === 'running' ? labels.labels.stepRunning : labels.labels.step;
  }
  if (item.kind === 'file') return labels.labels.file;
  if (item.kind === 'approval') return labels.labels.approval;
  if (item.kind === 'error') return labels.labels.error;
  if (item.kind === 'summary') return labels.labels.summary;
  return labels.labels[item.role];
}

function messageClass(item: ConversationItem): string {
  if (item.kind === 'error') return 'border-danger/30 bg-danger-soft text-danger';
  if (item.kind === 'approval') return 'border-warning/30 bg-warning-soft text-warning';
  if (item.kind === 'step') return 'border-info/20 bg-info-soft text-info';
  if (item.kind === 'file') return 'border-success/20 bg-success-soft text-success';
  if (item.role === 'user') return 'border-accent/30 bg-accent/10 text-text-primary';
  if (item.role === 'assistant') return 'border-border-soft bg-bg-surface-2 text-text-primary';
  if (item.role === 'tool') return 'border-border-soft bg-bg-surface-3 text-text-secondary';
  return 'border-border-soft bg-bg-surface-2 text-text-secondary';
}

function isActive(item: ConversationItem): boolean {
  return item.status === 'streaming' || item.status === 'running';
}

function ConversationActivityIndicator({ label }: { label: string }) {
  return (
    <div
      data-testid="conversation-activity"
      className="agent-message-enter flex items-center gap-2 rounded-sm border border-info/20 bg-info-soft px-3 py-2 text-sm text-info"
    >
      <span className="flex h-4 items-center gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info [animation-delay:240ms]" />
      </span>
      <span>{label}</span>
    </div>
  );
}

function ConversationMessage({
  item,
  labels,
  renderItem,
}: {
  item: ConversationItem;
  labels: ConversationLabels;
  renderItem?: (item: ConversationItem) => ReactNode | undefined;
}) {
  const custom = renderItem?.(item);
  if (custom) {
    return <>{custom}</>;
  }

  const active = isActive(item);

  return (
    <div
      data-testid={`conversation-message-${item.kind}`}
      className={`agent-message-enter max-w-none rounded-sm border px-3 py-3 ${
        item.role === 'user' ? 'ml-auto w-fit max-w-[88%]' : 'w-full'
      } ${messageClass(item)}`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
        <span className="font-medium uppercase tracking-wide">{labelFor(item, labels)}</span>
        {active ? (
          <span className="inline-flex items-center gap-1 text-info">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
            {labels.running}
          </span>
        ) : null}
      </div>
      <div className="whitespace-pre-wrap break-words text-sm leading-6">
        {item.content || labels.placeholder}
        {item.role === 'assistant' && active && item.content ? (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent align-text-bottom" />
        ) : null}
      </div>
    </div>
  );
}

export function ConversationStream({
  items,
  labels,
  version,
  emptyTitle,
  emptySubtitle,
  activity,
  className = '',
  contentClassName = '',
  renderItem,
}: ConversationStreamProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showBottomButton, setShowBottomButton] = useState(false);

  const activeAssistantHasText = items.some(
    (item) => item.role === 'assistant' && isActive(item) && item.content.trim(),
  );
  const showActivity = Boolean(activity?.show && !activeAssistantHasText);
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.kind !== 'debug' &&
          !(showActivity && item.role === 'assistant' && isActive(item) && !item.content.trim()),
      ),
    [items, showActivity],
  );

  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [autoScroll, version, visibleItems.length, showActivity]);

  function handleScroll() {
    const target = scrollRef.current;
    if (!target) return;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    const nearBottom = distanceFromBottom < 72;
    setAutoScroll(nearBottom);
    setShowBottomButton(!nearBottom);
  }

  function scrollToBottom() {
    setAutoScroll(true);
    setShowBottomButton(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  return (
    <div
      data-testid="conversation-stream"
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${className}`}
    >
      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
        {visibleItems.length === 0 && !showActivity ? (
          <div className="flex h-full items-center justify-center px-6 py-8">
            <div className="max-w-md text-center">
              <p className="text-base font-medium text-text-primary">{emptyTitle}</p>
              {emptySubtitle ? (
                <p className="mt-2 text-sm text-text-tertiary">{emptySubtitle}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className={`mx-auto flex w-full max-w-none flex-col gap-3 px-3 py-3 sm:px-4 ${contentClassName}`}>
            {visibleItems.map((item) => (
              <ConversationMessage key={item.id} item={item} labels={labels} renderItem={renderItem} />
            ))}
            {showActivity && activity ? <ConversationActivityIndicator label={activity.label} /> : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {showBottomButton && (
        <button
          type="button"
          data-testid="conversation-new-output"
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border-default bg-bg-surface-2 px-3 py-1.5 text-xs text-text-secondary shadow-md hover:text-text-primary"
          onClick={scrollToBottom}
        >
          {labels.backToBottom}
        </button>
      )}
    </div>
  );
}
