import { useMemo } from 'react';
import type { ConversationItem } from '../components/conversation/ConversationStream.tsx';
import type { Task, TaskEvent } from '../types.ts';

interface UseTaskConversationOptions {
  task: Task;
  events: TaskEvent[];
  streamingText: string;
  streamingTurnId?: string;
  isStreaming: boolean;
  copy: {
    stepFallback: string;
    toolFallback: string;
    approvalRequired: string;
    approvalResolved: (status: string) => string;
    diffFilesChanged: (count: number) => string;
    taskCancelled: string;
  };
}

interface TaskConversationState {
  items: ConversationItem[];
  activity: {
    show: boolean;
    labelKey: 'queued' | 'working' | 'approval';
  };
}

function eventPayload(event: TaskEvent): Record<string, unknown> {
  return event.payload as Record<string, unknown>;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function appendWithSeparator(current: string, next: string): string {
  if (!current) return next;
  if (!next) return current;
  if (current === next) return current;
  if (next.startsWith(current)) return next;
  if (current.startsWith(next)) return current;
  if (current.trim() === next.trim()) return current;
  if (current.includes(next.trim())) return current;
  const separator = current.endsWith('\n') ? '' : '\n';
  return `${current}${separator}${next}`;
}

function upsertAssistant(
  items: ConversationItem[],
  turnId: string,
  content: string,
  createdAt: string,
  streaming: boolean,
): ConversationItem[] {
  const id = `assistant:${turnId}`;
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    return [
      ...items,
      {
        id,
        role: 'assistant',
        kind: 'message',
        content,
        status: streaming ? 'streaming' : 'completed',
        createdAt,
        turnId,
      },
    ];
  }

  const next = [...items];
  const current = next[index];
  next[index] = {
    ...current,
    content: appendWithSeparator(current.content, content),
    status: streaming ? 'streaming' : current.status,
  };
  return next;
}

function upsertFullAssistantText(
  items: ConversationItem[],
  turnId: string,
  content: string,
  createdAt: string,
  streaming: boolean,
): ConversationItem[] {
  const id = `assistant:${turnId}`;
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    return upsertAssistant(items, turnId, content, createdAt, streaming);
  }

  const next = [...items];
  const current = next[index];
  next[index] = {
    ...current,
    content: appendWithSeparator(current.content, content),
    status: streaming ? 'streaming' : current.status,
  };
  if (content.startsWith(current.content) || current.content.trim() === content.trim()) {
    next[index] = {
      ...next[index],
      content,
    };
  }
  return next;
}

function addItem(items: ConversationItem[], item: ConversationItem): ConversationItem[] {
  if (items.some((current) => current.id === item.id)) return items;
  return [...items, item];
}

function hasUserContent(items: ConversationItem[], content: string): boolean {
  return items.some((item) => item.role === 'user' && item.content.trim() === content.trim());
}

function isAssistantLog(payload: Record<string, unknown>): boolean {
  return (
    payload.stream === 'stdout' &&
    payload.source !== 'tool' &&
    typeof payload.toolRunId !== 'string' &&
    payload.role !== 'user'
  );
}

