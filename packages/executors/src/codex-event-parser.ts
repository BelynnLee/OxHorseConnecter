import {
  isRecord,
  readNumber,
  readPath,
  readRecord,
  readString,
  type JsonRecord,
} from '@rac/shared';

export type { JsonRecord } from '@rac/shared';
export { isRecord } from '@rac/shared';

export interface CodexToolEvent {
  id: string;
  name: string;
  command?: string;
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
}

export interface CodexToolOutputEvent {
  id?: string;
  stream: 'stdout' | 'stderr';
  delta: string;
}

function normalizeKind(value: string | undefined): string {
  return (value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function codexEventName(event: JsonRecord): string {
  return (
    readString(event, [['method'], ['type'], ['event'], ['name'], ['payload', 'type']]) ?? 'unknown'
  );
}

export function extractCodexSessionId(event: JsonRecord): string | undefined {
  const name = codexEventName(event).toLowerCase();
  if (!name.includes('session') && !name.includes('conversation') && !name.includes('thread')) {
    return undefined;
  }

  const params = eventParams(event);
  const value =
    readString(params, [
      ['session_id'],
      ['sessionId'],
      ['conversation_id'],
      ['conversationId'],
      ['thread_id'],
      ['threadId'],
      ['id'],
    ]) ??
    readString(event, [
      ['session_id'],
      ['sessionId'],
      ['conversation_id'],
      ['conversationId'],
      ['thread_id'],
      ['threadId'],
    ]);

  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : undefined;
}

function eventParams(event: JsonRecord): unknown {
  return isRecord(event.params) ? event.params : isRecord(event.payload) ? event.payload : event;
}

function readItem(event: JsonRecord): JsonRecord | undefined {
  const params = eventParams(event);
  const item = readPath(params, ['item']);
  return isRecord(item) ? item : undefined;
}

export function collectText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(collectText).filter(Boolean).join('');
  }

  if (!isRecord(value)) {
    return '';
  }

  const directText = readString(value, [
    ['text'],
    ['delta'],
    ['message'],
    ['content'],
    ['summary'],
    ['output_text'],
  ]);
  if (directText) {
    return directText;
  }

  if (Array.isArray(value.content)) {
    return value.content.map(collectText).filter(Boolean).join('');
  }

  if (Array.isArray(value.output)) {
    return value.output.map(collectText).filter(Boolean).join('');
  }

  return '';
}

export function extractAssistantDelta(event: JsonRecord): string | undefined {
  const name = codexEventName(event).toLowerCase();
  if (
    !(
      name.includes('agentmessage/delta') ||
      name.includes('assistant') ||
      name.includes('output_text.delta') ||
      name.includes('message.delta')
    ) ||
    name.includes('reasoning') ||
    name.includes('tool') ||
    name.includes('command')
  ) {
    return undefined;
  }

  return readString(eventParams(event), [
    ['delta'],
    ['text'],
    ['content'],
    ['message', 'delta'],
    ['message', 'content'],
  ]);
}

export function extractAssistantCompletedText(event: JsonRecord): string | undefined {
  const name = codexEventName(event).toLowerCase();
  const item = readItem(event);
  const itemType = normalizeKind(readString(item, [['type']]));

  if (
    item &&
    (itemType === 'agentmessage' ||
      itemType === 'message' ||
      itemType === 'assistant' ||
      itemType === 'outputtext')
  ) {
    const text = collectText(item);
    return text || undefined;
  }

  if (
    name.includes('assistant') ||
    name.includes('message.completed') ||
    name.includes('output_text.done')
  ) {
    const text = collectText(eventParams(event));
    return text || undefined;
  }

  return undefined;
}

function toolNameFromItem(item: JsonRecord | undefined): string | undefined {
  if (!item) {
    return undefined;
  }

  const itemType = normalizeKind(readString(item, [['type']]));
  if (itemType === 'commandexecution') {
    return 'shell';
  }
  if (itemType === 'filechange') {
    return 'apply_patch';
  }
  if (itemType === 'websearch') {
    return 'web_search';
  }

  return readString(item, [['tool'], ['name'], ['function', 'name']]);
}

function commandFromItem(item: JsonRecord | undefined): string | undefined {
  if (!item) {
    return undefined;
  }

  return readString(item, [['command'], ['query'], ['meta'], ['arguments'], ['args'], ['input']]);
}

function toolStatusFromItem(
  item: JsonRecord | undefined,
  fallback: CodexToolEvent['status']
): CodexToolEvent['status'] {
  const status = normalizeKind(readString(item, [['status']]));
  if (status === 'failed' || status === 'error') {
    return 'failed';
  }
  if (status === 'completed' || status === 'complete' || status === 'success') {
    return 'completed';
  }
  if (status === 'inprogress' || status === 'running') {
    return 'running';
  }
  return fallback;
}

