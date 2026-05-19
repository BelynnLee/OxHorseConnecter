import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentSession, ExecutorType, SessionMessage, SessionPermissionMode } from '@rac/shared';

type NativeProvider = Extract<ExecutorType, 'codex' | 'claude-code'>;

export interface NativeProviderSession {
  id: string;
  externalSessionId: string;
  provider: NativeProvider;
  title: string;
  createdAt: string;
  updatedAt: string;
  workingDirectory?: string;
  modelId?: string;
  sourcePath: string;
}

interface CodexIndexEntry {
  title?: string;
  updatedAt?: string;
}

interface JsonLine {
  id?: unknown;
  timestamp?: unknown;
  type?: unknown;
  thread_name?: unknown;
  updated_at?: unknown;
  payload?: unknown;
  message?: unknown;
  cwd?: unknown;
  sessionId?: unknown;
  uuid?: unknown;
}

const NATIVE_SESSION_PREFIX = 'native:';
const MAX_HISTORY_FILES = 1500;
const MAX_MESSAGE_TEXT = 24_000;
const TURN_ABORTED_PATTERN = /^<turn_aborted>\s*[\s\S]*?<\/turn_aborted>$/;

export function nativeProviderSessionId(
  provider: NativeProvider,
  externalSessionId: string
): string {
  return `${NATIVE_SESSION_PREFIX}${provider}:${externalSessionId}`;
}

export function parseNativeProviderSessionId(
  sessionId: string
): { provider: NativeProvider; externalSessionId: string } | undefined {
  if (!sessionId.startsWith(NATIVE_SESSION_PREFIX)) return undefined;
  const rest = sessionId.slice(NATIVE_SESSION_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) return undefined;
  const provider = rest.slice(0, separator);
  if (provider !== 'codex' && provider !== 'claude-code') return undefined;
  const externalSessionId = rest.slice(separator + 1).trim();
  if (!externalSessionId) return undefined;
  return { provider, externalSessionId };
}

export function isNativeProviderSessionId(sessionId: string): boolean {
  return Boolean(parseNativeProviderSessionId(sessionId));
}

export class ProviderSessionHistoryService {
  list(options?: { limit?: number; search?: string }): NativeProviderSession[] {
    const limit = clampLimit(options?.limit, 80, MAX_HISTORY_FILES);
    const search = options?.search?.trim().toLowerCase();
    const sessions = [...this.listCodexSessions(), ...this.listClaudeCodeSessions()]
      .filter((session) => {
        if (!search) return true;
        return [
          session.title,
          session.provider,
          session.externalSessionId,
          session.workingDirectory ?? '',
          session.modelId ?? '',
        ].some((value) => value.toLowerCase().includes(search));
      })
      .sort((a, b) => sessionTime(b) - sessionTime(a));

    return sessions.slice(0, limit);
  }

  getDetail(sessionId: string): { session: AgentSession; messages: SessionMessage[] } | undefined {
    const parsed = parseNativeProviderSessionId(sessionId);
    if (!parsed) return undefined;

    const native =
      parsed.provider === 'codex'
        ? this.findCodexSession(parsed.externalSessionId)
        : this.findClaudeCodeSession(parsed.externalSessionId);
    if (!native) return undefined;

    const messages =
      native.provider === 'codex'
        ? this.codexMessages(native)
        : this.claudeCodeMessages(native);

    return {
      session: nativeProviderSessionToAgentSession(native),
      messages,
    };
  }

  private listCodexSessions(): NativeProviderSession[] {
    const sessionsDir = path.join(codexHome(), 'sessions');
    const files = listJsonlFiles(sessionsDir)
      .sort((a, b) => safeStatMtimeMs(b) - safeStatMtimeMs(a))
      .slice(0, MAX_HISTORY_FILES);
    const index = readCodexSessionIndex();

    return files
      .map((filePath) => this.codexSessionFromFile(filePath, index))
      .filter((session): session is NativeProviderSession => Boolean(session));
  }

