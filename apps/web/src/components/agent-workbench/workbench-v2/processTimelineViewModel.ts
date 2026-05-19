import type {
  ApprovalTimelineItem,
  CheckpointTimelineItem,
  CommandTimelineItem,
  FileDiffTimelineItem,
  MessageTimelineItem,
  PatchAppliedTimelineItem,
  ReasoningTimelineItem,
  SessionCompletedTimelineItem,
  TimelineItem,
  ToolCallTimelineItem,
} from './types.ts';
import type { Translations } from '../../../i18n/locales/en.ts';
import {
  commandDisplayFromTimeline,
  compactPath,
  formatDuration,
  type CommandDisplay,
} from './utils.tsx';
import { calculateTimelineRunStats } from './timelineStats.ts';

export type OperationStatus = 'running' | 'success' | 'failed';
export type OperationPhase = 'context' | 'verification' | 'changes' | 'analysis' | 'general';
type ProcessTimelineCopy = Translations['workbench']['v2'];

export type OperationItemView = {
  id: string;
  kind: 'command' | 'tool' | 'file' | 'approval' | 'error' | 'checkpoint' | 'activity';
  phase: OperationPhase;
  displayName: string;
  subtitle?: string;
  status: OperationStatus;
  durationMs?: number;
  exitCode?: number;
  rawCommand?: string;
  cwd?: string;
  stdout?: string;
  stderr?: string;
  outputLineCount?: number;
  details?: Array<{ label: string; value: string }>;
  source: TimelineItem;
};

export type OperationGroupView = {
  id: string;
  title: string;
  phase: OperationPhase;
  status: OperationStatus;
  items: OperationItemView[];
  failedCount: number;
  durationMs?: number;
  summary: string;
};

export type TimelineNode =
  | { type: 'user_message'; id: string; item: MessageTimelineItem }
  | { type: 'assistant_message'; id: string; item: MessageTimelineItem }
  | { type: 'operation_group'; id: string; group: OperationGroupView }
  | {
      type: 'final_answer';
      id: string;
      message?: MessageTimelineItem;
      sessionCompleted?: SessionCompletedTimelineItem;
      commandCount: number;
      failedCount: number;
      changedFileCount: number;
    };

type StreamEntry =
  | { type: 'message'; item: MessageTimelineItem }
  | { type: 'operation'; item: OperationItemView };

function timestampOf(item: TimelineItem): number {
  return new Date(item.timestamp).getTime();
}

