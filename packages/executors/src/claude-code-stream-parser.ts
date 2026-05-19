import { summarizeUnknown } from './executor-utils.js';

export interface ClaudeCodeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      content?: unknown;
      tool_use_id?: string;
      is_error?: boolean;
    }>;
    stop_reason?: string | null;
  };
  result?: string;
  error?: string;
  is_error?: boolean;
  usage?: unknown;
  model_usage?: unknown;
  total_cost_usd?: number;
}

export interface ClaudeCodeUsageProjection {
  usage?: unknown;
  model_usage?: unknown;
  total_cost_usd?: number;
}

export interface ClaudeCodeToolCallProjection {
  tool: string;
  action: string;
  inputSummary: string;
  command?: string;
  status: 'running' | 'completed' | 'failed';
  toolRunId: string;
  level: 'info' | 'error';
}

export interface ClaudeCodeToolLogProjection {
  message: string;
  stream: 'stdout' | 'stderr';
  toolRunId: string;
  level: 'info' | 'warn';
}

export interface ClaudeCodeToolProjections {
  toolCalls: ClaudeCodeToolCallProjection[];
  logs: ClaudeCodeToolLogProjection[];
}

export function claudeCodeEventLabel(event: ClaudeCodeStreamEvent): string {
  return `${event.type}${event.subtype ? `/${event.subtype}` : ''}`;
}

export function extractClaudeCodeSessionId(event: ClaudeCodeStreamEvent): string | undefined {
  if ((event.type === 'system' && event.subtype === 'init') || event.type === 'result') {
    return event.session_id;
  }
  return undefined;
}

export function extractClaudeCodeUsage(
  event: ClaudeCodeStreamEvent
): ClaudeCodeUsageProjection | undefined {
  if (
    event.type !== 'result' ||
    (!event.usage && !event.model_usage && event.total_cost_usd === undefined)
  ) {
    return undefined;
  }

  return {
    usage: event.usage,
    model_usage: event.model_usage,
    total_cost_usd: event.total_cost_usd,
  };
}

export function extractClaudeCodeToolProjections(
  event: ClaudeCodeStreamEvent,
  taskId: string
): ClaudeCodeToolProjections {
  const projections: ClaudeCodeToolProjections = { toolCalls: [], logs: [] };
  if (event.type !== 'assistant' || !event.message?.content) {
    return projections;
  }

  for (const block of event.message.content) {
    if (block.type === 'tool_use') {
      const toolRunId = block.id ?? `${taskId}:${block.name ?? 'tool'}`;
      const inputSummary = summarizeUnknown(block.input);
      projections.toolCalls.push({
        tool: block.name ?? 'tool',
        action: inputSummary,
        inputSummary,
        command: inputSummary,
        status: 'running',
        toolRunId,
        level: 'info',
      });
    }
    if (block.type === 'tool_result') {
      const toolRunId = block.tool_use_id ?? `${taskId}:tool_result`;
      const output = summarizeUnknown(block.content);
      projections.logs.push({
        message: output,
        stream: block.is_error ? 'stderr' : 'stdout',
        toolRunId,
        level: block.is_error ? 'warn' : 'info',
      });
      projections.toolCalls.push({
        tool: 'tool',
        action: block.is_error ? 'failed' : 'completed',
        inputSummary: 'Claude Code tool result.',
        status: block.is_error ? 'failed' : 'completed',
        toolRunId,
        level: block.is_error ? 'error' : 'info',
      });
    }
  }

  return projections;
}

export function extractClaudeCodeAssistantText(
  event: ClaudeCodeStreamEvent
): { text: string; isFinal: boolean } | undefined {
  if (event.type !== 'assistant' || !event.message?.content) {
    return undefined;
  }

  const text = event.message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');

  return text ? { text, isFinal: event.message.stop_reason != null } : undefined;
}
