import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { EventRepository, SessionStreamRepository } from '@rac/storage';
import { sseManager } from '../services/sse-manager.js';
import { authMiddleware } from '../middleware/auth.js';
import type Database from 'better-sqlite3';

function parseLastEventId(value: unknown): number {
  if (typeof value !== 'string') {
    return 0;
  }

  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function createSSERouter(db: Database.Database): Router {
  const router = Router();
  const eventRepo = new EventRepository(db);
  const sessionStreamRepo = new SessionStreamRepository(db);

  router.use(authMiddleware);

  router.get('/', (req, res) => {
    const clientId = uuid();
    const taskId =
      typeof req.query.taskId === 'string' ? req.query.taskId : undefined;
    const sessionId =
      typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    const lastSeq = Math.max(
      parseLastEventId(req.headers['last-event-id']),
      parseLastEventId(req.query.lastEventId),
    );

    sseManager.addClient(clientId, taskId, res, sessionId);

    if (taskId && lastSeq > 0) {
      const client = { id: clientId, taskId, sessionId, res };
      const missedEvents = eventRepo.findAfterSeq(taskId, lastSeq);
      for (const event of missedEvents) {
        sseManager.writeTaskEvent(client, event);
      }
    }

    if (sessionId && lastSeq > 0) {
      const client = { id: clientId, taskId, sessionId, res };
      const missedEvents = sessionStreamRepo.findAfterSeq(sessionId, lastSeq);
      for (const event of missedEvents) {
        sseManager.writeSessionEvent(client, event);
      }
    }
  });

  return router;
}
