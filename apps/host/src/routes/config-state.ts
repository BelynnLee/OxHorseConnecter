import { assertProductionHttpsUrl, assertSecureSecret } from '@rac/security';
import type { ConfigEntry, ConfigFileState, ConfigWarning } from '@rac/shared';
import { envPath } from '../services/env-path.js';
import type { ParsedEnvFile } from '../services/env-file.js';
import { CONFIG_FIELDS, type ConfigFieldDefinition } from './config-fields.js';

function normalizeBoolean(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return 'true';
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return 'false';
  }
  return null;
}

function normalizeCsv(value: string): string {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(',');
}

function urlProtocolLabel(protocols: readonly string[]): string {
  const normalized = protocols.map((protocol) => protocol.replace(/:$/, ''));
  if (normalized.length === 2 && normalized.includes('http') && normalized.includes('https')) {
    return 'http(s)';
  }
  if (normalized.length === 2 && normalized.includes('ws') && normalized.includes('wss')) {
    return 'ws(s)';
  }
  return normalized.join(', ');
}

function validateUrl(value: string, field: ConfigFieldDefinition): void {
  const protocols = field.urlProtocols ?? ['http:', 'https:'];
  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol as (typeof protocols)[number])) {
      throw new Error('URL uses an unsupported protocol.');
    }
  } catch {
    throw new Error(`${field.key} must be a valid ${urlProtocolLabel(protocols)} URL.`);
  }
}

export function normalizeValue(field: ConfigFieldDefinition, value: string | null): string | null {
  if (value === null) {
    if (field.required) {
      throw new Error(`${field.key} is required.`);
    }
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    if (field.required) {
      throw new Error(`${field.key} is required.`);
    }
    return null;
  }

  if (field.kind === 'boolean') {
    const normalized = normalizeBoolean(trimmed);
    if (!normalized) {
      throw new Error(`${field.key} must be true or false.`);
    }
    return normalized;
  }

  if (field.kind === 'number') {
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      throw new Error(`${field.key} must be an integer.`);
    }
    if (field.min !== undefined && parsed < field.min) {
      throw new Error(`${field.key} must be at least ${field.min}.`);
    }
    if (field.max !== undefined && parsed > field.max) {
      throw new Error(`${field.key} must be at most ${field.max}.`);
    }
    return String(parsed);
  }

  if (field.kind === 'csv') {
    const normalized = normalizeCsv(trimmed);
    if (field.required && !normalized) {
      throw new Error(`${field.key} is required.`);
    }
    return normalized || null;
  }

  if (field.kind === 'select') {
    const normalized = trimmed.toLowerCase();
    if (!field.options?.some((option) => option.value === normalized)) {
      throw new Error(`${field.key} has an unsupported value.`);
    }
    return normalized;
  }

  if (field.kind === 'url') {
    validateUrl(trimmed, field);
    return trimmed;
  }

  if (field.kind === 'json') {
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      throw new Error(`${field.key} must be valid JSON.`);
    }
  }

  if (field.kind === 'secret' && field.min !== undefined && trimmed.length < field.min) {
    throw new Error(`${field.key} must be at least ${field.min} characters.`);
  }

  return trimmed;
}

function buildWarnings(parsed: Record<string, string>): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];
  if (!parsed.JWT_SECRET && !process.env.JWT_SECRET) {
    warnings.push({
      code: 'jwt_secret_missing',
      message:
        'JWT_SECRET is not configured. Browser sessions will be invalidated whenever the host restarts.',
    });
  }
  if (!parsed.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD) {
    warnings.push({
      code: 'admin_password_missing',
      message:
        'ADMIN_PASSWORD is not configured. After a successful admin login, the host will persist the password used for that login.',
    });
  }
  if (!parsed.PROVIDER_SECRET_KEY && !process.env.PROVIDER_SECRET_KEY) {
    warnings.push({
      code: 'provider_secret_key_missing',
      message:
        'PROVIDER_SECRET_KEY is not configured. Encrypted provider keys stored in the database may become unrecoverable if the host secret changes across restarts.',
    });
  }
  const strictRemoteRegistration =
    process.env.NODE_ENV === 'production' ||
    normalizeBoolean(parsed.REQUIRE_HTTPS ?? process.env.REQUIRE_HTTPS ?? '') === 'true' ||
    (parsed.AGENT_SECURITY_PROFILE ?? process.env.AGENT_SECURITY_PROFILE ?? '')
      .trim()
      .toLowerCase() === 'strict';
  if (
    strictRemoteRegistration &&
    !parsed.REMOTE_REGISTRATION_TOKEN &&
    !process.env.REMOTE_REGISTRATION_TOKEN
  ) {
    warnings.push({
      code: 'remote_registration_token_missing',
      message:
        'REMOTE_REGISTRATION_TOKEN is required before remote workers can register in strict deployments.',
    });
  }
  if (strictRemoteRegistration && !parsed.ALLOWED_WORK_DIR && !process.env.ALLOWED_WORK_DIR) {
    warnings.push({
      code: 'allowed_work_dir_missing',
      message:
        'ALLOWED_WORK_DIR is required in strict deployments so browser, Host, and worker paths stay inside a controlled workspace.',
    });
  }
  if (
    strictRemoteRegistration &&
    normalizeBoolean(parsed.ALLOW_QUERY_TOKEN_AUTH ?? process.env.ALLOW_QUERY_TOKEN_AUTH ?? '') ===
      'true'
  ) {
    warnings.push({
      code: 'query_token_auth_forbidden',
      message: 'ALLOW_QUERY_TOKEN_AUTH must remain false in strict deployments.',
    });
  }
  if (
    (parsed.PUBLIC_BASE_URL ?? '').startsWith('http://') &&
    normalizeBoolean(parsed.AUTH_COOKIE_SECURE ?? '') === 'true'
  ) {
    warnings.push({
      code: 'secure_cookie_on_http',
      message:
        'AUTH_COOKIE_SECURE is true while PUBLIC_BASE_URL uses http. Local browsers may not send the login cookie.',
    });
  }
  return warnings;
}