  private findCodexSession(externalSessionId: string): NativeProviderSession | undefined {
    const index = readCodexSessionIndex();
    for (const filePath of listJsonlFiles(path.join(codexHome(), 'sessions'))) {
      const session = this.codexSessionFromFile(filePath, index);
      if (session?.externalSessionId === externalSessionId) return session;
    }
    return undefined;
  }

  private codexSessionFromFile(
    filePath: string,
    index: Map<string, CodexIndexEntry>
  ): NativeProviderSession | undefined {
    const stat = safeStat(filePath);
    const lines = readJsonLines(filePath);
    if (!lines.length) return undefined;

    const meta = lines.find((line) => line.type === 'session_meta' && isRecord(line.payload));
    const payload = isRecord(meta?.payload) ? meta.payload : undefined;
    const externalSessionId =
      textValue(payload?.id) ?? codexSessionIdFromFilename(filePath);
    if (!externalSessionId) return undefined;

    const indexed = index.get(externalSessionId);
    const firstUserText = firstCodexUserMessage(lines);
    const createdAt =
      isoTimestamp(payload?.timestamp) ??
      isoTimestamp(meta?.timestamp) ??
      stat?.birthtime.toISOString() ??
      new Date().toISOString();
    const updatedAt =
      isoTimestamp(indexed?.updatedAt) ??
      lastTimestamp(lines) ??
      stat?.mtime.toISOString() ??
      createdAt;

    return {
      id: nativeProviderSessionId('codex', externalSessionId),
      externalSessionId,
      provider: 'codex',
      title: titleFromText(indexed?.title ?? firstUserText, `Codex ${shortId(externalSessionId)}`),
      createdAt,
      updatedAt,
      workingDirectory: textValue(payload?.cwd),
      modelId: firstCodexModel(lines),
      sourcePath: filePath,
    };
  }

  private codexMessages(native: NativeProviderSession): SessionMessage[] {
    const lines = readJsonLines(native.sourcePath);
    const messages: SessionMessage[] = [];
    let sequence = 1;

    for (const [index, line] of lines.entries()) {
      const payload = isRecord(line.payload) ? line.payload : undefined;
      if (!payload) continue;

      if (line.type === 'event_msg' && payload.type === 'user_message') {
        const content =
          textValue(payload.message) ??
          textFromUnknown(payload.text_elements) ??
          textFromUnknown(payload.images) ??
          '';
        if (shouldIncludeNativeMessage(messages, 'user', content)) {
          messages.push(nativeMessage(native, sequence++, index, {
            role: 'user',
            type: 'text',
            content,
            createdAt: isoTimestamp(line.timestamp) ?? isoTimestamp(payload.timestamp) ?? native.createdAt,
          }));
        }
        continue;
      }

      if (line.type !== 'response_item') continue;

      if (payload.type === 'message') {
        const role = payload.role === 'user' ? 'user' : 'assistant';
        const content = textFromUnknown(payload.content);
        if (shouldIncludeNativeMessage(messages, role, content)) {
          messages.push(nativeMessage(native, sequence++, index, {
            role,
            type: 'text',
            content,
            createdAt: isoTimestamp(line.timestamp) ?? native.updatedAt,
          }));
        }
        continue;
      }

      if (payload.type === 'reasoning') {
        const content = textFromUnknown(payload.summary) || textFromUnknown(payload.content);
        if (content.trim()) {
          messages.push(nativeMessage(native, sequence++, index, {
            role: 'summary',
            type: 'plan',
            content,
            createdAt: isoTimestamp(line.timestamp) ?? native.updatedAt,
          }));
        }
      }
    }

    return messages;
  }

  private listClaudeCodeSessions(): NativeProviderSession[] {
    const projectsDir = path.join(claudeHome(), 'projects');
    return listJsonlFiles(projectsDir)
      .sort((a, b) => safeStatMtimeMs(b) - safeStatMtimeMs(a))
      .slice(0, MAX_HISTORY_FILES)
      .map((filePath) => this.claudeCodeSessionFromFile(filePath))
      .filter((session): session is NativeProviderSession => Boolean(session));
  }

