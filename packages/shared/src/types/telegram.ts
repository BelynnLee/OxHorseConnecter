import { z } from 'zod';

import {
  agentModeSchema,
  sessionPermissionModeSchema,
} from './session.js';
import { executorTypeSchema } from './task.js';

export const telegramGatewayModeSchema = z.enum(['auto', 'polling', 'webhook']);

export const telegramChatTypeSchema = z.enum([
  'private',
  'group',
  'supergroup',
  'channel',
]);

export const telegramCallbackKindSchema = z.enum([
  'approval',
  'model',
  'command',
]);

export const telegramMediaKindSchema = z.enum([
  'photo',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
]);

export const telegramGatewaySettingsSchema = z.object({
  enabled: z.boolean(),
  mode: telegramGatewayModeSchema,
  webhookUrl: z.string().url().optional(),
  webhookSecretConfigured: z.boolean(),
  allowAllUsers: z.boolean(),
  allowedUsers: z.array(z.string()),
  allowedGroupChats: z.array(z.string()),
  requireMention: z.boolean(),
  defaultDeviceId: z.string().min(1),
  defaultProjectId: z.string().min(1).optional(),
  defaultProjectPath: z.string().min(1).optional(),
  defaultExecutor: executorTypeSchema,
  defaultMode: agentModeSchema,
  defaultPermissionMode: sessionPermissionModeSchema,
  streamingEnabled: z.boolean(),
});

export type TelegramGatewayMode = z.infer<typeof telegramGatewayModeSchema>;
export type TelegramChatType = z.infer<typeof telegramChatTypeSchema>;
export type TelegramCallbackKind = z.infer<typeof telegramCallbackKindSchema>;
export type TelegramMediaKind = z.infer<typeof telegramMediaKindSchema>;
export type TelegramGatewaySettings = z.infer<typeof telegramGatewaySettingsSchema>;

export interface TelegramSource {
  chatId: string;
  chatType: TelegramChatType;
  userId?: string;
  username?: string;
  messageId?: number;
  threadId?: string;
  threadKey: string;
  isRootThread: boolean;
  isGroupLike: boolean;
}

export interface TelegramSessionBinding {
  id: string;
  chatId: string;
  chatType: TelegramChatType;
  userId?: string;
  threadKey: string;
  sessionId: string;
  topicMode: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  metadata?: Record<string, unknown>;
}

export interface TelegramCallbackToken {
  token: string;
  kind: TelegramCallbackKind;
  chatId: string;
  userId?: string;
  sessionId?: string;
  approvalId?: string;
  action: string;
  payload?: Record<string, unknown>;
  expiresAt: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface TelegramMediaAttachment {
  id: string;
  sessionId?: string;
  messageId?: string;
  telegramFileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  fileType: TelegramMediaKind;
  localPath?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
