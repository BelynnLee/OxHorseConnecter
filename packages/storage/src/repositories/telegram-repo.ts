import type Database from 'better-sqlite3';
import type {
  TelegramCallbackKind,
  TelegramCallbackToken,
  TelegramChatType,
  TelegramMediaAttachment,
  TelegramMediaKind,
  TelegramSessionBinding,
} from '@rac/shared';
import { parseJson } from './row-utils.js';

export interface TelegramChatSettings {
  id: string;
  chatId: string;
  chatType: TelegramChatType;
  userId?: string;
  topicModeEnabled: boolean;
  defaultDeviceId?: string;
  defaultProjectId?: string;
  defaultProjectPath?: string;
  defaultExecutor?: string;
  defaultMode?: string;
  defaultPermissionMode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramBindingScope {
  chatId: string;
  chatType: TelegramChatType;
  userId?: string;
  threadKey?: string;
}

interface TelegramChatSettingsRow {
  id: string;
  chatId: string;
  chatType: string;
  userId: string | null;
  topicModeEnabled: number;
  defaultDeviceId: string | null;
  defaultProjectId: string | null;
  defaultProjectPath: string | null;
  defaultExecutor: string | null;
  defaultMode: string | null;
  defaultPermissionMode: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TelegramSessionBindingRow {
  id: string;
  chatId: string;
  chatType: string;
  userId: string | null;
  threadKey: string;
  sessionId: string;
  topicMode: number;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

interface TelegramCallbackTokenRow {
  token: string;
  kind: string;
  chatId: string;
  userId: string | null;
  sessionId: string | null;
  approvalId: string | null;
  action: string;
  payload: string | null;
  expiresAt: string;
  resolvedAt: string | null;
  createdAt: string;
}

interface TelegramMediaAttachmentRow {
  id: string;
  sessionId: string | null;
  messageId: string | null;
  telegramFileId: string;
  fileUniqueId: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileType: string;
  localPath: string | null;
  sizeBytes: number | null;
  metadata: string | null;
  createdAt: string;
}

function json(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {});
}

function scopeParams(scope: TelegramBindingScope): [string, string, string, string] {
  return [scope.chatId, scope.chatType, scope.userId ?? '', scope.threadKey ?? ''];
}

function chatSettingsRowToRecord(row: TelegramChatSettingsRow): TelegramChatSettings {
  return {
    id: row.id,
    chatId: row.chatId,
    chatType: row.chatType as TelegramChatType,
    userId: row.userId ?? undefined,
    topicModeEnabled: row.topicModeEnabled === 1,
    defaultDeviceId: row.defaultDeviceId ?? undefined,
    defaultProjectId: row.defaultProjectId ?? undefined,
    defaultProjectPath: row.defaultProjectPath ?? undefined,
    defaultExecutor: row.defaultExecutor ?? undefined,
    defaultMode: row.defaultMode ?? undefined,
    defaultPermissionMode: row.defaultPermissionMode ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function bindingRowToRecord(row: TelegramSessionBindingRow): TelegramSessionBinding {
  return {
    id: row.id,
    chatId: row.chatId,
    chatType: row.chatType as TelegramChatType,
    userId: row.userId ?? undefined,
    threadKey: row.threadKey,
    sessionId: row.sessionId,
    topicMode: row.topicMode === 1,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt ?? undefined,
  };
}

function callbackRowToRecord(row: TelegramCallbackTokenRow): TelegramCallbackToken {
  return {
    token: row.token,
    kind: row.kind as TelegramCallbackKind,
    chatId: row.chatId,
    userId: row.userId ?? undefined,
    sessionId: row.sessionId ?? undefined,
    approvalId: row.approvalId ?? undefined,
    action: row.action,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    expiresAt: row.expiresAt,
    resolvedAt: row.resolvedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

function mediaRowToRecord(row: TelegramMediaAttachmentRow): TelegramMediaAttachment {
  return {
    id: row.id,
    sessionId: row.sessionId ?? undefined,
    messageId: row.messageId ?? undefined,
    telegramFileId: row.telegramFileId,
    fileUniqueId: row.fileUniqueId ?? undefined,
    fileName: row.fileName ?? undefined,
    mimeType: row.mimeType ?? undefined,
    fileType: row.fileType as TelegramMediaKind,
    localPath: row.localPath ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
  };
}

export class TelegramRepository {
  constructor(private readonly db: Database.Database) {}

  findChatSettings(scope: {
    chatId: string;
    chatType: TelegramChatType;
    userId?: string;
  }): TelegramChatSettings | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM telegram_chat_settings
         WHERE chatId = ? AND chatType = ? AND COALESCE(userId, '') = ?`
      )
      .get(scope.chatId, scope.chatType, scope.userId ?? '') as
      | TelegramChatSettingsRow
      | undefined;
    return row ? chatSettingsRowToRecord(row) : undefined;
  }

  upsertChatSettings(settings: TelegramChatSettings): void {
    this.db
      .prepare(
        `INSERT INTO telegram_chat_settings (
          id, chatId, chatType, userId, topicModeEnabled, defaultDeviceId,
          defaultProjectId, defaultProjectPath, defaultExecutor, defaultMode,
          defaultPermissionMode, createdAt, updatedAt
        ) VALUES (
          @id, @chatId, @chatType, @userId, @topicModeEnabled, @defaultDeviceId,
          @defaultProjectId, @defaultProjectPath, @defaultExecutor, @defaultMode,
          @defaultPermissionMode, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          topicModeEnabled = excluded.topicModeEnabled,
          defaultDeviceId = excluded.defaultDeviceId,
          defaultProjectId = excluded.defaultProjectId,
          defaultProjectPath = excluded.defaultProjectPath,
          defaultExecutor = excluded.defaultExecutor,
          defaultMode = excluded.defaultMode,
          defaultPermissionMode = excluded.defaultPermissionMode,
          updatedAt = excluded.updatedAt`
      )
      .run({
        ...settings,
        userId: settings.userId ?? null,
        topicModeEnabled: settings.topicModeEnabled ? 1 : 0,
        defaultDeviceId: settings.defaultDeviceId ?? null,
        defaultProjectId: settings.defaultProjectId ?? null,
        defaultProjectPath: settings.defaultProjectPath ?? null,
        defaultExecutor: settings.defaultExecutor ?? null,
        defaultMode: settings.defaultMode ?? null,
        defaultPermissionMode: settings.defaultPermissionMode ?? null,
      });
  }

  setTopicMode(scope: {
    id: string;
    chatId: string;
    chatType: TelegramChatType;
    userId?: string;
  }, enabled: boolean): TelegramChatSettings {
    const now = new Date().toISOString();
    const existing = this.findChatSettings(scope);
    const settings: TelegramChatSettings = {
      id: existing?.id ?? scope.id,
      chatId: scope.chatId,
      chatType: scope.chatType,
      userId: scope.userId,
      topicModeEnabled: enabled,
      defaultDeviceId: existing?.defaultDeviceId,
      defaultProjectId: existing?.defaultProjectId,
      defaultProjectPath: existing?.defaultProjectPath,
      defaultExecutor: existing?.defaultExecutor,
      defaultMode: existing?.defaultMode,
      defaultPermissionMode: existing?.defaultPermissionMode,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.upsertChatSettings(settings);
    return settings;
  }

  findBinding(scope: TelegramBindingScope): TelegramSessionBinding | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM telegram_session_bindings
         WHERE chatId = ? AND chatType = ? AND COALESCE(userId, '') = ? AND threadKey = ?`
      )
      .get(...scopeParams(scope)) as TelegramSessionBindingRow | undefined;
    return row ? bindingRowToRecord(row) : undefined;
  }

  findBindingBySession(sessionId: string): TelegramSessionBinding | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM telegram_session_bindings
         WHERE sessionId = ?
         ORDER BY COALESCE(lastMessageAt, updatedAt) DESC
         LIMIT 1`
      )
      .get(sessionId) as TelegramSessionBindingRow | undefined;
    return row ? bindingRowToRecord(row) : undefined;
  }

  listBindings(scope: Omit<TelegramBindingScope, 'threadKey'>): TelegramSessionBinding[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM telegram_session_bindings
         WHERE chatId = ? AND chatType = ? AND COALESCE(userId, '') = ?
         ORDER BY COALESCE(lastMessageAt, updatedAt) DESC`
      )
      .all(scope.chatId, scope.chatType, scope.userId ?? '') as TelegramSessionBindingRow[];
    return rows.map(bindingRowToRecord);
  }

  upsertBinding(binding: TelegramSessionBinding): void {
    const existing = this.findBinding(binding);
    if (existing) {
      this.db
        .prepare(
          `UPDATE telegram_session_bindings
           SET sessionId = ?, topicMode = ?, metadata = ?, updatedAt = ?, lastMessageAt = ?
           WHERE id = ?`
        )
        .run(
          binding.sessionId,
          binding.topicMode ? 1 : 0,
          json(binding.metadata),
          binding.updatedAt,
          binding.lastMessageAt ?? null,
          existing.id
        );
      return;
    }

    this.db
      .prepare(
        `INSERT INTO telegram_session_bindings (
          id, chatId, chatType, userId, threadKey, sessionId, topicMode,
          metadata, createdAt, updatedAt, lastMessageAt
        ) VALUES (
          @id, @chatId, @chatType, @userId, @threadKey, @sessionId, @topicMode,
          @metadata, @createdAt, @updatedAt, @lastMessageAt
        )`
      )
      .run({
        ...binding,
        userId: binding.userId ?? null,
        topicMode: binding.topicMode ? 1 : 0,
        metadata: json(binding.metadata),
        lastMessageAt: binding.lastMessageAt ?? null,
      });
  }

  deleteBindingsForChat(scope: {
    chatId: string;
    chatType: TelegramChatType;
    userId?: string;
  }): number {
    const result = this.db
      .prepare(
        `DELETE FROM telegram_session_bindings
         WHERE chatId = ? AND chatType = ? AND COALESCE(userId, '') = ?`
      )
      .run(scope.chatId, scope.chatType, scope.userId ?? '');
    return result.changes;
  }

  deleteBinding(scope: TelegramBindingScope): number {
    const result = this.db
      .prepare(
        `DELETE FROM telegram_session_bindings
         WHERE chatId = ? AND chatType = ? AND COALESCE(userId, '') = ? AND threadKey = ?`
      )
      .run(...scopeParams(scope));
    return result.changes;
  }

  createCallbackToken(token: TelegramCallbackToken): void {
    this.db
      .prepare(
        `INSERT INTO telegram_callback_tokens (
          token, kind, chatId, userId, sessionId, approvalId, action,
          payload, expiresAt, resolvedAt, createdAt
        ) VALUES (
          @token, @kind, @chatId, @userId, @sessionId, @approvalId, @action,
          @payload, @expiresAt, @resolvedAt, @createdAt
        )`
      )
      .run({
        ...token,
        userId: token.userId ?? null,
        sessionId: token.sessionId ?? null,
        approvalId: token.approvalId ?? null,
        payload: json(token.payload),
        resolvedAt: token.resolvedAt ?? null,
      });
  }

  findCallbackToken(token: string): TelegramCallbackToken | undefined {
    const row = this.db
      .prepare('SELECT * FROM telegram_callback_tokens WHERE token = ?')
      .get(token) as TelegramCallbackTokenRow | undefined;
    return row ? callbackRowToRecord(row) : undefined;
  }

  resolveCallbackToken(token: string, resolvedAt = new Date().toISOString()): void {
    this.db
      .prepare('UPDATE telegram_callback_tokens SET resolvedAt = ? WHERE token = ?')
      .run(resolvedAt, token);
  }

  deleteExpiredCallbackTokens(now = new Date().toISOString()): number {
    const result = this.db
      .prepare('DELETE FROM telegram_callback_tokens WHERE expiresAt < ?')
      .run(now);
    return result.changes;
  }

  createMediaAttachment(attachment: TelegramMediaAttachment): void {
    this.db
      .prepare(
        `INSERT INTO telegram_media_attachments (
          id, sessionId, messageId, telegramFileId, fileUniqueId, fileName,
          mimeType, fileType, localPath, sizeBytes, metadata, createdAt
        ) VALUES (
          @id, @sessionId, @messageId, @telegramFileId, @fileUniqueId, @fileName,
          @mimeType, @fileType, @localPath, @sizeBytes, @metadata, @createdAt
        )`
      )
      .run({
        ...attachment,
        sessionId: attachment.sessionId ?? null,
        messageId: attachment.messageId ?? null,
        fileUniqueId: attachment.fileUniqueId ?? null,
        fileName: attachment.fileName ?? null,
        mimeType: attachment.mimeType ?? null,
        localPath: attachment.localPath ?? null,
        sizeBytes: attachment.sizeBytes ?? null,
        metadata: json(attachment.metadata),
      });
  }

  listMediaAttachments(sessionId: string): TelegramMediaAttachment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM telegram_media_attachments
         WHERE sessionId = ?
         ORDER BY createdAt ASC`
      )
      .all(sessionId) as TelegramMediaAttachmentRow[];
    return rows.map(mediaRowToRecord);
  }

  acquireGatewayLock(input: {
    name: string;
    keyHash: string;
    ownerId: string;
    ttlMs: number;
  }): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    const existing = this.db
      .prepare('SELECT ownerId, expiresAt FROM telegram_gateway_locks WHERE name = ?')
      .get(input.name) as { ownerId: string; expiresAt: string } | undefined;

    if (
      existing &&
      existing.ownerId !== input.ownerId &&
      Date.parse(existing.expiresAt) > now.getTime()
    ) {
      return false;
    }

    this.db
      .prepare(
        `INSERT INTO telegram_gateway_locks (name, keyHash, ownerId, expiresAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           keyHash = excluded.keyHash,
           ownerId = excluded.ownerId,
           expiresAt = excluded.expiresAt,
           updatedAt = excluded.updatedAt`
      )
      .run(input.name, input.keyHash, input.ownerId, expiresAt, nowIso, nowIso);
    return true;
  }

  renewGatewayLock(input: {
    name: string;
    ownerId: string;
    ttlMs: number;
  }): boolean {
    const now = new Date();
    const result = this.db
      .prepare(
        `UPDATE telegram_gateway_locks
         SET expiresAt = ?, updatedAt = ?
         WHERE name = ? AND ownerId = ?`
      )
      .run(new Date(now.getTime() + input.ttlMs).toISOString(), now.toISOString(), input.name, input.ownerId);
    return result.changes > 0;
  }

  releaseGatewayLock(name: string, ownerId: string): void {
    this.db
      .prepare('DELETE FROM telegram_gateway_locks WHERE name = ? AND ownerId = ?')
      .run(name, ownerId);
  }

  getLastUpdateId(botKey: string): number | undefined {
    const row = this.db
      .prepare('SELECT lastUpdateId FROM telegram_update_offsets WHERE botKey = ?')
      .get(botKey) as { lastUpdateId: number } | undefined;
    return row?.lastUpdateId;
  }

  setLastUpdateId(botKey: string, updateId: number): void {
    this.db
      .prepare(
        `INSERT INTO telegram_update_offsets (botKey, lastUpdateId, updatedAt)
         VALUES (?, ?, ?)
         ON CONFLICT(botKey) DO UPDATE SET
           lastUpdateId = MAX(lastUpdateId, excluded.lastUpdateId),
           updatedAt = excluded.updatedAt`
      )
      .run(botKey, updateId, new Date().toISOString());
  }
}