  private findClaudeCodeSession(externalSessionId: string): NativeProviderSession | undefined {
    for (const filePath of listJsonlFiles(path.join(claudeHome(), 'projects'))) {
      const session = this.claudeCodeSessionFromFile(filePath);
      if (session?.externalSessionId === externalSessionId) return session;
    }
    return undefined;
  }

  private claudeCodeSessionFromFile(filePath: string): NativeProviderSession | undefined {
    const stat = safeStat(filePath);
    const lines = readJsonLines(filePath);
    if (!lines.length) return undefined;

    const messageLines = lines.filter((line) => isRecord(line.message));
    const firstMessage = messageLines[0] ?? lines[0];
    const lastLine = lines.at(-1) ?? firstMessage;
    const externalSessionId =
      textValue(firstMessage.sessionId) ??
      textValue(lastLine.sessionId) ??
      path.basename(filePath, path.extname(filePath));
    if (!externalSessionId) return undefined;

    const firstUser = messageLines.find((line) => line.type === 'user');
    const createdAt =
      isoTimestamp(firstMessage.timestamp) ??
      stat?.birthtime.toISOString() ??
      new Date().toISOString();
    const updatedAt =
      lastTimestamp(lines) ??
      stat?.mtime.toISOString() ??
      createdAt;

    return {
      id: nativeProviderSessionId('claude-code', externalSessionId),
      externalSessionId,
      provider: 'claude-code',
      title: titleFromText(
        firstUser ? textFromUnknown((firstUser.message as Record<string, unknown>).content) : undefined,
        `Claude Code ${shortId(externalSessionId)}`
      ),
      createdAt,
      updatedAt,
      workingDirectory: textValue(firstMessage.cwd) ?? textValue(lastLine.cwd),
      sourcePath: filePath,
    };
  }

  private claudeCodeMessages(native: NativeProviderSession): SessionMessage[] {
    const lines = readJsonLines(native.sourcePath);
    const messages: SessionMessage[] = [];
    let sequence = 1;

    for (const [index, line] of lines.entries()) {
      if (!isRecord(line.message)) continue;
      const role = line.message.role === 'assistant' ? 'assistant' : 'user';
      const content = textFromUnknown(line.message.content);
      if (!shouldIncludeNativeMessage(messages, role, content)) continue;

      messages.push(nativeMessage(native, sequence++, index, {
        role,
        type: 'text',
        content,
        createdAt: isoTimestamp(line.timestamp) ?? native.updatedAt,
      }));
    }

    return messages;
  }
}

export function nativeProviderSessionToAgentSession(native: NativeProviderSession): AgentSession {
  return {
    id: native.id,
    deviceId: 'native-provider-history',
    title: native.title,
    status: 'idle',
    executorType: native.provider,
    mode: 'agent',
    permissionMode: 'default' satisfies SessionPermissionMode,
    modelId: native.modelId,
    createdBy: 'provider-history',
    createdAt: native.createdAt,
    updatedAt: native.updatedAt,
    lastMessageAt: native.updatedAt,
    workingDirectory: native.workingDirectory,
    pinned: false,
    archived: false,
    externalSessionId: native.externalSessionId,
  };
}

function nativeMessage(
  native: NativeProviderSession,
  sequence: number,
  lineIndex: number,
  input: Pick<SessionMessage, 'role' | 'type' | 'content' | 'createdAt'>
): SessionMessage {
  return {
    id: `${native.id}:message:${lineIndex}`,
    sessionId: native.id,
    role: input.role,
    type: input.type,
    content: trimText(input.content, MAX_MESSAGE_TEXT),
    status: 'completed',
    modelId: native.modelId,
    createdAt: input.createdAt,
    sequence,
    metadata: {
      source: 'provider-history',
      externalSessionId: native.externalSessionId,
    },
  };
}

