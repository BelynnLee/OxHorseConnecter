import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ModelProfile, ReasoningEffort } from '@rac/shared';
import { findClaudeCli, findCodexCli, type ExecutorRegistryConfig } from '@rac/executors';
import {
  claudeCodeProfileFromModelId,
  codexReasoningEffortsForModel,
  isAnthropicModelOrAlias,
  isCodexDefaultModel,
  modelProfile,
  normalizeModelDisplayName,
  openAiCapabilities,
  withCapability,
} from './model-registry-profiles.js';

const CLI_TIMEOUT_MS = 5000;
const CLI_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

interface CliRunResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function textFromKeys(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function numberFromKeys(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value.trim())
          : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

function parseJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    }
    throw new Error('CLI output was not valid JSON.');
  }
}

function runCliCommand(
  command: string,
  args: string[],
  options: { cwd?: string | null; env?: NodeJS.ProcessEnv } = {}
): CliRunResult | undefined {
  const shell =
    process.platform === 'win32' && (!path.isAbsolute(command) || /\.(cmd|bat)$/i.test(command));
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? undefined,
    env: options.env,
    encoding: 'utf8',
    shell,
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: CLI_MAX_BUFFER_BYTES,
    windowsHide: true,
  });

  if (result.error) {
    return undefined;
  }

  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? ''),
    stderr: typeof result.stderr === 'string' ? result.stderr : String(result.stderr ?? ''),
    status: result.status,
  };
}

function modelValuesFromJson(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [];
  }
  const models = value.models ?? value.data;
  if (Array.isArray(models)) {
    return models;
  }
  if (isRecord(models)) {
    return Object.entries(models).map(([id, model]) =>
      isRecord(model) ? { id, ...model } : { id, model }
    );
  }
  return [];
}

function modelHidden(record: Record<string, unknown>): boolean {
  return record.enabled === false || record.visibility === 'hidden';
}

