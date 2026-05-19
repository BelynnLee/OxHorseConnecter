import type { AgentWorkbenchApiSource } from './agentWorkbenchApi.ts';
import { supportedReasoningOptionsFor } from './WorkbenchRunBar.tsx';
import type {
  PermissionMode,
  ReasoningEffort,
  TimelineEvent,
  WorkbenchExecutor,
  WorkbenchDevice,
  WorkbenchModel,
  WorkbenchNativeTerminalProvider,
  WorkbenchRuntimeOptions,
  WorkbenchSession,
  WorkbenchStatus,
} from './types.ts';

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createTimestamp(): string {
  return new Date().toISOString();
}

export function titleFromPrompt(prompt: string, fallback: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 56 ? `${normalized.slice(0, 53)}...` : normalized;
}

export function statusFromEvent(event: TimelineEvent): WorkbenchStatus | undefined {
  if (
    event.type === 'message_delta' ||
    event.type === 'command_started' ||
    event.type === 'tool_call_started'
  ) {
    return 'running';
  }
  if (event.type === 'approval_required') return 'waiting_approval';
  if (event.type === 'session_completed') {
    if (event.status === 'success') return 'completed';
    if (event.status === 'cancelled') return 'cancelled';
    return 'failed';
  }
  return undefined;
}

const eventTypeOrder: Record<TimelineEvent['type'], number> = {
  user_message: 0,
  reasoning_summary: 1,
  message_delta: 2,
  tool_call_started: 3,
  command_started: 4,
  command_output: 5,
  command_completed: 6,
  tool_call_completed: 7,
  approval_required: 8,
  approval_resolved: 9,
  file_diff_created: 10,
  patch_applied: 11,
  checkpoint_created: 12,
  error: 13,
  session_completed: 14,
};

function eventTime(event: TimelineEvent): number {
  const time = new Date(event.timestamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        eventTime(a.event) - eventTime(b.event) ||
        eventTypeOrder[a.event.type] - eventTypeOrder[b.event.type] ||
        a.index - b.index
    )
    .map(({ event }) => event);
}

function eventIdentity(event: TimelineEvent): string {
  if (event.type === 'message_delta') {
    return `${event.type}:${event.id}:${event.timestamp}:${event.content}`;
  }
  return event.id;
}

const OPTIMISTIC_USER_MESSAGE_PREFIX = 'user-message-';

function isUserMessageEvent(
  event: TimelineEvent
): event is Extract<TimelineEvent, { type: 'user_message' }> {
  return event.type === 'user_message';
}

function isOptimisticUserMessage(event: TimelineEvent): boolean {
  return isUserMessageEvent(event) && event.id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX);
}

function normalizedUserContent(event: Extract<TimelineEvent, { type: 'user_message' }>): string {
  return event.content.replace(/\s+/g, ' ').trim();
}

function isSameUserMessage(
  a: Extract<TimelineEvent, { type: 'user_message' }>,
  b: Extract<TimelineEvent, { type: 'user_message' }>
): boolean {
  return a.sessionId === b.sessionId && normalizedUserContent(a) === normalizedUserContent(b);
}

function duplicateOpenUserMessageIndex(
  existing: TimelineEvent[],
  event: Extract<TimelineEvent, { type: 'user_message' }>
): number {
  for (let index = existing.length - 1; index >= 0; index -= 1) {
    const item = existing[index];
    if (item.sessionId !== event.sessionId) continue;
    if (!isUserMessageEvent(item)) return -1;
    return isSameUserMessage(item, event) || isOptimisticUserMessage(item) ? index : -1;
  }

  return -1;
}

function messageDeltaContent(events: TimelineEvent[], messageId: string): string {
  return sortTimelineEvents(events)
    .filter(
      (event): event is Extract<TimelineEvent, { type: 'message_delta' }> =>
        event.type === 'message_delta' && event.id === messageId
    )
    .map((event) => event.content)
    .join('');
}

export function appendTimelineEvent(
  existing: TimelineEvent[],
  event: TimelineEvent
): TimelineEvent[] {
  if (event.type === 'user_message') {
    const duplicateIndex = duplicateOpenUserMessageIndex(existing, event);
    if (duplicateIndex !== -1) return existing;
  }

  if (event.type === 'message_delta') {
    const identity = eventIdentity(event);
    if (existing.some((item) => eventIdentity(item) === identity)) return existing;

    const existingContent = messageDeltaContent(existing, event.id);
    if (existingContent) {
      if (event.content === existingContent && event.content.length > 16) return existing;
      if (
        event.content.length > existingContent.length &&
        event.content.startsWith(existingContent)
      ) {
        const suffix = event.content.slice(existingContent.length);
        if (!suffix) return existing;
        return sortTimelineEvents([...existing, { ...event, content: suffix }]);
      }
    }

    return sortTimelineEvents([...existing, event]);
  }

  const withoutDuplicate = existing.filter((item) => item.id !== event.id);
  const withoutDuplicateResolution =
    event.type === 'approval_resolved'
      ? withoutDuplicate.filter(
          (item) => item.type !== 'approval_resolved' || item.approvalId !== event.approvalId
        )
      : withoutDuplicate;
  return sortTimelineEvents([...withoutDuplicateResolution, event]);
}

