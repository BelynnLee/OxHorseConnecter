import { z } from 'zod';

import { API_STREAM_CHANNELS } from '../constants.js';
import type { Approval } from './approval.js';
import type { Device } from './device.js';
import type { SessionStreamEvent } from './session.js';
import type { TaskEvent } from './task-event.js';

export const streamChannelSchema = z.enum([
  API_STREAM_CHANNELS.TASK_EVENT,
  API_STREAM_CHANNELS.SESSION_EVENT,
  API_STREAM_CHANNELS.APPROVAL_EVENT,
  API_STREAM_CHANNELS.DEVICE_EVENT,
]);

export type StreamChannel = z.infer<typeof streamChannelSchema>;

export interface StreamPayloadMap {
  'task.event': TaskEvent;
  'session.event': SessionStreamEvent;
  'approval.event': Approval;
  'device.event': Device;
}

export interface StreamEnvelope<TChannel extends StreamChannel = StreamChannel> {
  channel: TChannel;
  sentAt: string;
  payload: StreamPayloadMap[TChannel];
}

export const streamEnvelopeSchema = z.object({
  channel: streamChannelSchema,
  sentAt: z.string().datetime(),
  payload: z.record(z.unknown()),
});
