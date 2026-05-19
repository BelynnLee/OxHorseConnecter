import type {
  AgentEvent,
  ApprovalTimelineItem,
  CommandTimelineItem,
  MessageTimelineItem,
  TimelineEvent,
  TimelineItem,
  ToolCallTimelineItem,
} from './types.ts';

function upsertToolItem(
  items: TimelineItem[],
  index: Map<string, ToolCallTimelineItem>,
  event: Extract<AgentEvent, { type: 'tool_call_started' | 'tool_call_completed' }>,
): ToolCallTimelineItem {
  const existing = index.get(event.toolCallId);
  if (existing) return existing;

  const item: ToolCallTimelineItem = {
    id: `tool-${event.toolCallId}`,
    type: 'tool_call',
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    toolCallId: event.toolCallId,
  };
  index.set(event.toolCallId, item);
  items.push(item);
  return item;
}

function upsertCommandItem(
  items: TimelineItem[],
  index: Map<string, CommandTimelineItem>,
  event: Extract<AgentEvent, { type: 'command_started' | 'command_output' | 'command_completed' }>,
): CommandTimelineItem {
  const existing = index.get(event.commandId);
  if (existing) return existing;

  const item: CommandTimelineItem = {
    id: `command-${event.commandId}`,
    type: 'command',
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    commandId: event.commandId,
    outputs: [],
  };
  index.set(event.commandId, item);
  items.push(item);
  return item;
}

function upsertApprovalItem(
  items: TimelineItem[],
  index: Map<string, ApprovalTimelineItem>,
  event: Extract<AgentEvent, { type: 'approval_required' | 'approval_resolved' }>,
): ApprovalTimelineItem {
  const existing = index.get(event.approvalId);
  if (existing) return existing;

  const item: ApprovalTimelineItem = {
    id: `approval-${event.approvalId}`,
    type: 'approval',
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    approvalId: event.approvalId,
  };
  index.set(event.approvalId, item);
  items.push(item);
  return item;
}

export function buildTimeline(events: TimelineEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const tools = new Map<string, ToolCallTimelineItem>();
  const commands = new Map<string, CommandTimelineItem>();
  const approvals = new Map<string, ApprovalTimelineItem>();
  const assistantSegments = new Map<string, number>();
  let currentAssistantMessage: MessageTimelineItem | undefined;

  for (const event of events) {
    if (event.type !== 'message_delta') {
      currentAssistantMessage = undefined;
    }

    switch (event.type) {
      case 'user_message':
        items.push({
          id: event.id,
          type: 'message',
          sessionId: event.sessionId,
          timestamp: event.timestamp,
          role: 'user',
          content: event.content,
          events: [event],
        });
        break;

      case 'message_delta': {
        if (
          !currentAssistantMessage ||
          event.messageKind === 'command_result' ||
          currentAssistantMessage.messageKind === 'command_result'
        ) {
          const segment = assistantSegments.get(event.id) ?? 0;
          assistantSegments.set(event.id, segment + 1);
          currentAssistantMessage = {
            id: `assistant-${event.id}-${segment}-${event.timestamp}`,
            type: 'message',
            sessionId: event.sessionId,
            timestamp: event.timestamp,
            role: 'assistant',
            content: '',
            events: [],
            messageKind: event.messageKind,
          };
          items.push(currentAssistantMessage);
        }
        currentAssistantMessage.content += event.content;
        currentAssistantMessage.events.push(event);
        break;
      }

      case 'reasoning_summary':
        items.push({
          id: event.id,
          type: 'reasoning',
          sessionId: event.sessionId,
          timestamp: event.timestamp,
          event,
        });
        break;

      case 'tool_call_started':
        upsertToolItem(items, tools, event).started = event;
        break;

      case 'tool_call_completed':
        upsertToolItem(items, tools, event).completed = event;
        break;

      case 'command_started':
        upsertCommandItem(items, commands, event).started = event;
        break;

      case 'command_output':
        upsertCommandItem(items, commands, event).outputs.push(event);
        break;

      case 'command_completed':
        upsertCommandItem(items, commands, event).completed = event;
        break;

      case 'approval_required':
        upsertApprovalItem(items, approvals, event).required = event;
        break;

      case 'approval_resolved':
        upsertApprovalItem(items, approvals, event).resolved = event;
        break;

      case 'file_diff_created':
        items.push({
          id: event.id,
          type: 'file_diff',
          sessionId: event.sessionId,
          timestamp: event.timestamp,
          event,
        });
        break;

      case 'patch_applied':
        items.push({
          id: event.id,
          type: 'patch_applied',
          sessionId: event.sessionId,
          timestamp: event.timestamp,
          event,
        });
        break;

      case 'checkpoint_created':
        items.push({
          id: event.id,
          type: 'checkpoint',
          sessionId: event.sessionId,
          timestamp: event.timestamp,
          event,
        });
        break;

      case 'error':
        items.push({
          id: event.id,
          type: 'error',
          sessionId: event.sessionId,
          timestamp: event.timestamp,
          event,
        });
        break;

      case 'session_completed':
        items.push({
          id: event.id,
          type: 'session_completed',
          sessionId: event.sessionId,
          timestamp: event.timestamp,
          event,
        });
        break;

      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  }

  return items;
}
