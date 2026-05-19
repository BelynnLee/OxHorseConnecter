import { z } from 'zod';

export const configValueKindSchema = z.enum([
  'string',
  'number',
  'boolean',
  'csv',
  'secret',
  'select',
  'url',
  'directory',
  'file',
  'json',
]);

export type ConfigValueKind = z.infer<typeof configValueKindSchema>;

export const configGroupSchema = z.enum([
  'host',
  'auth',
  'task',
  'executors',
  'providers',
  'notifications',
  'security',
  'remote',
  'logging',
  'runtime',
  'web',
]);

export type ConfigGroup = z.infer<typeof configGroupSchema>;

export const configSourceSchema = z.enum(['file', 'environment', 'default']);

export type ConfigSource = z.infer<typeof configSourceSchema>;

export const configWarningCodeSchema = z.enum([
  'jwt_secret_missing',
  'admin_password_missing',
  'provider_secret_key_missing',
  'remote_registration_token_missing',
  'allowed_work_dir_missing',
  'query_token_auth_forbidden',
  'secure_cookie_on_http',
]);

export type ConfigWarningCode = z.infer<typeof configWarningCodeSchema>;

export interface ConfigWarning {
  code: ConfigWarningCode;
  message: string;
}

export interface ConfigFieldOption {
  value: string;
  label: string;
}

export interface ConfigEntry {
  key: string;
  label: string;
  description: string;
  group: ConfigGroup;
  kind: ConfigValueKind;
  required: boolean;
  secret: boolean;
  restartRequired: boolean;
  placeholder?: string;
  options?: ConfigFieldOption[];
  advanced?: boolean;
  readOnly?: boolean;
  restartTarget?: 'host' | 'web' | 'worker';
  value?: string;
  configured: boolean;
  source: ConfigSource;
}

export interface ConfigFileState {
  path: string;
  exists: boolean;
  restartRequired: boolean;
  entries: ConfigEntry[];
  warnings: ConfigWarning[];
}

export interface ConfigRestartResult {
  restarting: true;
  mode: 'self-relaunch';
  pid: number;
  startedAt: string;
}

export const updateConfigEntrySchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  value: z.string().max(4096).nullable(),
});

export const updateConfigInputSchema = z.object({
  updates: z.array(updateConfigEntrySchema).min(1).max(80),
});

export type UpdateConfigEntry = z.infer<typeof updateConfigEntrySchema>;
export type UpdateConfigInput = z.infer<typeof updateConfigInputSchema>;
