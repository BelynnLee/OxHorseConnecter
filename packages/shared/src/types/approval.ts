import { z } from 'zod';

import { APPROVAL_STATUSES, RISK_LEVELS } from '../constants.js';

export const approvalStatusSchema = z.enum([
  APPROVAL_STATUSES.PENDING,
  APPROVAL_STATUSES.APPROVED,
  APPROVAL_STATUSES.REJECTED,
  APPROVAL_STATUSES.EXPIRED,
]);

export const riskLevelSchema = z.enum([
  RISK_LEVELS.LOW,
  RISK_LEVELS.MEDIUM,
  RISK_LEVELS.HIGH,
  RISK_LEVELS.CRITICAL,
]);

export const approvalDecisionSchema = z.enum(['approve', 'reject']);

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const approvalSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  actionType: z.string().min(1),
  riskLevel: riskLevelSchema,
  reason: z.string().min(1),
  status: approvalStatusSchema,
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolvedBy: z.string().min(1).optional(),
  timeoutAt: z.string().datetime().optional(),
  commandPreview: z.string().optional(),
  targetPaths: z.array(z.string().min(1)).optional(),
});

export type Approval = z.infer<typeof approvalSchema>;

export const resolveApprovalInputSchema = z.object({
  decision: approvalDecisionSchema,
  resolvedBy: z.string().min(1),
  comment: z.string().max(500).optional(),
});

export type ResolveApprovalInput = z.infer<typeof resolveApprovalInputSchema>;