export function extractToolEvent(event: JsonRecord): CodexToolEvent | undefined {
  const name = codexEventName(event).toLowerCase();
  const params = eventParams(event);
  const item = readItem(event);
  const itemType = normalizeKind(readString(item, [['type']]));

  const isToolItem =
    itemType === 'commandexecution' ||
    itemType === 'filechange' ||
    itemType === 'dynamictoolcall' ||
    itemType === 'mcptoolcall' ||
    itemType === 'websearch' ||
    itemType === 'functioncall';
  const looksLikeTool =
    isToolItem ||
    name.includes('tool') ||
    name.includes('command') ||
    name.includes('exec') ||
    name.includes('function_call');

  if (!looksLikeTool) {
    return undefined;
  }

  const status: CodexToolEvent['status'] =
    name.includes('completed') ||
    name.includes('/completed') ||
    name.includes('end') ||
    name.includes('done')
      ? 'completed'
      : name.includes('failed') || name.includes('error')
        ? 'failed'
        : 'running';

  const id =
    readString(item, [['id'], ['callId'], ['call_id']]) ??
    readString(params, [['itemId'], ['id'], ['callId'], ['call_id']]) ??
    readString(event, [['id']]) ??
    'codex-tool';
  const toolName =
    toolNameFromItem(item) ??
    readString(params, [['tool'], ['name'], ['function', 'name'], ['command', 'name']]) ??
    (name.includes('command') || name.includes('exec') ? 'shell' : 'tool');
  const command =
    commandFromItem(item) ??
    readString(params, [['command'], ['cmd'], ['query'], ['arguments'], ['args'], ['input']]);
  const exitCode =
    readNumber(item, [['exitCode'], ['exit_code'], ['code']]) ??
    readNumber(params, [['exitCode'], ['exit_code'], ['code']]);
  const itemStatus = toolStatusFromItem(item, status);

  return {
    id,
    name: toolName,
    command,
    status: exitCode !== undefined && exitCode !== 0 ? 'failed' : itemStatus,
    exitCode,
  };
}

export function extractToolOutput(event: JsonRecord): CodexToolOutputEvent | undefined {
  const name = codexEventName(event).toLowerCase();
  const item = readItem(event);
  const itemType = normalizeKind(readString(item, [['type']]));
  if (
    !(
      itemType === 'commandexecution' ||
      name.includes('output') ||
      name.includes('stdout') ||
      name.includes('stderr') ||
      name.includes('exec') ||
      name.includes('command')
    ) ||
    name.includes('assistant') ||
    name.includes('output_text')
  ) {
    return undefined;
  }

  const params = eventParams(event);
  const output =
    readString(item, [
      ['aggregated_output'],
      ['output'],
      ['stdout'],
      ['stderr'],
      ['text'],
      ['content'],
    ]) ??
    readString(params, [
      ['delta'],
      ['aggregated_output'],
      ['output'],
      ['stdout'],
      ['stderr'],
      ['text'],
      ['content'],
    ]) ??
    collectText(readPath(params, ['output']));
  if (!output) {
    return undefined;
  }

  const stream =
    name.includes('stderr') ||
    readString(item, [['stream']]) === 'stderr' ||
    readString(params, [['stream']]) === 'stderr'
      ? 'stderr'
      : 'stdout';
  const id =
    readString(item, [['id'], ['callId'], ['call_id']]) ??
    readString(params, [['itemId'], ['id'], ['callId'], ['call_id']]);

  return { id, stream, delta: output };
}

export function extractPlanOrStep(
  event: JsonRecord
): { title: string; message: string } | undefined {
  const name = codexEventName(event).toLowerCase();
  const params = eventParams(event);
  const item = readItem(event);
  const itemType = normalizeKind(readString(item, [['type']]));

  if (itemType === 'plan' || itemType === 'reasoning') {
    const text = collectText(item);
    return text
      ? { title: itemType === 'reasoning' ? 'Reasoning' : 'Plan', message: text }
      : undefined;
  }

  if (name.includes('plan')) {
    const explanation = readString(params, [['explanation']]);
    const plan = readPath(params, ['plan']);
    if (Array.isArray(plan)) {
      const steps = plan
        .map((entry) => {
          if (!isRecord(entry)) {
            return '';
          }
          const step = readString(entry, [['step'], ['title'], ['message']]);
          const status = readString(entry, [['status']]);
          return step ? `${step}${status ? ` (${status})` : ''}` : '';
        })
        .filter(Boolean);
      if (steps.length > 0 || explanation) {
        return {
          title: 'Plan updated',
          message: [explanation, ...steps].filter(Boolean).join('\n'),
        };
      }
    }
    const delta = readString(params, [['delta'], ['text'], ['message']]);
    return delta ? { title: 'Plan', message: delta } : undefined;
  }

  if (name.includes('reasoning')) {
    if (name.includes('started')) {
      return { title: 'Reasoning', message: 'Reasoning started.' };
    }
    if (name.includes('completed') || name.includes('done')) {
      return { title: 'Reasoning', message: 'Reasoning completed.' };
    }
    return undefined;
  }

  if (name.includes('started') || name.includes('completed')) {
    const title =
      readString(item, [['type']]) ??
      readString(params, [['title'], ['step'], ['message']]) ??
      codexEventName(event);
    return {
      title,
      message: name.includes('completed') ? `${title} completed.` : `${title} started.`,
    };
  }

  return undefined;
}

export function extractCodexUsagePayload(event: JsonRecord): JsonRecord | undefined {
  const params = eventParams(event);
  const usage =
    readRecord(params, [['usage'], ['token_usage'], ['tokenUsage']]) ??
    readRecord(event, [['usage'], ['token_usage'], ['tokenUsage']]);
  const modelUsage =
    readRecord(params, [['model_usage'], ['modelUsage']]) ??
    readRecord(event, [['model_usage'], ['modelUsage']]);
  const totalCostUsd =
    readNumber(params, [['total_cost_usd'], ['totalCostUsd'], ['cost_usd'], ['costUsd']]) ??
    readNumber(event, [['total_cost_usd'], ['totalCostUsd'], ['cost_usd'], ['costUsd']]);

  if (!usage && !modelUsage && totalCostUsd === undefined) {
    return undefined;
  }

  return {
    ...(usage ? { usage } : {}),
    ...(modelUsage ? { model_usage: modelUsage } : {}),
    ...(totalCostUsd !== undefined ? { total_cost_usd: totalCostUsd } : {}),
  };
}

export function flushBufferedLines(buffer: string, emit: (line: string) => void): string {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const remainder = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      emit(trimmed);
    }
  }

  return remainder;
}
