import type { ChildProcess } from 'node:child_process';
import { executeBashCommand } from './bash-tool.js';
import {
  readTextFile,
  replaceInTextFile,
  writeTextFile,
} from './file-tool.js';

const MAX_RESULT_CHARS = 32_000;

function asNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`"${fieldName}" must be a non-empty string.`);
  }

  return value;
}

function asOptionalNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  return fallback;
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`"${fieldName}" must be a string.`);
  }

  return value;
}

function truncateResult(value: string): string {
  if (value.length <= MAX_RESULT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_RESULT_CHARS)}\n... [truncated ${value.length - MAX_RESULT_CHARS} chars]`;
}

function formatShellResult(result: Awaited<ReturnType<typeof executeBashCommand>>): string {
  const parts = [`Exit code: ${result.exitCode ?? 'unknown'}`];

  if (result.signal) {
    parts.push(`Signal: ${result.signal}`);
  }

  if (result.timedOut) {
    parts.push('The command timed out before it completed.');
  }

  if (result.stdout.trim()) {
    parts.push(`STDOUT:\n${result.stdout.trimEnd()}`);
  }

  if (result.stderr.trim()) {
    parts.push(`STDERR:\n${result.stderr.trimEnd()}`);
  }

  return truncateResult(parts.join('\n\n'));
}

export interface ToolDescription {
  actionType: string;
  action: string;
  inputSummary?: string;
  commandPreview?: string;
  targetPaths?: string[];
}

export interface ExecuteToolOptions {
  onShellProcess?: (child: ChildProcess | undefined) => void;
}

export function describeToolUse(
  name: string,
  input: Record<string, unknown>,
): ToolDescription {
  switch (name) {
    case 'bash': {
      const command = asNonEmptyString(input.command, 'command');
      return {
        actionType: 'shell_command',
        action: command,
        inputSummary: 'Execute a shell command in the task working directory.',
        commandPreview: command,
      };
    }
    case 'read_file': {
      const targetPath = asNonEmptyString(input.path, 'path');
      return {
        actionType: 'file_read',
        action: `read ${targetPath}`,
        inputSummary: 'Read a file from disk.',
        targetPaths: [targetPath],
      };
    }
    case 'write_file': {
      const targetPath = asNonEmptyString(input.path, 'path');
      return {
        actionType: 'file_write',
        action: `write ${targetPath}`,
        inputSummary: 'Write full file contents to disk.',
        targetPaths: [targetPath],
      };
    }
    case 'str_replace_file': {
      const targetPath = asNonEmptyString(input.path, 'path');
      return {
        actionType: 'file_edit',
        action: `replace text in ${targetPath}`,
        inputSummary: 'Replace a specific string in an existing file.',
        targetPaths: [targetPath],
      };
    }
    case 'fetch_url': {
      const url = asNonEmptyString(input.url, 'url');
      const method = typeof input.method === 'string' ? input.method : 'GET';
      return {
        actionType: 'network_fetch',
        action: `${method} ${url}`,
        inputSummary: 'Fetch content from a remote URL.',
        commandPreview: `${method} ${url}`,
      };
    }
    default:
      return {
        actionType: 'unknown_tool',
        action: name,
        inputSummary: 'Unknown tool requested by the model.',
      };
  }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  workDir: string,
  options: ExecuteToolOptions = {},
): Promise<string> {
  switch (name) {
    case 'bash': {
      const command = asNonEmptyString(input.command, 'command');
      const timeoutMs = asOptionalNumber(input.timeout_ms, 30_000);
      const result = await executeBashCommand(command, {
        cwd: workDir,
        timeoutMs,
        onSpawn: options.onShellProcess,
      });
      return formatShellResult(result);
    }
    case 'read_file':
      return truncateResult(readTextFile(workDir, asNonEmptyString(input.path, 'path')));
    case 'write_file':
      return writeTextFile(
        workDir,
        asNonEmptyString(input.path, 'path'),
        asString(input.content, 'content'),
      );
    case 'str_replace_file':
      return replaceInTextFile(
        workDir,
        asNonEmptyString(input.path, 'path'),
        asString(input.old_str, 'old_str'),
        asString(input.new_str, 'new_str'),
      );
    case 'fetch_url': {
      const url = asNonEmptyString(input.url, 'url');
      const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET';
      const headers = input.headers && typeof input.headers === 'object'
        ? (input.headers as Record<string, string>)
        : undefined;
      const body = typeof input.body === 'string' ? input.body : undefined;

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: method !== 'GET' ? body : undefined,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return `Network error fetching ${url}: ${reason}`;
      }

      const text = await response.text();
      const prefix = `HTTP ${response.status} ${response.statusText}\n\n`;
      return truncateResult(prefix + text);
    }
    default:
      throw new Error(`Unknown tool requested by Claude: ${name}`);
  }
}
