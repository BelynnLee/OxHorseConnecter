import { z } from 'zod';

export const agentRuntimeOptionsSchema = z
  .object({
    extraDirs: z.array(z.string().trim().min(1).max(500)).max(8).optional(),
    webSearch: z.boolean().optional(),
    serviceTier: z.enum(['fast']).optional(),
    claudeAgent: z.string().trim().min(1).max(120).optional(),
    claudeFallbackModel: z.string().trim().min(1).max(120).optional(),
    claudeMaxBudgetUsd: z.number().finite().positive().max(1000).optional(),
    claudeAppendSystemPrompt: z.string().trim().min(1).max(4000).optional(),
  })
  .partial();

export type AgentRuntimeOptions = z.infer<typeof agentRuntimeOptionsSchema>;
