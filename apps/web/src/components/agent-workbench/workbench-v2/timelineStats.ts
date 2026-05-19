import type {
  CommandTimelineItem,
  MessageTimelineItem,
  SessionCompletedTimelineItem,
  TimelineItem,
} from './types.ts';

export type TimelineRunStats = {
  commandCount: number;
  failedCount: number;
  changedFileCount: number;
};

function commandResultCount(items: TimelineItem[]): number {
  return items.reduce((count, item) => {
    if (item.type !== 'message' || item.messageKind !== 'command_result') return count;
    return count + (item.repeatCount ?? 1);
  }, 0);
}

function messageLooksFailed(message: MessageTimelineItem | undefined): boolean {
  if (!message?.content.trim()) return false;
  return /\b(error|failed|failure|invalid request|exception|denied|rejected|timeout)\b/iu.test(
    message.content
  );
}

export function calculateTimelineRunStats(
  displayItems: TimelineItem[],
  lastAssistant: MessageTimelineItem | undefined,
  sessionCompleted: SessionCompletedTimelineItem | undefined
): TimelineRunStats {
  const commandItems = displayItems.filter(
    (item): item is CommandTimelineItem => item.type === 'command'
  );
  const commandCount = commandItems.length + commandResultCount(displayItems);
  const failedCommands = commandItems.filter(
    (item) => item.completed && item.completed.exitCode !== 0
  ).length;
  const errorCount = displayItems.filter((item) => item.type === 'error').length;
  const terminalFailed =
    sessionCompleted?.event.status === 'failed' || messageLooksFailed(lastAssistant) ? 1 : 0;
  const failedCount = Math.max(failedCommands + errorCount, terminalFailed);
  const changedFileCount = new Set(
    displayItems.flatMap((item) => {
      if (item.type === 'file_diff') return [item.event.filePath];
      if (item.type === 'patch_applied') return item.event.filePaths;
      return [];
    })
  ).size;

  return { commandCount, failedCount, changedFileCount };
}
