import type { ExecutorType, ModelCapability, ModelProfile, ReasoningEffort } from '@rac/shared';
import type { ProviderRuntimeModel } from './provider-runtime.js';

export const CODEX_DEFAULT_MODEL_ID = 'gpt-5.4';
export const CODEX_REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];

export type ModelProvider = 'local' | 'openai' | 'anthropic' | 'openai-compatible' | 'openrouter';

function profile(input: ModelProfile): ModelProfile {
  return input;
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

const MODEL_ACRONYMS: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  cli: 'CLI',
  gpt: 'GPT',
  id: 'ID',
  oss: 'OSS',
  sdk: 'SDK',
  ui: 'UI',
};

const SPECIAL_MODEL_WORDS: Record<string, string> = {
  opusplan: 'Opus Plan',
};

function modelNameTokens(value: string): string[] {
  const rawTokens = value.split(/[-_:/\s]+/).filter(Boolean);
  const tokens: string[] = [];

  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];
    const next = rawTokens[index + 1];
    if (
      next &&
      /^\d+$/.test(token) &&
      /^\d+$/.test(next) &&
      token.length <= 2 &&
      next.length <= 2
    ) {
      tokens.push(`${token}.${next}`);
      index += 1;
      continue;
    }
    tokens.push(token);
  }

  return tokens;
}

function titleCaseModelToken(token: string): string {
  const lower = token.toLowerCase();
  if (SPECIAL_MODEL_WORDS[lower]) {
    return SPECIAL_MODEL_WORDS[lower];
  }
  if (MODEL_ACRONYMS[lower]) {
    return MODEL_ACRONYMS[lower];
  }
  if (/^o\d+[a-z]?$/i.test(token)) {
    return token.toUpperCase();
  }
  if (/^\d+(?:\.\d+)*[a-z]?$/i.test(token)) {
    return token;
  }
  return lower ? lower[0].toUpperCase() + lower.slice(1) : token;
}

export function titleCaseModel(id: string): string {
  const value = id.trim();
  if (!value) {
    return value;
  }

  const gptMatch = value.match(/^gpt[-_:\s]+(\d+(?:[.-]\d+)*[a-z]?)(?:[-_:\s]+(.+))?$/i);
  if (gptMatch) {
    const version = gptMatch[1].replace(/-/g, '.');
    const suffix = gptMatch[2] ? titleCaseModel(gptMatch[2]) : '';
    return suffix ? `GPT-${version} ${suffix}` : `GPT-${version}`;
  }

  return modelNameTokens(value).map(titleCaseModelToken).join(' ');
}

export function normalizeModelDisplayName(
  displayName: string | undefined,
  fallbackId: string
): string {
  return titleCaseModel(displayName?.trim() || fallbackId);
}

export function claudeCodeDisplayName(modelId: string): string {
  if (/^claude[-_:\s]/i.test(modelId)) {
    return titleCaseModel(modelId);
  }
  return `Claude Code ${titleCaseModel(modelId)}`;
}

export function capabilities(values: ModelCapability[]): ModelCapability[] {
  return unique(values);
}

export function modelProfile(input: {
  id: string;
  provider: ModelProvider;
  modelId: string;
  displayName: string;
  providerConfigId?: string;
  providerConfigType?: string;
  providerProfileName?: string;
  providerBaseUrl?: string;
  executorTypes: ExecutorType[];
  isDefault?: boolean;
  supportsStreaming?: boolean;
  supportsToolUse?: boolean;
  supportsReasoningSummary?: boolean;
  supportsReasoningEffort?: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts?: ReasoningEffort[];
  supportsImages?: boolean;
  contextWindowTokens?: number;
  autoCompactTokenLimit?: number;
  catalogSource?: ModelProfile['catalogSource'];
  degraded?: boolean;
  capabilities: ModelCapability[];
}): ModelProfile {
  const supportedReasoningEfforts = input.supportedReasoningEfforts?.length
    ? unique(input.supportedReasoningEfforts)
    : undefined;
  return profile({
    id: input.id,
    provider: input.provider,
    modelId: input.modelId,
    displayName: input.displayName,
    providerConfigId: input.providerConfigId,
    providerConfigType: input.providerConfigType,
    providerProfileName: input.providerProfileName,
    providerBaseUrl: input.providerBaseUrl,
    capabilities: capabilities(input.capabilities),
    supportsStreaming: input.supportsStreaming ?? true,
    supportsToolUse: input.supportsToolUse ?? true,
    supportsReasoningSummary: input.supportsReasoningSummary ?? true,
    defaultReasoningEffort: input.defaultReasoningEffort,
    supportedReasoningEfforts,
    supportsReasoningEffort:
      input.supportsReasoningEffort ?? Boolean(supportedReasoningEfforts?.length),
    supportsImages: input.supportsImages ?? false,
    enabled: true,
    isDefault: input.isDefault ?? false,
    contextWindowTokens: input.contextWindowTokens,
    autoCompactTokenLimit: input.autoCompactTokenLimit,
    catalogSource: input.catalogSource,
    degraded: input.degraded,
    executorTypes: unique(input.executorTypes),
  });
}

