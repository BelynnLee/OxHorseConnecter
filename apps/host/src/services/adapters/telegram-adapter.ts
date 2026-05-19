import type { NotificationPayload } from '@rac/shared';

interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

interface TelegramSendMessagePayload {
  chat_id: string;
  text: string;
  reply_markup?: {
    inline_keyboard: TelegramInlineButton[][];
  };
}

function buildMessage(payload: NotificationPayload): string {
  if (payload.event === 'task.approval_requested') {
    const lines = [
      `Approval requested: ${payload.title}`,
      `Risk: ${payload.riskLevel ?? 'unknown'}`,
      `Action: ${payload.actionType ?? 'unknown'}`,
      payload.reason ? `Reason: ${payload.reason}` : undefined,
      payload.commandPreview ? `Command: ${payload.commandPreview}` : undefined,
    ];
    return lines.filter(Boolean).join('\n');
  }

  if (payload.event === 'task.completed') {
    return `Agent run completed: ${payload.title}${payload.summary ? `\n${payload.summary}` : ''}`;
  }

  return `Agent run failed: ${payload.title}${payload.errorMessage ? `\n${payload.errorMessage}` : ''}`;
}

export class TelegramAdapter {
  constructor(private readonly botToken?: string) {}

  async send(chatId: string | undefined, payload: NotificationPayload): Promise<void> {
    if (!this.botToken || !chatId) {
      return;
    }

    const requestBody: TelegramSendMessagePayload = {
      chat_id: chatId,
      text: buildMessage(payload),
    };

    if (payload.event === 'task.approval_requested' && payload.approvalId) {
      requestBody.reply_markup = {
        inline_keyboard: [
          [
            { text: 'Approve', callback_data: `approve:${payload.approvalId}` },
            { text: 'Reject', callback_data: `reject:${payload.approvalId}` },
          ],
        ],
      };
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      throw new Error(`Telegram returned HTTP ${response.status}.`);
    }
  }
}