function reasoningEffortsFromUnknown(value: unknown): ReasoningEffort[] {
  const allowed = new Set<ReasoningEffort>(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  const result: ReasoningEffort[] = [];
  const visit = (entry: unknown) => {
    const effort =
      typeof entry === 'string'
        ? entry
        : isRecord(entry)
          ? textFromKeys(entry, ['effort', 'reasoningEffort', 'level', 'value', 'name', 'id'])
          : undefined;
    if (
      effort &&
      allowed.has(effort as ReasoningEffort) &&
      !result.includes(effort as ReasoningEffort)
    ) {
      result.push(effort as ReasoningEffort);
    }
  };
  if (Array.isArray(value)) {
    value.forEach(visit);
  }
  return result;
}

function codexCliModelToProfile(
  value: unknown,
  configuredDefault?: string
): ModelProfile | undefined {
  if (!isRecord(value) || modelHidden(value)) {
    return undefined;
  }
  const id = textFromKeys(value, ['slug', 'id', 'value', 'model', 'name']);
  if (!id) {
    return undefined;
  }

  const supportedReasoningLevels = Array.isArray(value.supportedReasoningEfforts)
    ? value.supportedReasoningEfforts
    : Array.isArray(value.supportedEffortLevels)
      ? value.supportedEffortLevels
      : Array.isArray(value.supported_reasoning_levels)
        ? value.supported_reasoning_levels
        : Array.isArray(value.supportedReasoningLevels)
          ? value.supportedReasoningLevels
          : [];
  const supportedReasoningEfforts = reasoningEffortsFromUnknown(supportedReasoningLevels).filter(
    (effort) => effort !== 'max'
  );
  const supportsReasoningEffort =
    supportedReasoningEfforts.length > 0 ||
    value.supportsEffort === true ||
    value.supportsReasoningEffort === true ||
    value.supports_reasoning_effort === true ||
    openAiCapabilities(id).includes('reasoning_effort');
  const capabilities = withCapability(
    openAiCapabilities(id),
    'reasoning_effort',
    supportsReasoningEffort
  );

  return modelProfile({
    id,
    provider: /^oss:|^local:/i.test(id) ? 'local' : 'openai',
    modelId: id,
    displayName: normalizeModelDisplayName(
      textFromKeys(value, ['display_name', 'displayName', 'title', 'label']),
      id
    ),
    executorTypes: ['codex'],
    isDefault: isCodexDefaultModel(id, configuredDefault),
    supportsReasoningEffort,
    supportedReasoningEfforts: supportedReasoningEfforts.length
      ? supportedReasoningEfforts
      : supportsReasoningEffort
        ? codexReasoningEffortsForModel(id)
        : [],
    supportsImages: capabilities.includes('images'),
    contextWindowTokens: numberFromKeys(value, [
      'contextWindowTokens',
      'context_window_tokens',
      'contextWindow',
      'context_window',
      'modelContextWindow',
      'model_context_window',
    ]),
    autoCompactTokenLimit: numberFromKeys(value, [
      'autoCompactTokenLimit',
      'auto_compact_token_limit',
      'modelAutoCompactTokenLimit',
      'model_auto_compact_token_limit',
    ]),
    catalogSource: 'cli-fallback',
    degraded: true,
    capabilities,
  });
}

function parseCodexCliModels(output: string, configuredDefault?: string): ModelProfile[] {
  const json = parseJsonFromOutput(output);
  return modelValuesFromJson(json)
    .map((model) => codexCliModelToProfile(model, configuredDefault))
    .filter((model): model is ModelProfile => Boolean(model));
}

function claudeCliModelToProfile(value: unknown): ModelProfile | undefined {
  if (typeof value === 'string') {
    const id = value.trim();
    return id && isAnthropicModelOrAlias(id) ? claudeCodeProfileFromModelId(id) : undefined;
  }
  if (!isRecord(value) || modelHidden(value)) {
    return undefined;
  }
  const modelId = textFromKeys(value, ['id', 'value', 'model', 'modelId', 'slug', 'name']);
  if (!modelId || !isAnthropicModelOrAlias(modelId)) {
    return undefined;
  }
  const displayName = textFromKeys(value, ['display_name', 'displayName', 'title', 'label']);
  return claudeCodeProfileFromModelId(
    modelId,
    displayName ? normalizeModelDisplayName(displayName, modelId) : undefined
  );
}

function parseClaudeCliJsonModels(output: string): ModelProfile[] {
  const json = parseJsonFromOutput(output);
  return modelValuesFromJson(json)
    .map(claudeCliModelToProfile)
    .filter((model): model is ModelProfile => Boolean(model));
}

function parseClaudeCliTextModels(output: string): ModelProfile[] {
  if (/^\s*Usage:/im.test(output)) {
    return [];
  }
  const ids = new Set<string>();
  const pattern = /\b(claude-[a-z0-9][a-z0-9_.-]*|sonnet|opus|haiku|best|opusplan)\b/gi;
  for (const match of output.matchAll(pattern)) {
    const id = match[1]?.toLowerCase();
    if (id && isAnthropicModelOrAlias(id)) {
      ids.add(id);
    }
  }
  return Array.from(ids).map((id) => claudeCodeProfileFromModelId(id));
}

function parseClaudeCliModels(output: string): ModelProfile[] {
  try {
    return parseClaudeCliJsonModels(output);
  } catch {
    return parseClaudeCliTextModels(output);
  }
}

function claudeHelpListsModelCommand(help: string, commandName: 'model' | 'models'): boolean {
  return new RegExp(`^\\s{2,}${commandName}\\b`, 'im').test(help);
}

export async function fetchCodexCliModels(
  config: ExecutorRegistryConfig,
  cwd?: string | null
): Promise<ModelProfile[]> {
  const discovery = findCodexCli(config.codexOptions?.command);
  const command =
    discovery?.path ??
    (config.codexOptions?.command && config.codexOptions.command !== 'codex'
      ? config.codexOptions.command
      : undefined);
  if (!command) {
    return [];
  }

  const env = config.codexOptions?.apiKey
    ? { ...process.env, OPENAI_API_KEY: config.codexOptions.apiKey }
    : process.env;
  const result = runCliCommand(command, ['debug', 'models', '--bundled'], { cwd, env });
  if (!result || result.status !== 0) {
    return [];
  }
  return parseCodexCliModels(result.stdout, config.codexOptions?.model);
}

export async function fetchClaudeCodeCliModels(
  config: ExecutorRegistryConfig,
  cwd?: string | null
): Promise<ModelProfile[]> {
  const discovery = findClaudeCli(config.claudeCodeOptions?.command);
  const command =
    discovery?.path ??
    (config.claudeCodeOptions?.command && config.claudeCodeOptions.command !== 'claude'
      ? config.claudeCodeOptions.command
      : undefined);
  if (!command) {
    return [];
  }

  const anthropicApiKey = config.claudeCodeOptions?.apiKey ?? config.claudeApiKey;
  const env = anthropicApiKey
    ? {
        ...process.env,
        ANTHROPIC_API_KEY: anthropicApiKey,
      }
    : process.env;
  const helpResult = runCliCommand(command, ['--help'], { cwd, env });
  const help = helpResult?.stdout ?? '';
  const candidates: string[][] = [];
  if (claudeHelpListsModelCommand(help, 'models')) {
    candidates.push(
      ['models', 'list', '--json'],
      ['models', '--json'],
      ['models', 'list'],
      ['models']
    );
  }
  if (claudeHelpListsModelCommand(help, 'model')) {
    candidates.push(['model', 'list', '--json'], ['model', 'list']);
  }

  for (const args of candidates) {
    const result = runCliCommand(command, args, { cwd, env });
    if (!result || result.status !== 0) {
      continue;
    }
    const models = parseClaudeCliModels(`${result.stdout}\n${result.stderr}`);
    if (models.length > 0) {
      return models;
    }
  }

  return [];
}