export function mergeEvents(current: TimelineEvent[], incoming: TimelineEvent[]): TimelineEvent[] {
  return incoming.reduce((events, event) => appendTimelineEvent(events, event), current);
}

export function providerDefault(
  source: AgentWorkbenchApiSource,
  executors: WorkbenchExecutor[]
): string {
  if (source === 'mock') return 'mock';
  return executors.find((executor) => executor.available)?.type ?? executors[0]?.type ?? 'codex';
}

export function isReadyWorkbenchDevice(device: WorkbenchDevice): boolean {
  return (
    device.status === 'online' &&
    device.trusted &&
    Boolean(device.workRoot) &&
    device.workRootExists !== false &&
    device.bridgeStatus !== 'disconnected'
  );
}

export function workbenchProjectPathDefault({
  routeProjectPath,
  firstSession,
  devices,
  routeDeviceId,
}: {
  routeProjectPath?: string;
  firstSession?: WorkbenchSession;
  devices: WorkbenchDevice[];
  routeDeviceId?: string;
}): string {
  if (routeProjectPath?.trim()) return routeProjectPath;
  if (firstSession?.projectPath.trim()) return firstSession.projectPath;
  const routeDevice = routeDeviceId
    ? devices.find((device) => device.id === routeDeviceId)
    : undefined;
  if (routeDevice?.workRoot?.trim()) return routeDevice.workRoot;
  return devices.find(isReadyWorkbenchDevice)?.workRoot ?? '';
}

export function modelDefault(
  provider: string | undefined,
  models: WorkbenchModel[]
): string | undefined {
  const scoped = provider
    ? models.filter((model) => model.executorTypes.includes(provider))
    : models;
  return scoped.find((model) => model.isDefault)?.id ?? scoped[0]?.id ?? models[0]?.id;
}

export function normalizeReasoningEffort(
  effort: ReasoningEffort | undefined,
  provider: string | undefined,
  modelId: string | undefined,
  executors: WorkbenchExecutor[],
  models: WorkbenchModel[]
): ReasoningEffort | undefined {
  if (!effort) return undefined;
  return supportedReasoningOptionsFor(provider, modelId, executors, models).includes(effort)
    ? effort
    : undefined;
}

export function reasoningEffortDefault(
  provider: string | undefined,
  modelId: string | undefined,
  executors: WorkbenchExecutor[],
  models: WorkbenchModel[]
): ReasoningEffort | undefined {
  const model = modelId ? models.find((item) => item.id === modelId) : undefined;
  if (model?.defaultReasoningEffort) return model.defaultReasoningEffort;
  if (provider !== 'codex') return undefined;
  const supported = supportedReasoningOptionsFor(provider, modelId, executors, models);
  if (!supported.length) return undefined;
  return supported.includes('medium') ? 'medium' : supported[0];
}

export function worktreeWarningText(
  dirty: boolean,
  statusText: string,
  warning?: string,
  fallback?: string
): string | undefined {
  if (warning) return warning;
  if (!dirty) return undefined;
  if (!fallback) return statusText || undefined;
  return statusText ? `${fallback}: ${statusText}` : fallback;
}

export function compactWorkbenchRuntimeOptions(
  input?: WorkbenchRuntimeOptions
): WorkbenchRuntimeOptions | undefined {
  if (!input) return undefined;
  const extraDirs = Array.from(
    new Set((input.extraDirs ?? []).map((item) => item.trim()).filter(Boolean))
  );
  const options: WorkbenchRuntimeOptions = {
    extraDirs,
    webSearch: input.webSearch ? true : undefined,
    serviceTier: input.serviceTier === 'fast' ? 'fast' : undefined,
    claudeAgent: input.claudeAgent?.trim() || undefined,
    claudeFallbackModel: input.claudeFallbackModel?.trim() || undefined,
    claudeMaxBudgetUsd: input.claudeMaxBudgetUsd,
    claudeAppendSystemPrompt: input.claudeAppendSystemPrompt?.trim() || undefined,
  };
  const entries = Object.entries(options).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ''
  );
  return entries.length ? (Object.fromEntries(entries) as WorkbenchRuntimeOptions) : undefined;
}

export function parseSlashInput(input: string): { name: string; args: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const body = trimmed.slice(1);
  const firstSpace = body.search(/\s/);
  if (firstSpace === -1) return { name: body.toLowerCase(), args: '' };
  return {
    name: body.slice(0, firstSpace).toLowerCase(),
    args: body.slice(firstSpace).trim(),
  };
}

export function contentFromPatch(patch: string | undefined): string {
  return (patch ?? '')
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

export function terminalProviderFrom(value: string | undefined): WorkbenchNativeTerminalProvider {
  return value === 'claude-code' || value === 'claude' ? 'claude-code' : 'codex';
}

export function hasSessionChange(
  changes: Partial<WorkbenchSession>,
  key: keyof WorkbenchSession
): boolean {
  return Object.prototype.hasOwnProperty.call(changes, key);
}

export function nextPermissionModeForMode(mode: string, current: PermissionMode): PermissionMode {
  return mode === 'plan' || mode === 'review' ? 'read-only' : current;
}
