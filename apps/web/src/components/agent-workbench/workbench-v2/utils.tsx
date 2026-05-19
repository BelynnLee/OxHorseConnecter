import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n/index.ts';
import en, { type Translations } from '../../../i18n/locales/en.ts';
import type { CommandRiskLevel, CommandTimelineItem, WorkbenchCommand, WorkbenchStatus } from './types.ts';

export { formatClockTime as formatTime, formatDuration } from '../../../lib/format.ts';

export function classNames(...items: Array<string | false | null | undefined>): string {
  return items.filter(Boolean).join(' ');
}

export function JsonBlock({ value }: { value: unknown }) {
  let content = '';
  try {
    content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    content = String(value);
  }

  return (
    <pre className="max-h-72 overflow-auto rounded-xs border border-border-soft bg-bg-app p-3 font-mono text-xs leading-5 text-text-secondary">
      {content}
    </pre>
  );
}

function fallbackCopyText(text: string): boolean {
  if (typeof document === 'undefined') return false;

  const textArea = document.createElement('textarea');
  try {
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textArea.remove();
  }
}

export function useCopyText(resetAfterMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    if (!text) return false;

    let ok = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) ok = fallbackCopyText(text);
    if (!ok) return false;

    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), resetAfterMs);
    return true;
  }, [resetAfterMs]);

  return { copied, copy };
}

export function CopyTextButton({
  text,
  label,
  copiedLabel,
  dataTestId,
  disabled = false,
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  dataTestId?: string;
  disabled?: boolean;
}) {
  const { t } = useT();
  const { copied, copy } = useCopyText();
  const resolvedLabel = label ?? t.workbench.v2.copy;
  const resolvedCopiedLabel = copiedLabel ?? t.workbench.v2.copied;

  return (
    <button
      type="button"
      className="btn-ghost h-7 px-2 text-xs"
      data-testid={dataTestId}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        void copy(text);
      }}
    >
      {copied ? resolvedCopiedLabel : resolvedLabel}
    </button>
  );
}

const statusClasses: Record<WorkbenchStatus, string> = {
  idle: 'border-success/40 bg-success-soft text-success',
  running: 'border-success/40 bg-success-soft text-success',
  waiting_approval: 'border-warning/40 bg-warning-soft text-warning',
  completed: 'border-success/40 bg-success-soft text-success',
  failed: 'border-danger/40 bg-danger-soft text-danger',
  cancelled: 'border-warning/40 bg-warning-soft text-warning',
};

export function StatusBadge({ status, className }: { status: WorkbenchStatus; className?: string }) {
  const { t } = useT();

  return (
    <span
      className={classNames(
        'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-pill border px-2 text-xs font-semibold leading-none',
        statusClasses[status],
        className,
      )}
    >
      {t.workbench.statusLabels[status]}
    </span>
  );
}

const riskClasses: Record<CommandRiskLevel, string> = {
  safe: 'border-success/40 bg-success-soft text-success',
  medium: 'border-warning/40 bg-warning-soft text-warning',
  dangerous: 'border-danger/40 bg-danger-soft text-danger',
};

export function RiskBadge({ risk }: { risk: CommandRiskLevel }) {
  const { t } = useT();

  return (
    <span className={classNames('inline-flex h-6 items-center rounded-pill border px-2 text-xs font-semibold', riskClasses[risk])}>
      {t.workbench.review.risk(risk)}
    </span>
  );
}

export function riskForApproval(actionType: string): CommandRiskLevel {
  if (actionType === 'delete_file' || actionType === 'network') return 'dangerous';
  if (actionType === 'run_command' || actionType === 'apply_patch' || actionType === 'edit_file') return 'medium';
  return 'safe';
}

