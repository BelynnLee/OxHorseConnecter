import dotenv from 'dotenv';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { ExecutorRegistryConfig } from '@rac/executors';
import type { SecretPolicy } from '@rac/security';
import { assertProductionHttpsUrl, assertSecureSecret } from '@rac/security';
import { envPath, workspaceRoot } from './services/env-path.js';

dotenv.config({ path: envPath });

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value == null) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseCsv(value: string | undefined, fallback: string[] = []): string[] {
  const parsed = value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return parsed && parsed.length > 0 ? parsed : fallback;
}

function parseChoice<T extends string>(
  value: string | undefined,
  choices: readonly T[],
  fallback: T,
): T {
  const normalized = value?.trim().toLowerCase() as T | undefined;
  return normalized && choices.includes(normalized) ? normalized : fallback;
}

function parseSameSite(value: string | undefined): 'lax' | 'strict' | 'none' {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'none') {
    return normalized;
  }
  return 'lax';
}

const hostPort = parseInteger(process.env.HOST_PORT, 3001);
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${hostPort}`;
const hostHostname = process.env.HOST_HOSTNAME || '127.0.0.1';
const requireHttps = parseBoolean(
  process.env.REQUIRE_HTTPS,
  process.env.NODE_ENV === 'production',
);
const logRedactionEnabled = parseBoolean(process.env.LOG_REDACTION_ENABLED, true);
const strictSecurity = process.env.NODE_ENV === 'production' || requireHttps;
const agentSecurityProfile = (
  process.env.AGENT_SECURITY_PROFILE?.trim().toLowerCase() ||
  (strictSecurity ? 'strict' : 'local')
) as 'local' | 'strict';
const strictDeployment = strictSecurity || agentSecurityProfile === 'strict';
const allowedWorkDir = process.env.ALLOWED_WORK_DIR?.trim()
  ? path.resolve(process.env.ALLOWED_WORK_DIR)
  : null;
const remoteAllowedWorkDir = process.env.RAC_REMOTE_ALLOWED_WORK_DIR?.trim()
  ? path.resolve(process.env.RAC_REMOTE_ALLOWED_WORK_DIR)
  : null;
const remoteWorkerHeartbeatIntervalMs = parseInteger(
  process.env.RAC_REMOTE_HEARTBEAT_INTERVAL_MS ?? process.env.RAC_REMOTE_POLL_INTERVAL_MS,
  3000,
);
const remoteWorkerOfflineTimeoutMs = Math.max(remoteWorkerHeartbeatIntervalMs * 3, 30_000);
const remoteWorkerMaxReconnectDelayMs = parseInteger(
  process.env.RAC_REMOTE_MAX_RECONNECT_DELAY_MS,
  30_000,
);
const remoteWorkerBridgePingIntervalMs = parseInteger(
  process.env.RAC_REMOTE_BRIDGE_PING_INTERVAL_MS,
  15_000,
);
const allowQueryTokenAuth = parseBoolean(process.env.ALLOW_QUERY_TOKEN_AUTH, false);
const remoteWorkerRuntime = process.argv.some((arg) => {
  const name = path.basename(arg).toLowerCase();
  return ['remote-worker.ts', 'remote-worker.js', 'remote-worker.mjs', 'remote-worker.cjs'].includes(name);
});

if (agentSecurityProfile !== 'local' && agentSecurityProfile !== 'strict') {
  throw new Error('AGENT_SECURITY_PROFILE must be either "local" or "strict".');
}

if (strictSecurity) {
  assertProductionHttpsUrl(publicBaseUrl, 'PUBLIC_BASE_URL');
}

if (strictDeployment && !allowedWorkDir && !remoteWorkerRuntime) {
  throw new Error('ALLOWED_WORK_DIR is required when NODE_ENV=production, REQUIRE_HTTPS=true, or AGENT_SECURITY_PROFILE=strict.');
}

if (strictDeployment && remoteWorkerRuntime && !allowedWorkDir && !remoteAllowedWorkDir) {
  throw new Error('RAC_REMOTE_ALLOWED_WORK_DIR or ALLOWED_WORK_DIR is required for a strict remote worker.');
}

if (strictDeployment && allowedWorkDir && !existsSync(allowedWorkDir)) {
  throw new Error(`ALLOWED_WORK_DIR does not exist: ${allowedWorkDir}`);
}

if (strictDeployment && allowQueryTokenAuth) {
  throw new Error('ALLOW_QUERY_TOKEN_AUTH cannot be enabled in strict or production deployments.');
}

if (strictDeployment && !['127.0.0.1', 'localhost', '::1'].includes(hostHostname)) {
  throw new Error('HOST_HOSTNAME must stay on loopback in strict deployments; expose the Host through a TLS reverse proxy.');
}

function generateDevelopmentSecret(policy: SecretPolicy): string {
  const token = randomBytes(24).toString('base64url');
  return `dev-${policy.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${token}`;
}

export interface StartupNotice {
  level: 'warn' | 'info';
  message: string;
  detail?: string;
}

const startupNotices: StartupNotice[] = [];

function resolveSecret(
  value: string | undefined,
  policy: SecretPolicy,
  options?: { printGeneratedValue?: boolean },
): string {
  if (value?.trim() || strictSecurity) {
    return assertSecureSecret(value, policy);
  }

  const generated = generateDevelopmentSecret(policy);
  startupNotices.push({
    level: 'warn',
    message: `${policy.name} not set — using ephemeral dev value`,
    detail: `Set ${policy.name} in .env for stable sessions${options?.printGeneratedValue ? ` (current: ${generated})` : ''}`,
  });
  return generated;
}

const jwtSecretInput = process.env.JWT_SECRET;
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPasswordInput = process.env.ADMIN_PASSWORD;
const providerSecretKeyInput = process.env.PROVIDER_SECRET_KEY;
// TEMP local-dev relaxation: allow very short admin passwords while iterating locally.
// Restore this to a fixed 12+ character policy before production release.
const adminPasswordMinLength = strictSecurity ? 12 : 1;
const remoteRegistrationTokenInput = process.env.REMOTE_REGISTRATION_TOKEN;

const deviceName = process.env.HOST_DEVICE_NAME || os.hostname();
const devicePlatform = process.env.HOST_DEVICE_PLATFORM || process.platform;
const deviceFingerprint =
  process.env.HOST_DEVICE_FINGERPRINT ||
  `${deviceName}:${devicePlatform}:${os.hostname()}`;

function resolveRemoteRegistrationToken(): string | undefined {
  if (remoteRegistrationTokenInput?.trim() || strictSecurity || agentSecurityProfile === 'strict') {
    return assertSecureSecret(remoteRegistrationTokenInput, {
      name: 'REMOTE_REGISTRATION_TOKEN',
      minLength: 32,
    });
  }

  return undefined;
}

function resolveProviderSecretKey(): string {
  const policy: SecretPolicy = {
    name: 'PROVIDER_SECRET_KEY',
    minLength: 32,
  };
  if (providerSecretKeyInput?.trim() || strictSecurity || agentSecurityProfile === 'strict') {
    return assertSecureSecret(providerSecretKeyInput, policy);
  }
  return resolveSecret(providerSecretKeyInput, policy);
}

const codexFullAuto = parseBoolean(
  process.env.CODEX_FULL_AUTO,
  agentSecurityProfile === 'strict' ? false : true,
);
const claudeCodeSkipPermissions = parseBoolean(process.env.CLAUDE_CODE_SKIP_PERMISSIONS, false);
const customCommandAgentCommand =
  process.env.CUSTOM_COMMAND_AGENT_COMMAND ||
  process.env.CUSTOM_AGENT_COMMAND ||
  undefined;
const customCommandAgentEnabled = parseBoolean(
  process.env.CUSTOM_COMMAND_AGENT_ENABLED,
  Boolean(customCommandAgentCommand),
);
const strictClaudeCodeDisallowedTools = [
  'Bash(rm:*)',
  'Bash(del:*)',
  'Bash(erase:*)',
  'Bash(rmdir:*)',
  'Bash(rd:*)',
  'Bash(Remove-Item:*)',
  'Bash(git reset:*)',
  'Bash(git clean:*)',
  'Bash(git checkout:*)',
  'Bash(curl:*)',
  'Bash(wget:*)',
];

if (agentSecurityProfile === 'strict' && codexFullAuto) {
  throw new Error('CODEX_FULL_AUTO cannot be enabled when AGENT_SECURITY_PROFILE=strict.');
}

if (agentSecurityProfile === 'strict' && claudeCodeSkipPermissions) {
  throw new Error('CLAUDE_CODE_SKIP_PERMISSIONS cannot be enabled when AGENT_SECURITY_PROFILE=strict.');
}

const executorRegistry: ExecutorRegistryConfig = {
  claudeApiKey: process.env.CLAUDE_API_KEY || undefined,
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
  claudeMaxTokens: parseInteger(process.env.CLAUDE_MAX_TOKENS, 8192),
  claudeMaxToolRounds: parseInteger(process.env.CLAUDE_MAX_TOOL_ROUNDS, 30),
  codexEnabled: process.env.CODEX_ENABLED !== undefined
    ? parseBoolean(process.env.CODEX_ENABLED) || parseBoolean(process.env.CODEX_FULL_AUTO)
    : undefined, // undefined = auto-detect
  codexOptions: {
    command: process.env.CODEX_COMMAND || 'codex',
    model: process.env.CODEX_MODEL || undefined,
    fullAuto: codexFullAuto,
    apiKey: process.env.OPENAI_API_KEY || undefined,
  },
  claudeCodeEnabled: process.env.CLAUDE_CODE_ENABLED !== undefined
    ? parseBoolean(process.env.CLAUDE_CODE_ENABLED)
    : undefined, // undefined = auto-detect
  claudeCodeOptions: {
    command: process.env.CLAUDE_CODE_COMMAND || 'claude',
    dangerouslySkipPermissions: claudeCodeSkipPermissions,
    disallowedTools: agentSecurityProfile === 'strict' ? strictClaudeCodeDisallowedTools : undefined,
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || undefined,
    model: process.env.CLAUDE_CODE_MODEL || undefined,
    maxTurns: process.env.CLAUDE_CODE_MAX_TURNS
      ? parseInteger(process.env.CLAUDE_CODE_MAX_TURNS, 30)
      : undefined,
  },
  customCommandEnabled: customCommandAgentEnabled && Boolean(customCommandAgentCommand),
  customCommandOptions: customCommandAgentCommand
    ? {
        command: customCommandAgentCommand,
        defaultArgs: parseCsv(process.env.CUSTOM_COMMAND_AGENT_ARGS),
        timeoutMs: process.env.CUSTOM_COMMAND_AGENT_TIMEOUT_SECONDS
          ? parseInteger(process.env.CUSTOM_COMMAND_AGENT_TIMEOUT_SECONDS, 1200) * 1000
          : undefined,
      }
    : undefined,
};

export const config = {
  port: hostPort,
  hostname: hostHostname,
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  corsOrigins: parseCsv(process.env.CORS_ORIGINS, [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]),
  jwtSecret: resolveSecret(jwtSecretInput, {
    name: 'JWT_SECRET',
    minLength: 32,
  }),
  jwtSecretGenerated: !jwtSecretInput?.trim() && !strictSecurity,
  authCookieName: process.env.AUTH_COOKIE_NAME || 'rac_access_token',
  authCookieSecure: parseBoolean(
    process.env.AUTH_COOKIE_SECURE,
    publicBaseUrl.startsWith('https://'),
  ),
  authCookieSameSite: parseSameSite(process.env.AUTH_COOKIE_SAME_SITE),
  allowQueryTokenAuth,
  requireHttps,
  logRedactionEnabled,
  loginRateLimit: {
    maxAttempts: parseInteger(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 5),
    windowMs: parseInteger(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS, 60) * 1000,
    lockoutMs: parseInteger(process.env.LOGIN_RATE_LIMIT_LOCKOUT_SECONDS, 300) * 1000,
    exemptLoopback: parseBoolean(process.env.LOGIN_RATE_LIMIT_EXEMPT_LOOPBACK, true),
  },
  dbPath: process.env.DB_PATH || path.join(workspaceRoot, 'data', 'rac.db'),
  allowedWorkDir,
  approvalTimeoutSeconds: parseInteger(process.env.APPROVAL_TIMEOUT_SECONDS, 120),
  accessTokenTtlSeconds: parseInteger(process.env.ACCESS_TOKEN_TTL_SECONDS, 43200),
  taskMaxDurationSeconds: parseInteger(process.env.TASK_MAX_DURATION_SECONDS, 1800),
  strictSecurity,
  agentSecurityProfile,
  remoteRegistrationToken: resolveRemoteRegistrationToken(),
  remoteWorker: {
    heartbeatIntervalMs: remoteWorkerHeartbeatIntervalMs,
    offlineTimeoutMs: remoteWorkerOfflineTimeoutMs,
    maxReconnectDelayMs: remoteWorkerMaxReconnectDelayMs,
    bridgePingIntervalMs: remoteWorkerBridgePingIntervalMs,
  },
  adminUsername,
  adminPassword: resolveSecret(
    adminPasswordInput,
    {
      name: 'ADMIN_PASSWORD',
      minLength: adminPasswordMinLength,
      forbiddenValues: [adminUsername],
    },
    { printGeneratedValue: true },
  ),
  adminPasswordGenerated: !adminPasswordInput?.trim() && !strictSecurity,
  hostDeviceName: deviceName,
  hostDevicePlatform: devicePlatform,
  hostDeviceFingerprint: deviceFingerprint,
  hostVersion: process.env.npm_package_version || '0.1.0',
  riskRulesPath: process.env.RISK_RULES_PATH || undefined,
  agentModelPricingJson: process.env.AGENT_MODEL_PRICING_JSON || undefined,
  publicBaseUrl,
  giteaBaseUrl: process.env.GITEA_BASE_URL || undefined,
  giteaToken: process.env.GITEA_TOKEN || undefined,
  webhookUrl: process.env.WEBHOOK_URL || undefined,
  webhookSecret: process.env.WEBHOOK_SECRET || undefined,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
  telegramChatId: process.env.TELEGRAM_CHAT_ID || undefined,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
  telegramGateway: {
    enabled: parseBoolean(process.env.TELEGRAM_GATEWAY_ENABLED, false),
    mode: parseChoice(process.env.TELEGRAM_MODE, ['auto', 'polling', 'webhook'] as const, 'auto'),
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || undefined,
    allowAllUsers: parseBoolean(process.env.TELEGRAM_ALLOW_ALL_USERS, false),
    allowedUsers: parseCsv(process.env.TELEGRAM_ALLOWED_USERS),
    allowedGroupChats: parseCsv(process.env.TELEGRAM_GROUP_ALLOWED_CHATS),
    requireMention: parseBoolean(process.env.TELEGRAM_REQUIRE_MENTION, true),
    defaultDeviceId: process.env.TELEGRAM_DEFAULT_DEVICE_ID || 'host',
    defaultProjectId: process.env.TELEGRAM_DEFAULT_PROJECT_ID || undefined,
    defaultProjectPath: process.env.TELEGRAM_DEFAULT_PROJECT_PATH || undefined,
    defaultExecutor: parseChoice(
      process.env.TELEGRAM_DEFAULT_EXECUTOR,
      ['codex', 'claude-code', 'mock', 'custom-command'] as const,
      'codex',
    ),
    defaultMode: parseChoice(
      process.env.TELEGRAM_DEFAULT_MODE,
      ['agent', 'plan', 'review'] as const,
      'agent',
    ),
    defaultPermissionMode: parseChoice(
      process.env.TELEGRAM_DEFAULT_PERMISSION_MODE,
      ['read-only', 'default', 'auto-review', 'full-access'] as const,
      'default',
    ),
    streamingEnabled: parseBoolean(process.env.TELEGRAM_STREAMING_ENABLED, false),
    streamEditIntervalMs: parseInteger(process.env.TELEGRAM_STREAM_EDIT_INTERVAL_MS, 700),
    cacheDir: process.env.TELEGRAM_CACHE_DIR || path.join(workspaceRoot, 'data', 'telegram-cache'),
    mediaMaxBytes: parseInteger(process.env.TELEGRAM_MEDIA_MAX_BYTES, 20 * 1024 * 1024),
  },
  webPushPublicKey: process.env.VAPID_PUBLIC_KEY || undefined,
  webPushPrivateKey: process.env.VAPID_PRIVATE_KEY || undefined,
  executorRegistry,
  providerSecretKey: resolveProviderSecretKey(),
  providerSecretKeyGenerated: !providerSecretKeyInput?.trim() && !strictSecurity && agentSecurityProfile !== 'strict',
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8010',
  logFilePath: process.env.LOG_FILE_PATH || undefined,
  logFileKeepDays: parseInteger(process.env.LOG_FILE_KEEP_DAYS, 30),
  startupNotices,
};
