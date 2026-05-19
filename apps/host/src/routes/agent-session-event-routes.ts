import { Router } from 'express';
import type { ApprovalRepository } from '@rac/storage';
import type { AgentEvent } from '@rac/shared';
import type { SessionService } from '../services/session-service.js';
import { handleAgentRouteError } from './agent-route-utils.js';
import {
  assistantTimelineCreatedAt,
  boundedLimit,
  diffEvents,
  latestTaskMessageTimestamps,
  mapSessionRunStatus,
  messageToAgentEvents,
  sessionEventToAgentEvents,
} from './agent-event-mapper.js';

export function createAgentSessionEventRouter(
  sessionService: SessionService,
  approvalRepo: ApprovalRepository
): Router {
  const router = Router();

  router.get('/sessions/:id/events', async (req, res) => {
    try {
      const limit = boundedLimit(req.query.limit, 500, 1000);
      const detail = sessionService.getDetail(req.params.id, { limit });
      const gitInfo = await sessionService.getGitInfoAsync(req.params.id);
      const diff = sessionService.getDiff(req.params.id);
      const snapshots = {
        assistant: new Map<string, string>(),
        toolOutput: new Map<string, string>(),
      };
      const latestByTaskId = latestTaskMessageTimestamps(detail.messages);
      const lastAssistant = [...detail.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.content.trim());
      const lastEventId = Number.parseInt(String(req.query.lastEventId ?? '0'), 10) || 0;
      let eventId = 0;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      res.write(':\n\n');

      function write(event: AgentEvent): void {
        eventId += 1;
        if (eventId <= lastEventId) {
          return;
        }
        res.write(`id: ${eventId}\n`);
        res.write('event: message\n');
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      write({
        type: 'session.started',
        sessionId: detail.session.id,
        cwd: gitInfo.cwd ?? detail.session.workingDirectory ?? '',
        model: detail.session.modelId ?? 'provider default',
        reasoningEffort: detail.session.reasoningEffort ?? null,
        mode: detail.session.mode,
        executorType: detail.session.executorType,
        permissionMode: detail.session.permissionMode,
        runtimeOptions: detail.session.runtimeOptions ?? {},
        status: mapSessionRunStatus(detail.session),
        createdAt: detail.session.createdAt,
      });

      for (const message of detail.messages) {
        if (message.role === 'assistant') {
          snapshots.assistant.set(message.id, message.content);
        }
        if (message.type === 'tool_result') {
          snapshots.toolOutput.set(message.id, message.content);
        }
        const assistantFallback =
          message.role === 'assistant' && message.status !== 'streaming'
            ? ((message.taskId ? latestByTaskId.get(message.taskId) : undefined) ??
              (message.id === lastAssistant?.id
                ? (detail.session.lastMessageAt ?? detail.session.updatedAt)
                : undefined))
            : undefined;
        for (const agentEvent of messageToAgentEvents(
          message,
          (id) => approvalRepo.findById(id),
          assistantFallback
        )) {
          write(agentEvent);
        }
      }

      for (const agentEvent of diffEvents(diff, diff?.createdAt ?? new Date().toISOString())) {
        write(agentEvent);
      }

      if (detail.session.status === 'idle' && lastAssistant) {
        write({
          type: 'session.completed',
          summary: lastAssistant.content,
          createdAt: assistantTimelineCreatedAt(
            lastAssistant,
            lastAssistant.taskId ? latestByTaskId.get(lastAssistant.taskId) : undefined
          ),
        });
      } else if (detail.session.status === 'interrupted') {
        write({
          type: 'session.cancelled',
          createdAt: detail.session.updatedAt,
        });
      } else if (detail.session.status === 'failed') {
        const lastError = [...detail.messages]
          .reverse()
          .find((message) => message.type === 'error' && message.content.trim());
        write({
          type: 'session.failed',
          error: lastError?.content ?? 'Agent session failed.',
          createdAt: lastError?.createdAt ?? detail.session.updatedAt,
        });
      }

      eventId = Math.max(eventId, lastEventId);

      const unsubscribe = sessionService.subscribeSessionEvents(req.params.id, (event) => {
        for (const agentEvent of sessionEventToAgentEvents(event, snapshots, (id) =>
          approvalRepo.findById(id)
        )) {
          write(agentEvent);
        }
      });

      const heartbeat = setInterval(() => {
        res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
      }, 30_000);
      if (typeof heartbeat === 'object' && 'unref' in heartbeat) {
        heartbeat.unref();
      }

      res.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (err) {
      handleAgentRouteError(res, err);
    }
  });

  router.get('/sessions/:id/stream', (req, res) => {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(307, `/api/agent/sessions/${req.params.id}/events${query}`);
  });

  return router;
}