function isTerminalStatus(status: Task['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function useTaskConversation({
  task,
  events,
  streamingText,
  streamingTurnId,
  isStreaming,
  copy,
}: UseTaskConversationOptions): TaskConversationState {
  return useMemo(() => {
    let items: ConversationItem[] = [
      {
        id: `task:${task.id}:prompt`,
        role: 'user',
        kind: 'message',
        content: task.prompt,
        status: 'completed',
        createdAt: task.createdAt,
        turnId: `user:${task.id}:prompt`,
      },
    ];
    let lastAssistantTurnId: string | undefined;
    let fallbackAssistantTurnId = `task:${task.id}:assistant`;

    for (const event of events) {
      const payload = eventPayload(event);

      if (event.type === 'task.progress') {
        const step = textValue(payload.step) ?? copy.stepFallback;
        const message = textValue(payload.message) ?? step;
        items = addItem(items, {
          id: event.id,
          role: 'system',
          kind: 'step',
          content: `${step}: ${message}`,
          status: 'completed',
          createdAt: event.createdAt,
        });
        continue;
      }

      if (event.type === 'task.tool_call') {
        const tool = textValue(payload.tool) ?? copy.toolFallback;
        const action = textValue(payload.action) ?? textValue(payload.command) ?? '';
        const status = payload.status === 'running'
          ? 'running'
          : payload.status === 'failed'
            ? 'failed'
            : 'completed';
        items = addItem(items, {
          id: `tool:${textValue(payload.toolRunId) ?? event.id}`,
          role: 'tool',
          kind: 'tool',
          content: action ? `${tool}: ${action}` : tool,
          status,
          createdAt: event.createdAt,
          toolCallId: textValue(payload.toolRunId) ?? event.id,
        });
        continue;
      }

      if (event.type === 'task.log') {
        const message = textValue(payload.message);
        if (!message) continue;

        if (payload.role === 'user') {
          if (!hasUserContent(items, message)) {
            items = addItem(items, {
              id: event.id,
              role: 'user',
              kind: 'message',
              content: message,
              status: 'completed',
              createdAt: event.createdAt,
              turnId: textValue(payload.turnId),
            });
          }
          lastAssistantTurnId = undefined;
          fallbackAssistantTurnId = `task:${task.id}:assistant:${event.id}`;
          continue;
        }

        if (message.startsWith('[User] ')) {
          const userMessage = message.slice('[User] '.length).trim();
          if (userMessage && !hasUserContent(items, userMessage)) {
            items = addItem(items, {
              id: event.id,
              role: 'user',
              kind: 'message',
              content: userMessage,
              status: 'completed',
              createdAt: event.createdAt,
            });
          }
          lastAssistantTurnId = undefined;
          fallbackAssistantTurnId = `task:${task.id}:assistant:${event.id}`;
          continue;
        }

        if (isAssistantLog(payload)) {
          const turnId =
            textValue(payload.turnId) ??
            lastAssistantTurnId ??
            fallbackAssistantTurnId;
          fallbackAssistantTurnId = turnId;
          lastAssistantTurnId = turnId;
          items = upsertAssistant(items, turnId, message, event.createdAt, false);
          continue;
        }

        if (payload.source === 'tool' || typeof payload.toolRunId === 'string') {
          items = addItem(items, {
            id: `tool-output:${event.id}`,
            role: 'tool',
            kind: 'tool',
            content: message,
            status: 'completed',
            createdAt: event.createdAt,
            toolCallId: textValue(payload.toolRunId),
          });
          continue;
        }

        items = addItem(items, {
          id: event.id,
          role: payload.stream === 'stderr' ? 'tool' : 'system',
          kind: payload.stream === 'stderr' && event.level === 'error' ? 'error' : 'summary',
          content: message,
          status: event.level === 'error' ? 'failed' : 'completed',
          createdAt: event.createdAt,
        });
        continue;
      }

      if (event.type === 'task.approval_requested') {
        items = addItem(items, {
          id: event.id,
          role: 'system',
          kind: 'approval',
          content: textValue(payload.reason) ?? copy.approvalRequired,
          status: 'running',
          createdAt: event.createdAt,
        });
        continue;
      }

      if (event.type === 'task.approval_resolved') {
        items = addItem(items, {
          id: event.id,
          role: 'system',
          kind: 'approval',
          content: copy.approvalResolved(String(payload.status ?? 'resolved')),
          status: 'completed',
          createdAt: event.createdAt,
        });
        continue;
      }

      if (event.type === 'task.diff_ready') {
        const filesChanged = typeof payload.filesChanged === 'number' ? payload.filesChanged : 0;
        items = addItem(items, {
          id: event.id,
          role: 'system',
          kind: 'file',
          content: copy.diffFilesChanged(filesChanged),
          status: 'completed',
          createdAt: event.createdAt,
        });
        continue;
      }

      if (event.type === 'task.completed') {
        const summary = textValue(payload.summary);
        if (summary) {
          items = addItem(items, {
            id: event.id,
            role: 'assistant',
            kind: 'summary',
            content: summary,
            status: 'completed',
            createdAt: event.createdAt,
          });
        }
        continue;
      }

      if (event.type === 'task.failed') {
        const errorMessage = textValue(payload.errorMessage);
        if (errorMessage) {
          items = addItem(items, {
            id: event.id,
            role: 'system',
            kind: 'error',
            content: errorMessage,
            status: 'failed',
            createdAt: event.createdAt,
          });
        }
        continue;
      }

      if (event.type === 'task.cancelled') {
        items = addItem(items, {
          id: event.id,
          role: 'system',
          kind: 'summary',
          content: textValue(payload.reason) ?? copy.taskCancelled,
          status: 'completed',
          createdAt: event.createdAt,
        });
      }
    }

    if (streamingText) {
      const turnId = streamingTurnId ?? lastAssistantTurnId ?? fallbackAssistantTurnId;
      lastAssistantTurnId = turnId;
      items = upsertFullAssistantText(items, turnId, streamingText, new Date().toISOString(), isStreaming);
    }

    const generating = task.status === 'queued' || task.status === 'running' || isStreaming;
    if (generating && lastAssistantTurnId) {
      items = items.map((item) =>
        item.id === `assistant:${lastAssistantTurnId}`
          ? { ...item, status: 'streaming' }
          : item,
      );
    }

    const activityKey = task.status === 'waiting_approval'
      ? 'approval'
      : task.status === 'queued'
        ? 'queued'
        : 'working';

    return {
      items,
      activity: {
        show: !isTerminalStatus(task.status),
        labelKey: activityKey,
      },
    };
  }, [copy, events, isStreaming, streamingText, streamingTurnId, task]);
}
