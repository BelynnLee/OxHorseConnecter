import { sanitizeLog } from '@rac/security';
import type {
  AgentCommand,
  AgentSession,
  AgentSessionSummary,
  Approval,
  DiffSummary,
  SessionMessage,
  SessionReport,
} from '@rac/shared';
import { markdownEscape, permissionModeLabel, safeExportFilename } from './session-helpers.js';

export interface SessionGitInfo {
  branch?: string;
  cwd?: string;
  isGitRepository: boolean;
}

export interface SessionMarkdownExportOptions {
  includeDiff?: boolean;
  includeRawLogs?: boolean;
}

export interface BuildSessionMarkdownExportInput {
  session: AgentSession;
  messages: SessionMessage[];
  gitInfo: SessionGitInfo;
  gitHead?: string;
  diff?: DiffSummary;
  logsText: string;
  commands: AgentCommand[];
  summaries: AgentSessionSummary[];
  approvals: Approval[];
  usageSummary?: string;
  usageEstimated?: boolean;
  options?: SessionMarkdownExportOptions;
  generatedAt?: string;
}

export interface BuildSessionJsonReportInput {
  session: SessionReport['session'];
  runs: SessionReport['runs'];
  events: SessionReport['events'];
  operations: SessionReport['operations'];
  commands: unknown[];
  approvals: unknown[];
  diff?: Record<string, unknown>;
  git: Record<string, unknown>;
  usage?: Record<string, unknown>;
  metrics?: SessionReport['metrics'] | null;
  providerForFilename: string;
  idForFilename: string;
  generatedAt?: string;
}

export function collectSessionTaskIds(
  session: Pick<AgentSession, 'activeTaskId'>,
  messages: Array<Pick<SessionMessage, 'taskId'>>
): string[] {
  const taskIds = new Set<string>();
  if (session.activeTaskId) {
    taskIds.add(session.activeTaskId);
  }
  for (const message of messages) {
    if (message.taskId) {
      taskIds.add(message.taskId);
    }
  }
  return Array.from(taskIds);
}

export function buildSessionExportFilename(
  provider: string,
  sessionId: string,
  extension: 'json' | 'md',
  generatedAt = new Date().toISOString()
): string {
  const timestamp = generatedAt.replace(/[:.]/g, '-');
  return safeExportFilename(`${provider}-${sessionId}-${timestamp}.${extension}`);
}

