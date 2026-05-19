import type {
  Approval,
  NotificationPayload,
  NotificationSettings,
  Task,
  UpdateNotificationSettingsInput,
} from '@rac/shared';
import type {
  PushSubscriptionRepository,
  SettingRepository,
} from '@rac/storage';
import { createLogger } from '@rac/logger';
import { WebhookAdapter } from './adapters/webhook-adapter.js';
import { TelegramAdapter } from './adapters/telegram-adapter.js';
import { WebPushAdapter } from './adapters/web-push-adapter.js';

const log = createLogger('notifications');

interface NotificationServiceOptions {
  publicBaseUrl: string;
  webhookUrl?: string;
  webhookSecret?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  webPushPublicKey?: string;
  webPushPrivateKey?: string;
  defaultApprovalTimeoutSeconds: number;
}

const SETTINGS_KEYS = {
  webhookUrl: 'notification.webhookUrl',
  webhookSecret: 'notification.webhookSecret',
  telegramChatId: 'notification.telegramChatId',
  vapidPublicKey: 'vapid.publicKey',
  vapidPrivateKey: 'vapid.privateKey',
  approvalTimeoutSeconds: 'approval.timeoutSeconds',
} as const;

export class NotificationService {
  private readonly webhookAdapter = new WebhookAdapter();
  private readonly telegramAdapter: TelegramAdapter;
  private readonly webPushAdapter = new WebPushAdapter();

  constructor(
    private readonly settingRepo: SettingRepository,
    private readonly pushSubscriptionRepo: PushSubscriptionRepository,
    private readonly options: NotificationServiceOptions,
  ) {
    this.telegramAdapter = new TelegramAdapter(options.telegramBotToken);
  }

  async getSettings(): Promise<NotificationSettings> {
    const webPushPublicKey = await this.getVapidPublicKey();

    return {
      webhookUrl: this.getWebhookUrl(),
      webhookSecretConfigured: Boolean(this.getWebhookSecret()),
      telegramBotTokenConfigured: Boolean(this.options.telegramBotToken),
      telegramChatId: this.getTelegramChatId(),
      webPushPublicKey,
      webPushEnabled: Boolean(webPushPublicKey),
      approvalTimeoutSeconds: this.getApprovalTimeoutSeconds(),
    };
  }

  async updateSettings(input: UpdateNotificationSettingsInput): Promise<NotificationSettings> {
    this.setOptionalSetting(SETTINGS_KEYS.webhookUrl, input.webhookUrl);
    this.setOptionalSetting(SETTINGS_KEYS.webhookSecret, input.webhookSecret);
    this.setOptionalSetting(SETTINGS_KEYS.telegramChatId, input.telegramChatId);
    if (input.approvalTimeoutSeconds === null) {
      this.settingRepo.delete(SETTINGS_KEYS.approvalTimeoutSeconds);
    } else if (input.approvalTimeoutSeconds !== undefined) {
      this.settingRepo.set(
        SETTINGS_KEYS.approvalTimeoutSeconds,
        String(input.approvalTimeoutSeconds),
      );
    }
    return this.getSettings();
  }

  getApprovalTimeoutSeconds(): number {
    const value = this.settingRepo.get(SETTINGS_KEYS.approvalTimeoutSeconds);
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 10
      ? parsed
      : this.options.defaultApprovalTimeoutSeconds;
  }

  async sendWebhookTest(): Promise<void> {
    await this.webhookAdapter.send(
      this.getWebhookUrl(),
      {
        event: 'task.completed',
        taskId: 'notification-test',
        title: 'Notification test',
        summary: 'Remote Agent Console webhook test.',
        createdAt: new Date().toISOString(),
      },
      this.getWebhookSecret(),
    );
  }

  async sendTelegramTest(): Promise<void> {
    if (!this.options.telegramBotToken) {
      throw new Error('Telegram bot token is not configured. Set TELEGRAM_BOT_TOKEN in .env.');
    }

    const chatId = this.getTelegramChatId();
    if (!chatId) {
      throw new Error('Telegram chat ID is not configured. Set it in Settings or TELEGRAM_CHAT_ID in .env.');
    }

    await this.telegramAdapter.send(chatId, {
      event: 'task.completed',
      taskId: 'notification-test',
      title: 'Notification test',
      summary: 'Remote Agent Console Telegram test.',
      createdAt: new Date().toISOString(),
    });
  }