export function compactPath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join('/')}`;
}

export type CommandDisplay = {
  id: string;
  rawCommand: string;
  displayCommand: string;
  cwd: string;
  stdout: string;
  stderr: string;
  status: 'running' | 'success' | 'failed';
  exitCode?: number;
  durationMs?: number;
  outputLineCount: number;
  riskLevel?: CommandRiskLevel;
  startedAt?: string;
  finishedAt?: string;
  shortReason?: string;
  suggestedNextAction?: string;
};

export type BlockingIssue = {
  id: string;
  commandName: string;
  rawCommand: string;
  exitCode?: number;
  shortReason: string;
  suggestedNextAction: string;
  durationMs?: number;
  outputLineCount: number;
};

type CommandDisplayCopy = Pick<
  Translations['workbench']['v2'],
  'commandExitedWithCode' | 'commandDidNotFinish' | 'suggestFixTest' | 'suggestFixBuild' | 'suggestFixCommand'
>;

const defaultCommandDisplayCopy: CommandDisplayCopy = en.workbench.v2;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function unwrapPowerShellCommand(rawCommand: string): string {
  const trimmed = rawCommand.trim();
  const shellPattern = /^(?:"?[A-Za-z]:[\\/][^"]*(?:powershell|pwsh)(?:\.exe)?"?|powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+/i;
  const shellMatch = trimmed.match(shellPattern);
  if (!shellMatch) return trimmed;

  const rest = trimmed.slice(shellMatch[0].length).trim();
  const commandMatch = rest.match(/(?:^|\s)-(?:Command|c)\s+([\s\S]+)$/i);
  if (commandMatch) {
    const unwrapped = stripOuterQuotes(commandMatch[1])
      .replace(/^&\s*\{\s*([\s\S]*?)\s*\}$/u, '$1')
      .trim();
    return unwrapped || trimmed;
  }

  const fileMatch = rest.match(/(?:^|\s)-File\s+([\s\S]+)$/i);
  if (fileMatch) return stripOuterQuotes(fileMatch[1]);

  return rest
    .replace(/\s-(?:NoLogo|NoProfile|NonInteractive|MTA|STA)\b/gi, '')
    .replace(/\s-ExecutionPolicy\s+\S+/gi, '')
    .trim() || trimmed;
}

function unwrapShellCommand(rawCommand: string): string {
  const trimmed = rawCommand.trim();
  const cmdMatch = trimmed.match(/^(?:"?[A-Za-z]:[\\/][^"]*cmd(?:\.exe)?"?|cmd(?:\.exe)?)\s+\/[sc]\s+([\s\S]+)$/i);
  if (cmdMatch) return stripOuterQuotes(cmdMatch[1]);
  return unwrapPowerShellCommand(trimmed);
}

function removeCwdPrefix(command: string, cwd: string | undefined): string {
  if (!cwd) return command;
  const normalizedCwd = cwd.replace(/[\\/]+$/u, '');
  if (!normalizedCwd) return command;

  const forward = normalizedCwd.replaceAll('\\', '/');
  const backward = normalizedCwd.replaceAll('/', '\\');
  return command
    .replace(new RegExp(`${escapeRegExp(forward)}[\\/]`, 'gi'), '')
    .replace(new RegExp(`${escapeRegExp(backward)}[\\/]`, 'gi'), '')
    .replaceAll(`${forward}/`, '')
    .replaceAll(`${backward}\\`, '');
}

export function humanizeCommand(rawCommand: string, cwd?: string, maxLength = 116): string {
  const unwrapped = unwrapShellCommand(rawCommand);
  const withoutCwd = removeCwdPrefix(unwrapped, cwd);
  const cleaned = withoutCwd
    .replace(/(^|\s)\.\\+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLength) return cleaned || rawCommand;
  return `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
}

export function countOutputLines(stdout: string, stderr: string): number {
  const output = `${stdout}${stderr}`;
  if (!output.trim()) return 0;
  return output.replace(/\n$/u, '').split(/\r?\n/u).length;
}

export function commandOutput(item: CommandTimelineItem, stream: 'stdout' | 'stderr'): string {
  return item.outputs.filter((output) => output.stream === stream).map((output) => output.content).join('');
}

function reasonFromOutput(
  stdout: string,
  stderr: string,
  exitCode?: number,
  copy: CommandDisplayCopy = defaultCommandDisplayCopy
): string {
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningful = lines.find((line) => /(error|failed|failure|not found|cannot|exception|denied|timeout|exit code|ERR!)/i.test(line)) ?? lines[0];
  if (meaningful) {
    return meaningful.length > 150 ? `${meaningful.slice(0, 147).trimEnd()}...` : meaningful;
  }
  return typeof exitCode === 'number' ? copy.commandExitedWithCode(exitCode) : copy.commandDidNotFinish;
}