function shouldIncludeNativeMessage(
  messages: SessionMessage[],
  role: SessionMessage['role'],
  content: string
): boolean {
  if (!content.trim()) return false;
  if (role === 'user' && isProviderControlMessage(content)) return false;

  const previous = messages.at(-1);
  return !(
    role === 'user' &&
    previous?.role === 'user' &&
    normalizeMessageText(previous.content) === normalizeMessageText(content)
  );
}

function isProviderControlMessage(content: string): boolean {
  return TURN_ABORTED_PATTERN.test(content.trim());
}

function normalizeMessageText(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function codexHome(): string {
  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), '.codex');
}

function claudeHome(): string {
  return process.env.CLAUDE_HOME
    ? path.resolve(process.env.CLAUDE_HOME)
    : path.join(os.homedir(), '.claude');
}

function readCodexSessionIndex(): Map<string, CodexIndexEntry> {
  const indexPath = path.join(codexHome(), 'session_index.jsonl');
  const entries = new Map<string, CodexIndexEntry>();
  for (const line of readJsonLines(indexPath)) {
    const id = textValue(line.id);
    if (!id) continue;
    entries.set(id, {
      title: textValue(line.thread_name),
      updatedAt: textValue(line.updated_at),
    });
  }
  return entries;
}

function listJsonlFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  walk(root);
  return files;
}

function readJsonLines(filePath: string): JsonLine[] {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines: JsonLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      lines.push(JSON.parse(line) as JsonLine);
    } catch {
      // Provider history files occasionally contain partial/corrupt tail lines.
    }
  }
  return lines;
}

function firstCodexUserMessage(lines: JsonLine[]): string | undefined {
  for (const line of lines) {
    const payload = isRecord(line.payload) ? line.payload : undefined;
    if (!payload) continue;
    if (line.type === 'event_msg' && payload.type === 'user_message') {
      return textValue(payload.message) ?? textFromUnknown(payload.text_elements);
    }
    if (line.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      return textFromUnknown(payload.content);
    }
  }
  return undefined;
}

function firstCodexModel(lines: JsonLine[]): string | undefined {
  for (const line of lines) {
    const payload = isRecord(line.payload) ? line.payload : undefined;
    if (!payload) continue;
    const model = isRecord(payload) ? textValue(payload.model) : undefined;
    if (model) return model;
  }
  return undefined;
}

function lastTimestamp(lines: JsonLine[]): string | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const timestamp = isoTimestamp(line.timestamp);
    if (timestamp) return timestamp;
    const payload = isRecord(line.payload) ? line.payload : undefined;
    const payloadTimestamp = isoTimestamp(payload?.timestamp) ?? isoTimestamp(payload?.completed_at);
    if (payloadTimestamp) return payloadTimestamp;
  }
  return undefined;
}

function codexSessionIdFromFilename(filePath: string): string | undefined {
  const match = /rollout-.+?-([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i.exec(path.basename(filePath));
  return match?.[1];
}

function titleFromText(value: string | undefined, fallback: string): string {
  const title = value?.replace(/\s+/g, ' ').trim();
  if (!title) return fallback;
  return trimText(title, 96);
}

function trimText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => textFromUnknown(item))
      .filter(Boolean)
      .join('\n');
  }
  if (isRecord(value)) {
    return (
      textValue(value.text) ??
      optionalTextFromUnknown(value.content) ??
      textValue(value.message) ??
      textFromUnknown(value.value)
    );
  }
  return '';
}

function optionalTextFromUnknown(value: unknown): string | undefined {
  const text = textFromUnknown(value).trim();
  return text ? text : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isoTimestamp(value: unknown): string | undefined {
  const text = textValue(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sessionTime(session: Pick<NativeProviderSession, 'updatedAt' | 'createdAt'>): number {
  const value = Date.parse(session.updatedAt) || Date.parse(session.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function safeStat(filePath: string): fs.Stats | undefined {
  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}

function safeStatMtimeMs(filePath: string): number {
  return safeStat(filePath)?.mtimeMs ?? 0;
}

function shortId(value: string): string {
  return value.length <= 8 ? value : value.slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}
