import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof userSchema>;

export const loginInputSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

export const loginResultSchema = z.object({
  token: z.string().min(1),
  user: userSchema,
});

export type LoginResult = z.infer<typeof loginResultSchema>;

export const authPayloadSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1),
});

export type AuthPayload = z.infer<typeof authPayloadSchema>;
