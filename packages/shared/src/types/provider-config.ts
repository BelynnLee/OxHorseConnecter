import { z } from 'zod';

export const providerConfigProviderSchema = z.enum(['codex', 'claude-code']);
export type ProviderConfigProvider = z.infer<typeof providerConfigProviderSchema>;

export const providerConfigScopeSchema = z.enum(['user', 'project', 'local']);
export type ProviderConfigScope = z.infer<typeof providerConfigScopeSchema>;

export const providerFileKindSchema = z.enum(['config', 'hooks']);
export type ProviderFileKind = z.infer<typeof providerFileKindSchema>;

export const providerFileFormatSchema = z.enum(['toml', 'json']);
export type ProviderFileFormat = z.infer<typeof providerFileFormatSchema>;

export const providerConfigFileSchema = z.object({
  provider: providerConfigProviderSchema,
  scope: providerConfigScopeSchema,
  kind: providerFileKindSchema,
  format: providerFileFormatSchema,
  path: z.string().min(1),
  exists: z.boolean(),
  content: z.string(),
  hash: z.string().min(1),
  updatedAt: z.string().datetime().optional(),
});

export type ProviderConfigFile = z.infer<typeof providerConfigFileSchema>;

export const providerConfigFileWriteSchema = z.object({
  provider: providerConfigProviderSchema,
  scope: providerConfigScopeSchema,
  kind: providerFileKindSchema,
  projectPath: z.string().min(1).optional(),
  content: z.string(),
  expectedHash: z.string().min(1),
  confirm: z.boolean(),
});

export type ProviderConfigFileWriteInput = z.infer<typeof providerConfigFileWriteSchema>;

export const providerNativeMutationSchema = z.object({
  sessionId: z.string().min(1),
  provider: providerConfigProviderSchema,
  command: z.string().min(1),
  args: z.string().default(''),
  confirm: z.boolean(),
});

export type ProviderNativeMutationInput = z.infer<typeof providerNativeMutationSchema>;