function suggestedAction(
  commandName: string,
  copy: CommandDisplayCopy = defaultCommandDisplayCopy
): string {
  const lower = commandName.toLowerCase();
  if (lower.includes('test')) {
    return copy.suggestFixTest(commandName);
  }
  if (lower.includes('build')) {
    return copy.suggestFixBuild(commandName);
  }
  return copy.suggestFixCommand(commandName);
}

export function commandDisplayFromTimeline(
  item: CommandTimelineItem,
  copy: CommandDisplayCopy = defaultCommandDisplayCopy
): CommandDisplay {
  const rawCommand = item.started?.command ?? item.commandId;
  const cwd = item.started?.cwd ?? '';
  const stdout = commandOutput(item, 'stdout');
  const stderr = commandOutput(item, 'stderr');
  const exitCode = item.completed?.exitCode;
  const status = !item.completed ? 'running' : exitCode === 0 ? 'success' : 'failed';
  const displayCommand = humanizeCommand(rawCommand, cwd);
  const outputLineCount = countOutputLines(stdout, stderr);
  const shortReason = status === 'failed' ? reasonFromOutput(stdout, stderr, exitCode, copy) : undefined;

  return {
    id: item.id,
    rawCommand,
    displayCommand,
    cwd,
    stdout,
    stderr,
    status,
    exitCode,
    durationMs: item.completed?.durationMs,
    outputLineCount,
    riskLevel: item.started?.riskLevel,
    startedAt: item.started?.timestamp,
    finishedAt: item.completed?.timestamp,
    shortReason,
    suggestedNextAction: shortReason ? suggestedAction(displayCommand, copy) : undefined,
  };
}

export function commandDisplayFromWorkbench(
  command: WorkbenchCommand,
  copy: CommandDisplayCopy = defaultCommandDisplayCopy
): CommandDisplay {
  const status = command.exitCode === undefined ? 'running' : command.exitCode === 0 ? 'success' : 'failed';
  const displayCommand = humanizeCommand(command.command, command.cwd);
  const outputLineCount = countOutputLines(command.stdout, command.stderr);
  const shortReason = status === 'failed'
    ? command.riskReason ?? reasonFromOutput(command.stdout, command.stderr, command.exitCode, copy)
    : undefined;

  return {
    id: command.id,
    rawCommand: command.command,
    displayCommand,
    cwd: command.cwd,
    stdout: command.stdout,
    stderr: command.stderr,
    status,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    outputLineCount,
    riskLevel: command.riskLevel,
    startedAt: command.startedAt,
    finishedAt: command.finishedAt,
    shortReason,
    suggestedNextAction: shortReason ? suggestedAction(displayCommand, copy) : undefined,
  };
}

export function blockingIssueFromCommand(
  command: CommandDisplay,
  copy: CommandDisplayCopy = defaultCommandDisplayCopy
): BlockingIssue | undefined {
  if (command.status !== 'failed') return undefined;
  return {
    id: command.id,
    commandName: command.displayCommand,
    rawCommand: command.rawCommand,
    exitCode: command.exitCode,
    shortReason: command.shortReason ?? reasonFromOutput(command.stdout, command.stderr, command.exitCode, copy),
    suggestedNextAction: command.suggestedNextAction ?? suggestedAction(command.displayCommand, copy),
    durationMs: command.durationMs,
    outputLineCount: command.outputLineCount,
  };
}

export function blockingIssuesFromTimelineCommands(
  commands: CommandTimelineItem[],
  copy: CommandDisplayCopy = defaultCommandDisplayCopy
): BlockingIssue[] {
  return commands
    .map((command) => blockingIssueFromCommand(commandDisplayFromTimeline(command, copy), copy))
    .filter((issue): issue is BlockingIssue => Boolean(issue));
}

export function blockingIssuesFromWorkbenchCommands(
  commands: WorkbenchCommand[],
  copy: CommandDisplayCopy = defaultCommandDisplayCopy
): BlockingIssue[] {
  return commands
    .map((command) => blockingIssueFromCommand(commandDisplayFromWorkbench(command, copy), copy))
    .filter((issue): issue is BlockingIssue => Boolean(issue));
}
