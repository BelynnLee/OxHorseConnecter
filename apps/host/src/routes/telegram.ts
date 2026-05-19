import { Router } from 'express';
import type { TaskService } from '../services/task-service.js';
import type { TelegramGateway } from '../services/telegram-gateway.js';
import { config } from '../config.js';

interface TelegramCallbackQuery {
  data?: string;
  from?: {
    id?: number;
    username?: string;
  };
}

interface TelegramUpdate {
  callback_query?: TelegramCallbackQuery;
}

function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  return Boolean(value && typeof value === 'object');
}

function resolveTelegramUser(callback: TelegramCallbackQuery): string {
  if (callback.from?.username) {
    return callback.from.username;
  }

  if (typeof callback.from?.id === 'number') {
    return String(callback.from.id);
  }

  return 'telegram';
}

export function createTelegramRouter(
  taskService: TaskService,
  telegramGateway?: TelegramGateway,
): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    res.json({
      ok: true,
      data: telegramGateway?.status() ?? { enabled: false, configured: false, running: false },
    });
  });

  router.post('/webhook', async (req, res) => {
    if (config.telegramWebhookSecret) {
      const providedSecret =
        req.get('x-telegram-bot-api-secret-token') ||
        (typeof req.query.secret === 'string' ? req.query.secret : undefined);
      if (providedSecret !== config.telegramWebhookSecret) {
        res.status(403).json({ ok: false, error: 'Invalid Telegram webhook secret' });
        return;
      }
    }

    if (isLegacyApprovalCallback(req.body)) {
      const callback = req.body.callback_query;
      const data = callback.data!;
      const [decision, approvalId] = data.split(':');
      const ok = taskService.resolveApproval(
        approvalId,
        decision === 'approve',
        resolveTelegramUser(callback),
      );
      res.json({ ok });
      return;
    }

    if (telegramGateway?.isEnabled()) {
      try {
        await telegramGateway.handleWebhook(req);
        res.json({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Telegram webhook failed';
        res.status(message.includes('secret') ? 403 : 400).json({ ok: false, error: message });
      }
      return;
    }

    if (!isTelegramUpdate(req.body)) {
      res.json({ ok: true });
      return;
    }

    const callback = req.body.callback_query;
    const data = callback?.data;
    if (!callback || !data) {
      res.json({ ok: true });
      return;
    }

    const [decision, approvalId] = data.split(':');
    if (!approvalId || (decision !== 'approve' && decision !== 'reject')) {
      res.json({ ok: true });
      return;
    }

    const ok = taskService.resolveApproval(
      approvalId,
      decision === 'approve',
      resolveTelegramUser(callback),
    );
    res.json({ ok });
  });

  return router;
}

function isLegacyApprovalCallback(value: unknown): value is {
  callback_query: TelegramCallbackQuery & { data: string };
} {
  if (!isTelegramUpdate(value)) {
    return false;
  }
  const data = value.callback_query?.data;
  if (!data) {
    return false;
  }
  const [decision, approvalId] = data.split(':');
  return Boolean(approvalId && (decision === 'approve' || decision === 'reject'));
}
