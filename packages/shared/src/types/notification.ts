import { z } from 'zod';

export const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const unsubscribePushInputSchema = z.object({
  endpoint: z.string().min(1),
});

export const updateNotificationSettingsInputSchema = z.object({
  webhookUrl: z.string().url().nullable().optional(),
  webhookSecret: z.string().nullable().optional(),
  telegramChatId: z.string().nullable().optional(),
  approvalTimeoutSeconds: z.number().int().min(10).max(3600).nullable().optional(),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;
export type UnsubscribePushInput = z.infer<typeof unsubscribePushInputSchema>;
export type UpdateNotificationSettingsInput = z.infer<
  typeof updateNotificationSettingsInputSchema
>;

export interface PushSubscriptionRecord extends PushSubscriptionInput {
  id: string;
  createdAt: string;
}

export interface NotificationSettings {
  webhookUrl?: string;
  webhookSecretConfigured: boolean;
  telegramBotTokenConfigured: boolean;
  telegramChatId?: string;
  webPushPublicKey?: string;
  webPushEnabled: boolean;
  approvalTimeoutSeconds: number;
}

export type NotificationEventType =
  | 'task.approval_requested'
  | 'task.completed'
  | 'task.failed';

export interface NotificationPayload {
  event: NotificationEventType;
  taskId: string;
  title: string;
  createdAt: string;
  approvalId?: string;
  actionType?: string;
  riskLevel?: string;
  reason?: string;
  commandPreview?: string;
  approveUrl?: string;
  rejectUrl?: string;
  summary?: string;
  errorMessage?: string;
}
