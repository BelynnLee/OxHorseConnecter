import type { KeyboardEvent } from 'react';
import { useT } from '../../../i18n/index.ts';
import type { MessageTimelineItem, ReasoningTimelineItem } from './types.ts';
import { MarkdownBody } from './AgentMessageBlock.tsx';
import { CommandResultCard } from './CommandResultCard.tsx';
import { classNames, formatTime } from './utils.tsx';

type TimelineMessageProps = {
  item: MessageTimelineItem | ReasoningTimelineItem;
  streaming?: boolean;
  selected?: boolean;
  onSelect?: () => void;
};

function hasActiveTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

export function TimelineMessage({
  item,
  streaming = false,
  selected = false,
  onSelect,
}: TimelineMessageProps) {
  const { t } = useT();

  function handleClick() {
    if (hasActiveTextSelection()) return;
    onSelect?.();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect?.();
  }

  if (item.type === 'reasoning') {
    const isCheckpoint = item.event.content.startsWith('Checkpoint:');
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={classNames(
          'agent-conversation-item w-full text-left',
          selected && 'agent-conversation-selected'
        )}
        data-testid={isCheckpoint ? 'timeline-item-checkpoint' : 'timeline-item-reasoning'}
      >
        <div className="agent-progress-note">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase text-info">
              {t.workbench.v2.progressSummary}
            </span>
            <span className="text-[11px] text-text-tertiary">{formatTime(item.timestamp)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
            {item.event.content}
          </p>
        </div>
      </div>
    );
  }

  const isUser = item.role === 'user';
  if (!isUser && item.messageKind === 'command_result') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={classNames(
          'agent-conversation-item w-full text-left',
          selected && 'agent-conversation-selected'
        )}
        data-testid={`timeline-item-${item.type}`}
      >
        <CommandResultCard item={item} />
      </div>
    );
  }

  const label = isUser ? t.workbench.v2.userTask : t.workbench.v2.assistant;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={classNames(
        'agent-conversation-item w-full text-left',
        selected && 'agent-conversation-selected',
        isUser ? 'flex justify-end' : 'block'
      )}
      data-testid={`timeline-item-${item.type}`}
    >
      <div
        className={classNames(
          'agent-message-surface',
          isUser ? 'agent-message-user' : 'agent-message-assistant'
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase text-text-tertiary">{label}</span>
          <span className="text-[11px] text-text-tertiary">{formatTime(item.timestamp)}</span>
        </div>
        <div className="agent-message-prose">
          <MarkdownBody content={item.content} lineCountLabel={t.workbench.v2.lineCount} />
          {streaming && <span className="agent-stream-cursor" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}
