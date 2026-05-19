import type {
  NotificationPayload,
  PushSubscriptionInput,
} from '@rac/shared';
import { generateKeyPairSync } from 'node:crypto';

interface WebPushModule {
  default?: WebPushRuntime;
  generateVAPIDKeys?: () => { publicKey: string; privateKey: string };
}

interface WebPushRuntime {
  setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string,
  ): void;
  sendNotification(
    subscription: PushSubscriptionInput,
    payload: string,
  ): Promise<void>;
  generateVAPIDKeys?: () => { publicKey: string; privateKey: string };
}

async function loadWebPush(): Promise<WebPushRuntime | undefined> {
  try {
    const moduleName = 'web-push';
    const imported = (await import(moduleName)) as WebPushModule;
    return imported.default ?? (imported as WebPushRuntime);
  } catch {
    return undefined;
  }
}

function base64UrlToBuffer(value: string): Buffer {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function bufferToBase64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generateLocalVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const publicJwk = publicKey.export({ format: 'jwk' });
  const privateJwk = privateKey.export({ format: 'jwk' });

  if (
    typeof publicJwk.x !== 'string' ||
    typeof publicJwk.y !== 'string' ||
    typeof privateJwk.d !== 'string'
  ) {
    throw new Error('Failed to export VAPID key material.');
  }

  return {
    publicKey: bufferToBase64Url(
      Buffer.concat([
        Buffer.from([0x04]),
        base64UrlToBuffer(publicJwk.x),
        base64UrlToBuffer(publicJwk.y),
      ]),
    ),
    privateKey: privateJwk.d,
  };
}

export class WebPushAdapter {
  async generateVapidKeys(): Promise<
    { publicKey: string; privateKey: string } | undefined
  > {
    const webPush = await loadWebPush();
    return webPush?.generateVAPIDKeys?.() ?? generateLocalVapidKeys();
  }

  async sendToAll(
    subscriptions: PushSubscriptionInput[],
    payload: NotificationPayload,
    vapidKeys?: { publicKey: string; privateKey: string },
  ): Promise<void> {
    if (!vapidKeys || subscriptions.length === 0) {
      return;
    }

    const webPush = await loadWebPush();
    if (!webPush) {
      return;
    }

    webPush.setVapidDetails(
      'mailto:admin@rac',
      vapidKeys.publicKey,
      vapidKeys.privateKey,
    );

    await Promise.allSettled(
      subscriptions.map((subscription) =>
        webPush.sendNotification(subscription, JSON.stringify(payload)),
      ),
    );
  }
}
