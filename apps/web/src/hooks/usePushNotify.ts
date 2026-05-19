import { useState } from 'react';
import type { PushSubscriptionInput } from '../types.ts';
import { subscribePush, unsubscribePush } from '../api.ts';
import { useT } from '../i18n/index.ts';

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

function toPushSubscriptionInput(
  subscription: PushSubscription,
  incompleteSubscriptionMessage: string
): PushSubscriptionInput {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error(incompleteSubscriptionMessage);
  }

  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  };
}

export function usePushNotify(publicKey?: string) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  async function subscribe() {
    setBusy(true);
    setError('');

    try {
      if (!supported) {
        throw new Error(t.settings.pushNotSupported);
      }
      if (!publicKey) {
        throw new Error(t.settings.pushVapidMissing);
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error(t.settings.pushPermissionDenied);
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
        }));

      await subscribePush(toPushSubscriptionInput(subscription, t.settings.pushIncompleteSubscription));
    } catch (err) {
      const message = err instanceof Error ? err.message : t.settings.errorSubscribe;
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setError('');

    try {
      if (!supported) {
        throw new Error(t.settings.pushNotSupported);
      }

      const registration = await navigator.serviceWorker.getRegistration('/sw.js');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await unsubscribePush(subscription.endpoint);
        await subscription.unsubscribe();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t.settings.errorUnsubscribe;
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    supported,
    subscribe,
    unsubscribe,
  };
}
