import { createHmac } from 'node:crypto';
import type { NotificationPayload } from '@rac/shared';

export class WebhookAdapter {
  async send(
    url: string | undefined,
    payload: NotificationPayload,
    secret?: string,
  ): Promise<void> {
    if (!url) {
      return;
    }

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (secret) {
      headers['X-RAC-Signature'] = createHmac('sha256', secret)
        .update(body)
        .digest('hex');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      throw new Error(`Webhook returned HTTP ${response.status}.`);
    }
  }
}