export function openAiCapabilities(id: string): ModelCapability[] {
  const values: ModelCapability[] = ['streaming', 'tool_use', 'reasoning_summary', 'diff_support'];
  if (/^(gpt-[5-9]|o\d|o\d-|.*codex)/i.test(id)) {
    values.push('reasoning_effort');
  }
  if (/^(gpt-[45]|gpt-5|o\d)/i.test(id) && !/mini|nano/i.test(id)) {
    values.push('long_context', 'images');
  }
  return values;
}

export function codexReasoningEffortsForModel(id: string): ReasoningEffort[] {
  void id;
  return CODEX_REASONING_EFFORTS;
}

export function isCodexDefaultModel(id: string, configuredDefault?: string): boolean {
  const normalized = id.toLowerCase();
  if (configuredDefault?.trim()) {
    return normalized === configuredDefault.trim().toLowerCase();
  }
  return normalized === CODEX_DEFAULT_MODEL_ID;
}

export function isLikelyOpenAiCodingModel(id: string): boolean {
  if (!/^(gpt-|o\d|o\d-|codex)/i.test(id)) {
    return false;
  }
  return !/(image|audio|realtime|transcribe|tts|embedding|moderation|whisper|dall-e|sora)/i.test(
    id
  );
}

export function isAnthropicModelOrAlias(id: string): boolean {
  return /^(claude-|sonnet|opus|haiku|best|default|opusplan)/i.test(id);
}

export function claudeCodeProfileFromModelId(modelId: string, displayName?: string): ModelProfile {
  const id = modelId.startsWith('claude-code-')
    ? modelId
    : modelId.startsWith('claude-')
      ? modelId
      : `claude-code-${modelId}`;

  return modelProfile({
    id,
    provider: 'anthropic',
    modelId,
    displayName: displayName
      ? normalizeModelDisplayName(displayName, modelId)
      : claudeCodeDisplayName(modelId),
    executorTypes: ['claude-code'],
    supportsReasoningEffort: true,
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    catalogSource: 'static',
    capabilities: [
      'streaming',
      'tool_use',
      'reasoning_summary',
      'reasoning_effort',
      'diff_support',
      'long_context',
    ],
  });
}

export function codexRuntimeModelToProfile(
  model: ProviderRuntimeModel,
  configuredDefault?: string
): ModelProfile | undefined {
  const id = model.modelId?.trim() || model.id.trim();
  if (!id) {
    return undefined;
  }
  const runtimeReasoningEfforts = model.supportedReasoningEfforts?.filter(
    (effort) => effort !== 'max'
  );
  const defaultReasoningEffort =
    model.defaultReasoningEffort === 'max' ? undefined : model.defaultReasoningEffort;
  const supportsReasoningEffort =
    model.supportsReasoningEffort ??
    (runtimeReasoningEfforts?.length || defaultReasoningEffort
      ? true
      : openAiCapabilities(id).includes('reasoning_effort'));
  const capabilities = withCapability(
    openAiCapabilities(id),
    'reasoning_effort',
    supportsReasoningEffort
  );
  return modelProfile({
    id,
    provider: /^oss:|^local:/i.test(id) ? 'local' : 'openai',
    modelId: id,
    displayName: normalizeModelDisplayName(model.displayName, id),
    executorTypes: ['codex'],
    isDefault: model.isDefault ?? isCodexDefaultModel(id, configuredDefault),
    supportsReasoningEffort,
    defaultReasoningEffort,
    supportedReasoningEfforts: runtimeReasoningEfforts?.length
      ? runtimeReasoningEfforts
      : supportsReasoningEffort
        ? codexReasoningEffortsForModel(id)
        : [],
    supportsImages: capabilities.includes('images'),
    contextWindowTokens: model.contextWindowTokens,
    autoCompactTokenLimit: model.autoCompactTokenLimit,
    catalogSource: 'provider',
    capabilities,
  });
}

export function claudeRuntimeModelToProfile(model: ProviderRuntimeModel): ModelProfile | undefined {
  const modelId = model.modelId?.trim() || model.id.trim();
  if (!modelId || !isAnthropicModelOrAlias(modelId)) {
    return undefined;
  }
  const profile = claudeCodeProfileFromModelId(modelId, model.displayName);
  return {
    ...profile,
    supportsReasoningEffort: model.supportsReasoningEffort ?? profile.supportsReasoningEffort,
    defaultReasoningEffort: model.defaultReasoningEffort ?? profile.defaultReasoningEffort,
    supportedReasoningEfforts: model.supportedReasoningEfforts?.length
      ? model.supportedReasoningEfforts
      : profile.supportedReasoningEfforts,
    contextWindowTokens: model.contextWindowTokens ?? profile.contextWindowTokens,
    autoCompactTokenLimit: model.autoCompactTokenLimit ?? profile.autoCompactTokenLimit,
    catalogSource: 'provider',
  };
}

export function withCapability(
  values: ModelCapability[],
  capability: ModelCapability,
  enabled: boolean
): ModelCapability[] {
  return enabled && !values.includes(capability) ? [...values, capability] : values;
}