  async getVapidPublicKey(): Promise<string | undefined> {
    const configuredPublicKey =
      this.options.webPushPublicKey ??
      this.settingRepo.get(SETTINGS_KEYS.vapidPublicKey);
    const configuredPrivateKey =
      this.options.webPushPrivateKey ??
      this.settingRepo.get(SETTINGS_KEYS.vapidPrivateKey);

    if (configuredPublicKey && configuredPrivateKey) {
      return configuredPublicKey;
    }

    const generatedKeys = await this.webPushAdapter.generateVapidKeys();
    if (!generatedKeys) {
      return configuredPublicKey;
    }

    this.settingRepo.set(SETTINGS_KEYS.vapidPublicKey, generatedKeys.publicKey);
    this.settingRepo.set(SETTINGS_KEYS.vapidPrivateKey, generatedKeys.privateKey);
    return generatedKeys.publicKey;
  }

  notifyApprovalRequested(task: Task, approval: Approval): void {
    const payload: NotificationPayload = {
      event: 'task.approval_requested',
      taskId: task.id,
      title: task.title,
      approvalId: approval.id,
      actionType: approval.actionType,
      riskLevel: approval.riskLevel,
      reason: approval.reason,
      commandPreview: approval.commandPreview,
      approveUrl: `${this.options.publicBaseUrl}/api/approvals/${approval.id}/approve`,
      rejectUrl: `${this.options.publicBaseUrl}/api/approvals/${approval.id}/reject`,
      createdAt: new Date().toISOString(),
    };

    void this.dispatch(payload);
  }

  notifyTaskCompleted(task: Task, summary: string): void {
    const payload: NotificationPayload = {
      event: 'task.completed',
      taskId: task.id,
      title: task.title,
      summary,
      createdAt: new Date().toISOString(),
    };

    void this.dispatch(payload);
  }

  notifyTaskFailed(task: Task, errorMessage: string): void {
    const payload: NotificationPayload = {
      event: 'task.failed',
      taskId: task.id,
      title: task.title,
      errorMessage,
      createdAt: new Date().toISOString(),
    };

    void this.dispatch(payload);
  }

  private async dispatch(payload: NotificationPayload): Promise<void> {
    const webhookUrl = this.getWebhookUrl();
    const webhookSecret = this.getWebhookSecret();
    const telegramChatId = this.getTelegramChatId();
    const vapidKeys = await this.getVapidKeys();
    const subscriptions = this.pushSubscriptionRepo.findAll();

    const deliveries = [
      this.webhookAdapter.send(webhookUrl, payload, webhookSecret),
      this.telegramAdapter.send(telegramChatId, payload),
      this.webPushAdapter.sendToAll(subscriptions, payload, vapidKeys),
    ];

    const results = await Promise.allSettled(deliveries);
    for (const result of results) {
      if (result.status === 'rejected') {
        log.warn({ err: result.reason }, 'Delivery failed');
      }
    }
  }

  private getWebhookUrl(): string | undefined {
    return this.settingRepo.get(SETTINGS_KEYS.webhookUrl) || this.options.webhookUrl;
  }

  private getWebhookSecret(): string | undefined {
    return (
      this.settingRepo.get(SETTINGS_KEYS.webhookSecret) ||
      this.options.webhookSecret
    );
  }

  private getTelegramChatId(): string | undefined {
    return (
      this.settingRepo.get(SETTINGS_KEYS.telegramChatId) ||
      this.options.telegramChatId
    );
  }

  private async getVapidKeys(): Promise<
    { publicKey: string; privateKey: string } | undefined
  > {
    const publicKey =
      this.options.webPushPublicKey ??
      this.settingRepo.get(SETTINGS_KEYS.vapidPublicKey);
    const privateKey =
      this.options.webPushPrivateKey ??
      this.settingRepo.get(SETTINGS_KEYS.vapidPrivateKey);

    if (publicKey && privateKey) {
      return { publicKey, privateKey };
    }

    const generatedPublicKey = await this.getVapidPublicKey();
    const generatedPrivateKey = this.settingRepo.get(SETTINGS_KEYS.vapidPrivateKey);
    return generatedPublicKey && generatedPrivateKey
      ? { publicKey: generatedPublicKey, privateKey: generatedPrivateKey }
      : undefined;
  }

  private setOptionalSetting(key: string, value: string | null | undefined): void {
    if (value === undefined) {
      return;
    }

    if (value === null) {
      this.settingRepo.delete(key);
      return;
    }

    const normalized = value.trim();
    if (!normalized) {
      this.settingRepo.delete(key);
      return;
    }

    this.settingRepo.set(key, normalized);
  }
}
