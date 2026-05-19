import { z } from 'zod';
import { executorTypeSchema } from './task.js';

export const taskTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  executorType: executorTypeSchema,
  prompt: z.string().min(1),
  workDir: z.string().min(1).optional(),
  autoApprove: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TaskTemplate = z.infer<typeof taskTemplateSchema>;

export const createTaskTemplateInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().trim().optional(),
  executorType: executorTypeSchema,
  prompt: z.string().min(1),
  workDir: z.string().trim().optional(),
  autoApprove: z.boolean().optional(),
});

export type CreateTaskTemplateInput = z.infer<typeof createTaskTemplateInputSchema>;

export const updateTaskTemplateInputSchema = createTaskTemplateInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be provided.' },
);

export type UpdateTaskTemplateInput = z.infer<typeof updateTaskTemplateInputSchema>;

export const runTaskTemplateInputSchema = z.object({
  deviceId: z.string().min(1),
});

export type RunTaskTemplateInput = z.infer<typeof runTaskTemplateInputSchema>;
