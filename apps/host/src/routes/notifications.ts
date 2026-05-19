import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import {
  PushSubscriptionRepository,
} from '@rac/storage';
import {
  pushSubscriptionInputSchema,
  unsubscribePushInputSchema,
  updateNotificationSettingsInputSchema,
} from '@rac/shared';
import { authMiddleware } from '../middleware/auth.js';
import type Database from 'better-sqlite3';
import type { NotificationService } from '../services/notification-service.js';

export function createNotificationRouter(
  db: Database.Database,
  notificationService: NotificationService,
): Router {
  const router = Router();
  const pushSubscriptionRepo = new PushSubscriptionRepository(db);

  router.get('/vapid-public-key', async (_req, res) => {
    const publicKey = await notificationService.getVapidPublicKey();
    res.json({ ok: true, data: { publicKey } });
  });

  router.use(authMiddleware);

  router.get('/settings', async (_req, res) => {
    const settings = await notificationService.getSettings();
    res.json({ ok: true, data: settings });
  });

  router.put('/settings', async (req, res) => {
    const parsed = updateNotificationSettingsInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Invalid notification settings payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    const settings = await notificationService.updateSettings(parsed.data);
    res.json({ ok: true, data: settings });
  });

  router.post('/test-webhook', async (_req, res) => {
    try {
      await notificationService.sendWebhookTest();
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Webhook test failed',
      });
    }
  });

  router.post('/test-telegram', async (_req, res) => {
    try {
      await notificationService.sendTelegramTest();
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Telegram test failed',
      });
    }
  });

  router.post('/subscribe', (req, res) => {
    const parsed = pushSubscriptionInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Invalid push subscription payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    const subscription = pushSubscriptionRepo.createOrUpdate({
      ...parsed.data,
      id: uuid(),
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ ok: true, data: subscription });
  });

  router.post('/unsubscribe', (req, res) => {
    const parsed = unsubscribePushInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: 'Invalid push unsubscribe payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    pushSubscriptionRepo.deleteByEndpoint(parsed.data.endpoint);
    res.json({ ok: true });
  });

  return router;
}
