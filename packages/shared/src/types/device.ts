import { z } from 'zod';

import { DEVICE_STATUSES } from '../constants.js';
import { executorTypeSchema } from './task.js';

export const deviceStatusSchema = z.enum([
  DEVICE_STATUSES.ONLINE,
  DEVICE_STATUSES.OFFLINE,
]);

export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export const deviceBridgeStatusSchema = z.enum(['connected', 'disconnected']);

export type DeviceBridgeStatus = z.infer<typeof deviceBridgeStatusSchema>;

export const executorInfoSchema = z.object({
  type: executorTypeSchema,
  available: z.boolean(),
  version: z.string().optional(),
  path: z.string().optional(),
});

export type ExecutorInfo = z.infer<typeof executorInfoSchema>;

export const deviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: deviceStatusSchema,
  platform: z.string().min(1),
  lastSeenAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  fingerprint: z.string().min(1),
  trusted: z.boolean(),
  hostVersion: z.string().min(1).optional(),
  executors: z.array(executorInfoSchema).optional(),
  workRoot: z.string().min(1).optional(),
  workRootExists: z.boolean().optional(),
  lastHeartbeatAt: z.string().datetime().optional(),
  lastBridgeConnectedAt: z.string().datetime().optional(),
  lastBridgeDisconnectedAt: z.string().datetime().optional(),
  bridgeStatus: deviceBridgeStatusSchema.optional(),
  lastDisconnectReason: z.string().min(1).optional(),
  workerReconnectCount: z.number().int().nonnegative().optional(),
});

export type Device = z.infer<typeof deviceSchema>;

export const registerDeviceInputSchema = z.object({
  name: z.string().min(1),
  platform: z.string().min(1),
  fingerprint: z.string().min(1),
  hostVersion: z.string().min(1).optional(),
  executors: z.array(executorInfoSchema).optional(),
  workRoot: z.string().min(1).optional(),
  workRootExists: z.boolean().optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceInputSchema>;

export const updateDeviceTrustInputSchema = z.object({
  trusted: z.boolean(),
});

export type UpdateDeviceTrustInput = z.infer<typeof updateDeviceTrustInputSchema>;