function durationBetween(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return undefined;
  return Math.max(0, endMs - startMs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shortValue(value: unknown, copy: ProcessTimelineCopy): string {
  if (value === undefined) return copy.waiting;
  if (value === null) return copy.nullValue;
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, 140);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return copy.itemCount(value.length);
  if (isRecord(value)) return JSON.stringify(value).slice(0, 180);
  return String(value);
}

function statusFromCommand(command: CommandDisplay): OperationStatus {
  if (command.status === 'failed') return 'failed';
  if (command.status === 'running') return 'running';
  return 'success';
}

function phaseForCommand(displayName: string, status: OperationStatus): OperationPhase {
  const lower = displayName.toLowerCase();
  if (/(test|build|ci|verify|typecheck|lint|coverage|e2e|security)/u.test(lower))
    return 'verification';
  if (
    /(get-content|select-string|rg\b|grep\b|findstr|ls\b|dir\b|cat\b|read|inspect|scan)/u.test(
      lower
    )
  ) {
    return status === 'failed' ? 'analysis' : 'context';
  }
  if (/(apply|patch|write|edit|move|copy|remove|delete)/u.test(lower)) return 'changes';
  return status === 'failed' ? 'analysis' : 'general';
}

function phaseTitle(phase: OperationPhase, copy: ProcessTimelineCopy): string {
  return copy.operationPhases[phase];
}

function phaseForTool(item: ToolCallTimelineItem, copy: ProcessTimelineCopy): OperationPhase {
  const name = (item.started?.name ?? item.completed?.name ?? '').toLowerCase();
  const payload = shortValue(item.started?.input ?? item.completed?.output, copy).toLowerCase();
  if (/(scan|read|search|find|list|inspect|workspace|file)/u.test(`${name} ${payload}`))
    return 'context';
  return item.completed?.status === 'failed' ? 'analysis' : 'general';
}

function phaseForActivity(text: string): OperationPhase {
  const lower = text.toLowerCase();
  if (/(test|build|ci|verify|typecheck|lint|coverage|e2e|security|validation)/u.test(lower))
    return 'verification';
  if (/(read|inspect|scan|search|context|file|workspace|project)/u.test(lower)) return 'context';
  if (/(patch|diff|change|edit|write|update|modified|generated)/u.test(lower)) return 'changes';
  if (/(fail|error|issue|debug|diagnos|analy)/u.test(lower)) return 'analysis';
  return 'general';
}

function activityLabel(text: string, copy: ProcessTimelineCopy): string {
  return text
    .replace(/^Visible summary:\s*/iu, copy.planPrefix)
    .replace(/\s+/gu, ' ')
    .trim();
}

function commandItem(item: CommandTimelineItem, copy: ProcessTimelineCopy): OperationItemView {
  const display = commandDisplayFromTimeline(item, copy);
  return {
    id: item.id,
    kind: 'command',
    phase: phaseForCommand(display.displayCommand, statusFromCommand(display)),
    displayName: display.displayCommand,
    status: statusFromCommand(display),
    durationMs: display.durationMs,
    exitCode: display.exitCode,
    rawCommand: display.rawCommand,
    cwd: display.cwd,
    stdout: display.stdout,
    stderr: display.stderr,
    outputLineCount: display.outputLineCount,
    details: [
      { label: copy.operationLabels.command, value: display.rawCommand },
      { label: copy.operationLabels.workingDirectory, value: display.cwd || copy.pending },
      { label: copy.operationLabels.outputLines, value: String(display.outputLineCount) },
    ],
    source: item,
  };
}

function toolItem(item: ToolCallTimelineItem, copy: ProcessTimelineCopy): OperationItemView {
  const phase = phaseForTool(item, copy);
  const status =
    item.completed?.status === 'failed' ? 'failed' : item.completed ? 'success' : 'running';
  const input = item.started?.input;
  const output = item.completed?.output;
  return {
    id: item.id,
    kind: 'tool',
    phase,
    displayName: item.started?.name ?? item.completed?.name ?? copy.tool,
    subtitle: shortValue(input ?? output, copy),
    status,
    durationMs: durationBetween(item.started?.timestamp, item.completed?.timestamp),
    details: [
      { label: copy.operationLabels.input, value: shortValue(input, copy) },
      { label: copy.operationLabels.output, value: shortValue(output, copy) },
    ],
    source: item,
  };
}

function fileItem(
  item: FileDiffTimelineItem | PatchAppliedTimelineItem,
  copy: ProcessTimelineCopy
): OperationItemView {
  if (item.type === 'patch_applied') {
    return {
      id: item.id,
      kind: 'file',
      phase: 'changes',
      displayName: copy.filesUpdated(item.event.filePaths.length),
      subtitle: item.event.filePaths.slice(0, 3).map(compactPath).join(', '),
      status: 'success',
      details: item.event.filePaths.map((filePath) => ({
        label: copy.operationLabels.file,
        value: filePath,
      })),
      source: item,
    };
  }

  return {
    id: item.id,
    kind: 'file',
    phase: 'changes',
    displayName: `${item.event.changeType} ${compactPath(item.event.filePath)}`,
    subtitle: item.event.filePath,
    status: 'success',
    details: [
      { label: copy.operationLabels.file, value: item.event.filePath },
      { label: copy.operationLabels.change, value: item.event.changeType },
      {
        label: copy.operationLabels.patchLines,
        value: String((item.event.patch ?? '').split(/\r?\n/u).filter(Boolean).length),
      },
    ],
    source: item,
  };
}

function approvalItem(item: ApprovalTimelineItem, copy: ProcessTimelineCopy): OperationItemView {
  const status: OperationStatus =
    item.resolved?.decision === 'rejected' ? 'failed' : item.resolved ? 'success' : 'running';
  return {
    id: item.id,
    kind: 'approval',
    phase: 'changes',
    displayName: item.required?.title ?? item.approvalId,
    subtitle: item.resolved?.decision ?? copy.waitingApproval,
    status,
    details: [
      {
        label: copy.operationLabels.description,
        value: item.required?.description ?? item.resolved?.reason ?? copy.approvalPending,
      },
      {
        label: copy.operationLabels.payload,
        value: shortValue(item.required?.payload ?? item.resolved, copy),
      },
    ],
    source: item,
  };
}

function errorItem(item: TimelineItem, copy: ProcessTimelineCopy): OperationItemView | undefined {
  if (item.type !== 'error') return undefined;
  return {
    id: item.id,
    kind: 'error',
    phase: 'analysis',
    displayName: item.event.message,
    status: 'failed',
    details: [{ label: copy.operationLabels.details, value: shortValue(item.event.details, copy) }],
    source: item,
  };
}

function reasoningItem(item: ReasoningTimelineItem, copy: ProcessTimelineCopy): OperationItemView {
  const text = activityLabel(item.event.content, copy);
  return {
    id: item.id,
    kind: 'activity',
    phase: phaseForActivity(text),
    displayName: text || copy.agentActivity,
    status: 'success',
    details: [
      { label: copy.operationLabels.activity, value: item.event.content },
      { label: copy.operationLabels.event, value: item.event.type },
    ],
    source: item,
  };
}

function checkpointItem(
  item: CheckpointTimelineItem,
  copy: ProcessTimelineCopy
): OperationItemView {
  return {
    id: item.id,
    kind: 'checkpoint',
    phase: 'general',
    displayName: copy.checkpointTitle(item.event.title),
    status: 'success',
    details: [
      { label: copy.operationLabels.checkpoint, value: item.event.title },
      { label: copy.operationLabels.checkpointId, value: item.event.checkpointId },
    ],
    source: item,
  };
}

function mergeCommandResultMessages(items: TimelineItem[]): TimelineItem[] {
  const merged: TimelineItem[] = [];

  for (const item of items) {
    const previous = merged[merged.length - 1];
    if (
      previous?.type === 'message' &&
      item.type === 'message' &&
      previous.messageKind === 'command_result' &&
      item.messageKind === 'command_result' &&
      previous.content === item.content
    ) {
      previous.repeatCount = (previous.repeatCount ?? 1) + (item.repeatCount ?? 1);
      previous.repeatedTimestamps = [
        ...(previous.repeatedTimestamps ?? [previous.timestamp]),
        ...(item.repeatedTimestamps ?? [item.timestamp]),
      ];
      previous.events = [...previous.events, ...item.events];
      continue;
    }

    merged.push(
      item.type === 'message' && item.messageKind === 'command_result'
        ? { ...item, events: [...item.events] }
        : item
    );
  }

  return merged;
}

function operationItemFromTimeline(
  item: TimelineItem,
  copy: ProcessTimelineCopy
): OperationItemView | undefined {
  if (item.type === 'command') return commandItem(item, copy);
  if (item.type === 'tool_call') return toolItem(item, copy);
  if (item.type === 'file_diff' || item.type === 'patch_applied') return fileItem(item, copy);
  if (item.type === 'approval') return approvalItem(item, copy);
  return errorItem(item, copy);
}

function groupStatus(items: OperationItemView[]): OperationStatus {
  if (items.some((item) => item.status === 'failed')) return 'failed';
  if (items.some((item) => item.status === 'running')) return 'running';
  return 'success';
}

function summarizeGroup(items: OperationItemView[], copy: ProcessTimelineCopy): string {
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const durationMs = items.reduce((total, item) => total + (item.durationMs ?? 0), 0);
  return copy.activitySummary(
    items.length,
    failedCount,
    durationMs ? formatDuration(durationMs, copy.runningStatus) : undefined
  );
}

function groupFromItems(
  phase: OperationPhase,
  items: OperationItemView[],
  index: number,
  copy: ProcessTimelineCopy
): OperationGroupView {
  const failedCount = items.filter((item) => item.status === 'failed').length;
  const durationMs = items.reduce((total, item) => total + (item.durationMs ?? 0), 0) || undefined;
  return {
    id: `operation-group-${phase}-${index}-${items[0]?.id ?? 'empty'}`,
    title: phaseTitle(phase, copy),
    phase,
    status: groupStatus(items),
    items,
    failedCount,
    durationMs,
    summary: summarizeGroup(items, copy),
  };
}

function flushGroup(
  nodes: TimelineNode[],
  items: OperationItemView[],
  groupIndex: { value: number },
  copy: ProcessTimelineCopy
) {
  if (!items.length) return;
  nodes.push({
    type: 'operation_group',
    id: `operation-node-${groupIndex.value}-${items[0].id}`,
    group: groupFromItems(items[0].phase, [...items], groupIndex.value, copy),
  });
  groupIndex.value += 1;
  items.length = 0;
}

function shouldTreatAsFinal(message: MessageTimelineItem, lastOperationTime: number): boolean {
  if (message.messageKind === 'command_result') return false;
  if (lastOperationTime <= 0) return false;
  const messageTime = timestampOf(message);
  if (messageTime >= lastOperationTime) return true;
  return /(final|conclusion|summary|result|done|complete|结论|总结|完成|建议|上线|验收)/iu.test(
    message.content
  );
}

function finalContentFromSession(
  sessionCompleted: SessionCompletedTimelineItem | undefined,
  commandCount: number,
  failedCount: number,
  changedFileCount: number,
  copy: ProcessTimelineCopy
): string {
  if (!sessionCompleted) {
    return copy.finalStillWorking;
  }
  const status = sessionCompleted.event.status;
  if (status === 'success' && failedCount === 0) {
    return copy.finalCompleted(commandCount, changedFileCount);
  }
  if (status === 'cancelled') {
    return copy.finalCancelled;
  }
  return copy.finalNeedsAttention(failedCount, commandCount);
}

export function buildProcessTimeline(
  items: TimelineItem[],
  copy: ProcessTimelineCopy
): TimelineNode[] {
  const displayItems = mergeCommandResultMessages(items);
  const sessionCompleted = [...displayItems]
    .reverse()
    .find((item): item is SessionCompletedTimelineItem => item.type === 'session_completed');
  const operationTimes = displayItems
    .filter((item) => item.type !== 'message')
    .map(timestampOf)
    .filter((value) => !Number.isNaN(value));
  const lastOperationTime = operationTimes.length ? Math.max(...operationTimes) : 0;
  const assistantMessages = displayItems.filter(
    (item): item is MessageTimelineItem => item.type === 'message' && item.role === 'assistant'
  );
  const lastAssistant = [...assistantMessages]
    .reverse()
    .find((message) => shouldTreatAsFinal(message, lastOperationTime));
  const stats = calculateTimelineRunStats(displayItems, lastAssistant, sessionCompleted);
  const hasLaterAssistant = (index: number) =>
    displayItems
      .slice(index + 1)
      .some(
        (item) => item.type === 'message' && item.role === 'assistant' && item !== lastAssistant
      );

  const stream: StreamEntry[] = [];
  const leading: StreamEntry[] = [];
  let firstAssistantInserted = false;

  function pushEntry(entry: StreamEntry, index: number) {
    if (!firstAssistantInserted && entry.type !== 'message' && hasLaterAssistant(index)) {
      leading.push(entry);
      return;
    }
    stream.push(entry);
  }

  displayItems.forEach((item, index) => {
    if (item === lastAssistant || item.type === 'session_completed') return;

    if (item.type === 'message') {
      stream.push({ type: 'message', item });
      if (item.role === 'assistant' && !firstAssistantInserted) {
        firstAssistantInserted = true;
        stream.push(...leading);
        leading.length = 0;
      }
      return;
    }

    if (item.type === 'reasoning') {
      pushEntry({ type: 'operation', item: reasoningItem(item, copy) }, index);
      return;
    }

    if (item.type === 'checkpoint') {
      pushEntry({ type: 'operation', item: checkpointItem(item, copy) }, index);
      return;
    }

    const operation = operationItemFromTimeline(item, copy);
    if (operation) pushEntry({ type: 'operation', item: operation }, index);
  });

  stream.push(...leading);

  const nodes: TimelineNode[] = [];
  const currentGroup: OperationItemView[] = [];
  const groupIndex = { value: 0 };

  for (const entry of stream) {
    if (entry.type !== 'operation') {
      flushGroup(nodes, currentGroup, groupIndex, copy);
      if (entry.item.role === 'user') {
        nodes.push({ type: 'user_message', id: entry.item.id, item: entry.item });
      } else {
        nodes.push({ type: 'assistant_message', id: entry.item.id, item: entry.item });
      }
      continue;
    }

    const currentPhase = currentGroup[0]?.phase;
    if (currentPhase && currentPhase !== entry.item.phase) {
      flushGroup(nodes, currentGroup, groupIndex, copy);
    }
    currentGroup.push(entry.item);
  }
  flushGroup(nodes, currentGroup, groupIndex, copy);

  if (lastAssistant || sessionCompleted) {
    nodes.push({
      type: 'final_answer',
      id: lastAssistant?.id ?? sessionCompleted?.id ?? 'final-answer',
      message: lastAssistant,
      sessionCompleted,
      commandCount: stats.commandCount,
      failedCount: stats.failedCount,
      changedFileCount: stats.changedFileCount,
    });
  } else if (nodes.some((node) => node.type === 'operation_group')) {
    nodes.push({
      type: 'final_answer',
      id: 'final-answer-running',
      commandCount: stats.commandCount,
      failedCount: stats.failedCount,
      changedFileCount: stats.changedFileCount,
    });
  }

  const finalNode = nodes.find(
    (node): node is Extract<TimelineNode, { type: 'final_answer' }> => node.type === 'final_answer'
  );
  if (finalNode && !finalNode.message) {
    finalNode.message = {
      id: `${finalNode.id}-synthetic-message`,
      type: 'message',
      sessionId: sessionCompleted?.sessionId ?? displayItems[0]?.sessionId ?? '',
      timestamp:
        sessionCompleted?.timestamp ??
        displayItems[displayItems.length - 1]?.timestamp ??
        new Date().toISOString(),
      role: 'assistant',
      content: finalContentFromSession(
        sessionCompleted,
        stats.commandCount,
        stats.failedCount,
        stats.changedFileCount,
        copy
      ),
      events: [],
    };
  }

  return nodes;
}