export function buildSessionMarkdownExport(input: BuildSessionMarkdownExportInput): {
  filename: string;
  markdown: string;
} {
  const {
    session,
    messages,
    gitInfo,
    gitHead,
    diff,
    logsText,
    commands,
    summaries,
    approvals,
    usageSummary,
    usageEstimated,
    options = {},
    generatedAt,
  } = input;
  const prompt = messages.find((message) => message.role === 'user')?.content ?? '';
  const startedAt = session.createdAt;
  const completedAt = session.status === 'idle' ? session.updatedAt : undefined;
  const filename = buildSessionExportFilename(session.executorType, session.id, 'md', generatedAt);

  const lines: string[] = [
    '# Agent Session Export',
    '',
    '## Metadata',
    `- Session ID: ${session.id}`,
    `- Provider: ${session.executorType}`,
    `- External Session ID: ${session.externalSessionId ?? 'none'}`,
    `- Model: ${session.modelId ?? 'provider default'}`,
    `- Mode: ${session.mode}`,
    `- Permission Mode: ${permissionModeLabel(session.permissionMode)}`,
    `- Project Path: ${session.workingDirectory ?? ''}`,
    `- Git Branch: ${gitInfo.branch ?? 'unknown'}`,
    `- Git Head: ${gitHead ?? 'unknown'}`,
    `- Started At: ${startedAt}`,
    `- Completed At: ${completedAt ?? 'not completed'}`,
    `- Status: ${session.status}`,
    usageSummary
      ? `- ${usageEstimated ? 'Estimated usage' : 'Actual usage'}: ${usageSummary}`
      : '- Usage: unavailable',
    '',
    '## User Prompt',
    '',
    prompt || '_No prompt captured._',
    '',
    '## Conversation',
    '',
  ];

  for (const message of messages) {
    const label = `${message.role}${message.type !== 'text' ? `/${message.type}` : ''}`;
    lines.push(`### ${label} - ${message.createdAt}`, '');
    lines.push(message.content ? sanitizeLog(message.content) : '_empty_', '');
  }

  lines.push('## Commands', '');
  lines.push(
    '_Best-effort command parsing; rows depend on provider stream and tool payloads._',
    ''
  );
  lines.push('| Time | Command | CWD | Exit Code | Risk | Approval |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const command of commands) {
    lines.push(
      `| ${markdownEscape(command.startedAt)} | ${markdownEscape(sanitizeLog(command.command))} | ${markdownEscape(command.cwd)} | ${command.exitCode ?? ''} | ${command.riskLevel} | ${markdownEscape(command.approvalId)} |`
    );
  }
  if (commands.length === 0) lines.push('| | No commands captured | | | | |');

  lines.push('', '## Approvals', '');
  lines.push('| Time | Type | Risk | Decision | Reason |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const approval of approvals) {
    lines.push(
      `| ${markdownEscape(approval.createdAt)} | ${markdownEscape(approval.actionType)} | ${approval.riskLevel} | ${approval.status} | ${markdownEscape(sanitizeLog(approval.reason))} |`
    );
  }
  if (approvals.length === 0) lines.push('| | No approvals captured | | | |');

  lines.push('', '## Files Changed', '');
  lines.push('| File | Status | Session-owned | Safe to discard |');
  lines.push('| --- | --- | --- | --- |');
  for (const file of diff?.files ?? []) {
    lines.push(`| ${markdownEscape(file.path)} | ${file.status} | yes | yes |`);
  }
  if (!diff?.files?.length) lines.push('| | No session-scoped changes | | |');

  lines.push('', '## Diff Summary', '');
  lines.push(
    diff
      ? `${diff.filesChanged} files changed, +${diff.insertions}/-${diff.deletions}.`
      : 'No session-scoped diff captured.'
  );
  if (options.includeDiff && diff?.patchText) {
    lines.push('', '### Full Diff', '', '```diff', sanitizeLog(diff.patchText), '```');
  }

  lines.push('', '## Compact Summary', '');
  if (summaries.length === 0) {
    lines.push('_No compact summary saved._');
  } else {
    for (const summary of summaries) {
      lines.push(`### ${summary.createdAt}`, '');
      lines.push(
        summary.injectedIntoProvider
          ? '_Provider context summary._'
          : '_Workbench auxiliary summary; not injected into provider context._',
        ''
      );
      lines.push(sanitizeLog(summary.summary), '');
    }
  }

  lines.push('', '## Raw Logs Appendix', '');
  if (options.includeRawLogs) {
    lines.push('```text', sanitizeLog(logsText || 'No raw logs captured.'), '```');
  } else {
    lines.push(
      '_Raw logs omitted by default. Re-run export with includeRawLogs=true to include sanitized logs._'
    );
  }

  return { filename, markdown: lines.join('\n') };
}

export function buildSessionJsonReport(input: BuildSessionJsonReportInput): {
  filename: string;
  report: SessionReport;
} {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return {
    filename: buildSessionExportFilename(
      input.providerForFilename,
      input.idForFilename,
      'json',
      generatedAt
    ),
    report: {
      schemaVersion: 1,
      session: input.session,
      runs: input.runs,
      events: input.events,
      operations: input.operations,
      commands: input.commands,
      approvals: input.approvals,
      diff: input.diff,
      git: input.git,
      usage: input.usage,
      metrics: input.metrics ?? fallbackSessionMetrics(input.session),
      generatedAt,
    },
  };
}

function fallbackSessionMetrics(session: SessionReport['session']): SessionReport['metrics'] {
  return {
    sessionId: session.id,
    status: session.status,
    provider: session.provider,
    model: session.model,
    commandCount: 0,
    failedCommandCount: 0,
    approvalCount: 0,
    approvedApprovalCount: 0,
    rejectedApprovalCount: 0,
    changedFileCount: 0,
    insertions: 0,
    deletions: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    success: session.status === 'completed',
  };
}