function readResolvedValue(parsed: Record<string, string>, key: string): string | undefined {
  return parsed[key] ?? process.env[key];
}

function readResolvedBoolean(
  parsed: Record<string, string>,
  key: string,
  fallback: boolean
): boolean {
  const value = readResolvedValue(parsed, key);
  if (value == null) return fallback;
  return normalizeBoolean(value) === 'true';
}

export function validateEffectiveConfig(parsed: Record<string, string>): void {
  const nodeEnv = process.env.NODE_ENV;
  const requireHttpsRaw = readResolvedValue(parsed, 'REQUIRE_HTTPS');
  const requireHttps =
    requireHttpsRaw !== undefined
      ? normalizeBoolean(requireHttpsRaw) === 'true'
      : nodeEnv === 'production';
  const strictSecurity = nodeEnv === 'production' || requireHttps;

  const agentSecurityProfile = (
    readResolvedValue(parsed, 'AGENT_SECURITY_PROFILE') || (strictSecurity ? 'strict' : 'local')
  )
    .trim()
    .toLowerCase();

  if (agentSecurityProfile !== 'local' && agentSecurityProfile !== 'strict') {
    throw new Error('AGENT_SECURITY_PROFILE must be either "local" or "strict".');
  }

  if (strictSecurity) {
    const publicBaseUrl = readResolvedValue(parsed, 'PUBLIC_BASE_URL');
    if (!publicBaseUrl?.trim()) {
      throw new Error('PUBLIC_BASE_URL is required for strict deployments.');
    }
    assertProductionHttpsUrl(publicBaseUrl, 'PUBLIC_BASE_URL');
    assertSecureSecret(readResolvedValue(parsed, 'JWT_SECRET'), {
      name: 'JWT_SECRET',
      minLength: 32,
    });
    assertSecureSecret(readResolvedValue(parsed, 'ADMIN_PASSWORD'), {
      name: 'ADMIN_PASSWORD',
      minLength: 12,
      forbiddenValues: [readResolvedValue(parsed, 'ADMIN_USERNAME') || 'admin'],
    });
  }

  if (strictSecurity || agentSecurityProfile === 'strict') {
    const allowedWorkDir = readResolvedValue(parsed, 'ALLOWED_WORK_DIR');
    if (!allowedWorkDir?.trim()) {
      throw new Error('ALLOWED_WORK_DIR is required for strict deployments.');
    }
    if (readResolvedBoolean(parsed, 'ALLOW_QUERY_TOKEN_AUTH', false)) {
      throw new Error('ALLOW_QUERY_TOKEN_AUTH cannot be enabled in strict deployments.');
    }
    const hostname = readResolvedValue(parsed, 'HOST_HOSTNAME') || '127.0.0.1';
    if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
      throw new Error('HOST_HOSTNAME must stay on loopback in strict deployments.');
    }
    assertSecureSecret(readResolvedValue(parsed, 'REMOTE_REGISTRATION_TOKEN'), {
      name: 'REMOTE_REGISTRATION_TOKEN',
      minLength: 32,
    });
    assertSecureSecret(readResolvedValue(parsed, 'PROVIDER_SECRET_KEY'), {
      name: 'PROVIDER_SECRET_KEY',
      minLength: 32,
    });
  }

  if (agentSecurityProfile === 'strict') {
    if (readResolvedBoolean(parsed, 'CODEX_FULL_AUTO', false)) {
      throw new Error('CODEX_FULL_AUTO cannot be enabled when AGENT_SECURITY_PROFILE=strict.');
    }
    if (readResolvedBoolean(parsed, 'CLAUDE_CODE_SKIP_PERMISSIONS', false)) {
      throw new Error(
        'CLAUDE_CODE_SKIP_PERMISSIONS cannot be enabled when AGENT_SECURITY_PROFILE=strict.'
      );
    }
  }
}

export function buildState(envFile: ParsedEnvFile): ConfigFileState {
  const entries = CONFIG_FIELDS.map((field): ConfigEntry => {
    const fileValue = envFile.parsed[field.key];
    const environmentValue = process.env[field.key];
    const value = fileValue ?? environmentValue ?? field.defaultValue ?? '';
    const source =
      fileValue !== undefined ? 'file' : environmentValue !== undefined ? 'environment' : 'default';

    return {
      ...field,
      value: field.secret ? undefined : value,
      configured: field.secret ? Boolean(fileValue || environmentValue) : Boolean(value),
      source,
    };
  });

  return {
    path: envPath,
    exists: envFile.exists,
    restartRequired: true,
    entries,
    warnings: buildWarnings(envFile.parsed),
  };
}
