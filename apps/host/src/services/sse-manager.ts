import type { Response } from 'express';
import type { Approval, Device, SessionStreamEvent, StreamEnvelope, TaskEvent } from '@rac/shared';

type SequencedTaskEvent = TaskEvent & { seq?: number };

type SSEClient = {
  id: string;
  taskId?: string;
  sessionId?: string;
  res: Response;
};

/** Manages Server-Sent Event connections for real-time task updates */
export class SSEManager {
  private clients = new Map<string, SSEClient>();

  constructor() {
    const heartbeatTimer = setInterval(() => {
      this.broadcastHeartbeat();
    }, 30_000);

    if (typeof heartbeatTimer === 'object' && 'unref' in heartbeatTimer) {
      heartbeatTimer.unref();
    }
  }

  addClient(id: string, taskId: string | undefined, res: Response, sessionId?: string): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    res.write(':\n\n'); // initial comment to establish connection

    this.clients.set(id, { id, taskId, sessionId, res });

    res.on('close', () => {
      this.removeClient(id);
    });
  }

  removeClient(id: string): void {
    this.clients.delete(id);
  }

  private writeEnvelope(
    client: SSEClient,
    envelope: StreamEnvelope,
    options?: { eventName?: string; eventId?: number }
  ): void {
    if (typeof options?.eventId === 'number') {
      client.res.write(`id: ${options.eventId}\n`);
    }

    client.res.write(`event: ${options?.eventName ?? 'message'}\n`);
    client.res.write(`data: ${JSON.stringify(envelope)}\n\n`);
  }

  writeTaskEvent(client: SSEClient, event: SequencedTaskEvent): void {
    const envelope: StreamEnvelope<'task.event'> = {
      channel: 'task.event',
      sentAt: new Date().toISOString(),
      payload: event,
    };

    this.writeEnvelope(client, envelope, { eventId: event.seq });
  }

  sendTaskEvent(taskId: string, event: SequencedTaskEvent): void {
    for (const client of this.clients.values()) {
      if (!client.taskId || client.taskId === taskId) {
        this.writeTaskEvent(client, event);
      }
    }
  }

  writeSessionEvent(client: SSEClient, event: SessionStreamEvent): void {
    const envelope: StreamEnvelope<'session.event'> = {
      channel: 'session.event',
      sentAt: new Date().toISOString(),
      payload: event,
    };

    this.writeEnvelope(client, envelope, { eventId: event.seq });
  }

  sendSessionEvent(sessionId: string, event: SessionStreamEvent): void {
    for (const client of this.clients.values()) {
      if (client.sessionId === sessionId || (!client.taskId && !client.sessionId)) {
        this.writeSessionEvent(client, event);
      }
    }
  }

  broadcastApproval(approval: Approval): void {
    const envelope: StreamEnvelope<'approval.event'> = {
      channel: 'approval.event',
      sentAt: new Date().toISOString(),
      payload: approval,
    };

    for (const client of this.clients.values()) {
      this.writeEnvelope(client, envelope);
    }
  }

  broadcastDevice(device: Device): void {
    const envelope: StreamEnvelope<'device.event'> = {
      channel: 'device.event',
      sentAt: new Date().toISOString(),
      payload: device,
    };

    for (const client of this.clients.values()) {
      this.writeEnvelope(client, envelope);
    }
  }

  broadcastPartialText(taskId: string, text: string, isFinal: boolean, turnId?: string): void {
    const data = JSON.stringify({
      taskId,
      text,
      isFinal,
      turnId,
      sentAt: new Date().toISOString(),
    });
    for (const client of this.clients.values()) {
      if (!client.taskId || client.taskId === taskId) {
        client.res.write(`event: partial\ndata: ${data}\n\n`);
      }
    }
  }

  private broadcastHeartbeat(): void {
    for (const client of this.clients.values()) {
      client.res.write(': heartbeat\n\n');
      client.res.write(`event: heartbeat\ndata: {"sentAt":"${new Date().toISOString()}"}\n\n`);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const sseManager = new SSEManager();
