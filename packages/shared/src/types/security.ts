import { z } from 'zod';

export const deviceCredentialScopeSchema = z.enum([
  'heartbeat',
  'claim',
  'report',
  'approval',
  'terminal',
]);

export type DeviceCredentialScope = z.infer<typeof deviceCredentialScopeSchema>;

export const deviceCredentialSchema = z.object({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  tokenPrefix: z.string().min(1),
  name: z.string().min(1).optional(),
  scopes: z.array(deviceCredentialScopeSchema),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
});

export type DeviceCredential = z.infer<typeof deviceCredentialSchema>;

export const createDeviceCredentialInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  scopes: z.array(deviceCredentialScopeSchema).min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export type CreateDeviceCredentialInput = z.infer<typeof createDeviceCredentialInputSchema>;

export interface DeviceCredentialWithToken {
  credential: DeviceCredential;
  token: string;
}

export const securityAuditSeveritySchema = z.enum([
  'info',
  'warn',
  'error',
  'critical',
]);

export type SecurityAuditSeverity = z.infer<typeof securityAuditSeveritySchema>;

export const securityAuditActorTypeSchema = z.enum([
  'user',
  'device',
  'remote_worker',
  'system',
]);

export type SecurityAuditActorType = z.infer<typeof securityAuditActorTypeSchema>;

export const securityAuditEventTypeSchema = z.enum([
  'auth.login_succeeded',
  'auth.login_failed',
  'device.registered',
  'device.registration_failed',
  'device.trusted',
  'device.untrusted',
  'device.credential_created',
  'device.credential_revoked',
  'remote.auth_failed',
  'remote.heartbeat',
  'remote.claim_rejected',
  'remote.work_root_changed',
  'remote.path_rejected',
  'remote.project_created',
  'remote.task_claimed',
  'remote.task_event_reported',
  'remote.task_completed',
  'remote.task_failed',
  'remote.worker_offline',
  'remote.worker_recovered',
  'remote.worker_loop_error',
  'remote.bridge_disconnected',
  'remote.bridge_reconnected',
  'project.created',
  'credential.use_failed',
  'remote.terminal_connected',
  'remote.terminal_session_started',
  'approval.requested',
  'approval.resolved',
  'permission.hit',
  'config.updated',
  'agent.native_terminal.launch',
  'agent.terminal_authorization_requested',
  'agent.terminal_authorization_denied',
  'agent.terminal_authorized',
  'agent.terminal_started',
  'agent.terminal_exited',
]);

export type SecurityAuditEventType = z.infer<typeof securityAuditEventTypeSchema>;

export const securityAuditEventSchema = z.object({
  id: z.string().min(1),
  eventType: securityAuditEventTypeSchema,
  severity: securityAuditSeveritySchema,
  actorType: securityAuditActorTypeSchema,
  actorId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  ipAddress: z.string().min(1).optional(),
  userAgent: z.string().min(1).optional(),
  message: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
});

export type SecurityAuditEvent = z.infer<typeof securityAuditEventSchema>;

export const securityAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().datetime().optional(),
  actorType: securityAuditActorTypeSchema.optional(),
  severity: securityAuditSeveritySchema.optional(),
  eventType: securityAuditEventTypeSchema.optional(),
});

export type SecurityAuditQuery = z.infer<typeof securityAuditQuerySchema>;
