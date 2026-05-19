import type { KeyboardEvent } from 'react';
import { useT } from '../../../i18n/index.ts';
import { MarkdownBody } from './AgentMessageBlock.tsx';
import type { TimelineNode } from './processTimelineViewModel.ts';
import type { TimelineItem } from './types.ts';
import { classNames, formatTime } from './utils.tsx';

type FinalAnswerBlockProps = {
  node: Extract<TimelineNode, { type: 'final_answer' }>;
  selected?: boolean;
  onSelectItem: (item: TimelineItem) => void;
};

function hasActiveTextSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

export function FinalAnswerBlock({ node, selected = false, onSelectItem }: FinalAnswerBlockProps) {
  const { t } = useT();
  const status = node.sessionCompleted?.event.status;
  const failed = status === 'failed' || node.failedCount > 0;
  const cancelled = status === 'cancelled';

  function handleSelect() {
    if (node.sessionCompleted) onSelectItem(node.sessionCompleted);
    else if (node.message) onSelectItem(node.message);
  }

  function handleClick() {
    if (hasActiveTextSelection()) return;
    handleSelect();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleSelect();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={classNames(
        'agent-final-answer',
        selected && 'agent-conversation-selected',
        failed && 'agent-final-answer-failed',
        cancelled && 'agent-final-answer-cancelled',
      )}
      data-testid={node.sessionCompleted ? 'timeline-item-session_completed' : 'timeline-item-final_answer'}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase text-text-tertiary">{t.workbench.v2.finalAnswer}</span>
        <span className="text-[11px] text-text-tertiary">{formatTime(node.message?.timestamp ?? node.sessionCompleted?.timestamp ?? new Date().toISOString())}</span>
      </div>
      <div className="agent-message-prose">
        <MarkdownBody content={node.message?.content ?? ''} lineCountLabel={t.workbench.v2.lineCount} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-tertiary">
        <span>{t.workbench.v2.commandsShort(node.commandCount)}</span>
        <span>{t.workbench.v2.failedCount(node.failedCount)}</span>
        <span>{t.workbench.v2.filesChangedCount(node.changedFileCount)}</span>
      </div>
    </div>
  );
}
