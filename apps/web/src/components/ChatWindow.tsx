import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Task, TaskEvent } from '../types.ts';
import { sendTaskMessage } from '../api.ts';
import { useTaskConversation } from '../hooks/useTaskConversation.ts';
import { ConversationStream } from './conversation/ConversationStream.tsx';
import { useT } from '../i18n';

interface ChatWindowProps {
  task: Task;
  events: TaskEvent[];
  streamingText: string;
  streamingTurnId?: string;
  isStreaming: boolean;
}

function activityLabel(
  labelKey: 'queued' | 'working' | 'approval',
  t: ReturnType<typeof useT>['t'],
): string {
  if (labelKey === 'approval') return t.workbench.conversation.activityWaitingApproval;
  if (labelKey === 'queued') return t.taskDetail.agentQueued;
  return t.workbench.conversation.activityWorking;
}

export function ChatWindow({
  task,
  events,
  streamingText,
  streamingTurnId,
  isStreaming,
}: ChatWindowProps) {
  const { t } = useT();
  const { items, activity } = useTaskConversation({
    task,
    events,
    streamingText,
    streamingTurnId,
    isStreaming,
    copy: {
      stepFallback: t.taskDetail.stepFallback,
      toolFallback: t.workbench.conversation.labels.tool,
      approvalRequired: t.taskDetail.approvalRequired,
      approvalResolved: t.taskDetail.approvalResolved,
      diffFilesChanged: t.taskDetail.diffFilesChanged,
      taskCancelled: t.taskDetail.taskCancelled,
    },
  });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const canSendMessage = task.status === 'completed' && !isStreaming && !sending;
  const showInput = task.status === 'completed';
  const streamVersion = `${events.length}:${streamingTurnId ?? ''}:${streamingText.length}:${task.status}`;

  useEffect(() => {
    if (!sending) return;
    inputRef.current?.blur();
  }, [sending]);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || !canSendMessage) return;

    setSending(true);
    setSendError('');
    setInput('');

    try {
      await sendTaskMessage(task.id, trimmed);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t.workbench.errorSend);
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConversationStream
        items={items}
        labels={t.workbench.conversation}
        version={streamVersion}
        emptyTitle={t.workbench.conversation.emptyTitle}
        emptySubtitle={t.workbench.conversation.emptySubtitle}
        activity={{
          show: activity.show,
          label: activityLabel(activity.labelKey, t),
        }}
      />

      {showInput && (
        <div className="flex-shrink-0 border-t border-border-soft p-2.5">
          {sendError && <p className="mb-2 text-xs text-danger">{sendError}</p>}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!canSendMessage}
              placeholder={canSendMessage ? t.taskDetail.continuePlaceholder : t.taskDetail.continueDisabledPlaceholder}
              rows={2}
              className="flex-1 resize-none rounded-md border border-border-default bg-bg-surface-2 px-3 py-1.5 text-sm text-text-primary placeholder-text-disabled focus:border-accent/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSendMessage || !input.trim()}
              className="h-8 flex-shrink-0 rounded-md bg-accent px-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </div>
          <p className="mt-1 text-xs text-text-disabled">{t.taskDetail.continueHint}</p>
        </div>
      )}
    </div>
  );
}
