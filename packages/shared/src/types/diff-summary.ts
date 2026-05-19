import { z } from 'zod';

export const diffFileStatusSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
]);

export type DiffFileStatus = z.infer<typeof diffFileStatusSchema>;

export const diffFileChangeSchema = z.object({
  path: z.string().min(1),
  status: diffFileStatusSchema,
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export type DiffFileChange = z.infer<typeof diffFileChangeSchema>;

export const diffSummarySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  filesChanged: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patchText: z.string(),
  createdAt: z.string().datetime(),
  files: z.array(diffFileChangeSchema).optional(),
});

export type DiffSummary = z.infer<typeof diffSummarySchema>;
