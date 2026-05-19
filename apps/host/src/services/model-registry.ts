import type {
  ExecutorType,
  ModelProfile,
  PublicProviderConfig,
  ReasoningEffort,
} from '@rac/shared';
import { findClaudeCli, type ExecutorRegistryConfig } from '@rac/executors';
import { createLogger } from '@rac/logger';
import { createProviderRuntime } from './provider-runtime.js';
import { fetchClaudeCodeCliModels, fetchCodexCliModels } from './model-registry-cli.js';
import { readLocalModelConfig, type LocalModelConfig } from './model-registry-local-config.js';
import {
  CODEX_DEFAULT_MODEL_ID,
  capabilities,
  claudeCodeDisplayName,
  claudeCodeProfileFromModelId,
  claudeRuntimeModelToProfile,
  codexReasoningEffortsForModel,
  codexRuntimeModelToProfile,
  isAnthropicModelOrAlias,
  isCodexDefaultModel,
  isLikelyOpenAiCodingModel,
  modelProfile,
  normalizeModelDisplayName,
  openAiCapabilities,
  titleCaseModel,
  unique,
} from './model-registry-profiles.js';
import type { ProviderControlService } from './provider-control-service.js';

const log = createLogger('models');

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const DEFAULT_REFRESH_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;

interface OpenAiModel {
  id?: string;
}

interface OpenAiModelsResponse {
  data?: OpenAiModel[];
}

interface AnthropicModel {
  id?: string;
  display_name?: string;
}

interface AnthropicModelsResponse {
  data?: AnthropicModel[];
}

export interface ModelRegistryOptions {
  workingDirectory?: string | null;
  refreshTtlMs?: number;
  providerControlService?: Pick<ProviderControlService, 'list'>;
}

function providerModelProfile(
  provider: PublicProviderConfig,
  modelId: string
): ModelProfile | undefined {
  const id = modelId.trim();
  if (!id || !provider.enabled) {
    return undefined;
  }

  if (provider.type === 'anthropic') {
    const base = claudeCodeProfileFromModelId(id, `${provider.name} ${titleCaseModel(id)}`);
    return {
      ...base,
      id: `provider:${provider.id}:${id}`,
      modelId: id,
      providerConfigId: provider.id,
      providerConfigType: provider.type,
      providerProfileName: provider.name,
      providerBaseUrl: provider.baseUrl,
      executorTypes: unique<ExecutorType>(['claude-code', 'claude']),
    };
  }

  const providerLabel = provider.type === 'openrouter' ? 'OpenRouter' : 'OpenAI compatible';
  const capabilities = openAiCapabilities(id);
  return modelProfile({
    id: `provider:${provider.id}:${id}`,
    provider: provider.type,
    modelId: id,
    displayName: `${provider.name} ${titleCaseModel(id)}`,
    providerConfigId: provider.id,
    providerConfigType: provider.type,
    providerProfileName: provider.name || providerLabel,
    providerBaseUrl: provider.baseUrl,
    executorTypes: ['codex'],
    supportsReasoningEffort: capabilities.includes('reasoning_effort'),
    supportedReasoningEfforts: capabilities.includes('reasoning_effort')
      ? codexReasoningEffortsForModel(id)
      : [],
    supportsImages: capabilities.includes('images'),
    catalogSource: 'control-plane',
    capabilities,
  });
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function mergeModelProfiles(models: ModelProfile[]): ModelProfile[] {
  const byId = new Map<string, ModelProfile>();

  for (const model of models) {
    const existing = byId.get(model.id);
    if (!existing) {
      byId.set(model.id, {
        ...model,
        executorTypes: unique(model.executorTypes),
        capabilities: capabilities(model.capabilities),
      });
      continue;
    }

    byId.set(model.id, {
      ...existing,
      supportsStreaming: existing.supportsStreaming || model.supportsStreaming,
      supportsToolUse: existing.supportsToolUse || model.supportsToolUse,
      supportsReasoningSummary: existing.supportsReasoningSummary || model.supportsReasoningSummary,
      supportsReasoningEffort: existing.supportsReasoningEffort || model.supportsReasoningEffort,
      supportsImages: existing.supportsImages || model.supportsImages,
      enabled: existing.enabled || model.enabled,
      isDefault: existing.isDefault || model.isDefault,
      defaultReasoningEffort: existing.defaultReasoningEffort ?? model.defaultReasoningEffort,
      supportedReasoningEfforts: existing.supportedReasoningEfforts?.length
        ? existing.supportedReasoningEfforts
        : model.supportedReasoningEfforts,
      contextWindowTokens: existing.contextWindowTokens ?? model.contextWindowTokens,
      autoCompactTokenLimit: existing.autoCompactTokenLimit ?? model.autoCompactTokenLimit,
      catalogSource: existing.catalogSource ?? model.catalogSource,
      degraded: existing.degraded && model.degraded,
      executorTypes: unique([...existing.executorTypes, ...model.executorTypes]),
      capabilities: capabilities([...existing.capabilities, ...model.capabilities]),
    });
  }

  return Array.from(byId.values()).filter((model) => model.enabled);
}

function applyClaudeCodeRestrictions(
  models: ModelProfile[],
  availableModels: string[]
): ModelProfile[] {
  if (availableModels.length === 0) {
    return models;
  }

  const allowed = new Set(availableModels);
  return models
    .map((model) => {
      if (!model.executorTypes.includes('claude-code') || model.id === 'claude-code-default') {
        return model;
      }
      if (allowed.has(model.id) || allowed.has(model.modelId)) {
        return model;
      }
      return {
        ...model,
        executorTypes: model.executorTypes.filter((type) => type !== 'claude-code'),
      };
    })
    .filter((model) => model.executorTypes.length > 0);
}

function staticModels(config: ExecutorRegistryConfig): ModelProfile[] {
  const codexDefault = config.codexOptions?.model?.trim() || CODEX_DEFAULT_MODEL_ID;
  const claudeCodeDefault = config.claudeCodeOptions?.model ?? 'default';
  const claudeApiDefault = config.claudeModel ?? 'default';
  const claudeCodeReasoningEfforts: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
  const codexConfiguredModel = config.codexOptions?.model?.trim();
  const codexConfiguredModelProfile =
    codexConfiguredModel && codexConfiguredModel.toLowerCase() !== CODEX_DEFAULT_MODEL_ID
      ? [
          modelProfile({
            id: codexConfiguredModel,
            provider: /^oss:|^local:/i.test(codexConfiguredModel) ? 'local' : 'openai',
            modelId: codexConfiguredModel,
            displayName: `Codex ${titleCaseModel(codexConfiguredModel)}`,
            executorTypes: ['codex'],
            isDefault: true,
            supportsReasoningEffort: true,
            supportedReasoningEfforts: codexReasoningEffortsForModel(codexConfiguredModel),
            supportsImages: /^(gpt-[45]|gpt-5|o\d)/i.test(codexConfiguredModel),
            capabilities: openAiCapabilities(codexConfiguredModel),
          }),
        ]
      : [];

  return [
    modelProfile({
      id: 'mock-agent',
      provider: 'local',
      modelId: 'mock-agent',
      displayName: 'Mock Agent',
      executorTypes: ['mock'],
      isDefault: true,
      supportsStreaming: true,
      supportsToolUse: true,
      capabilities: ['streaming', 'tool_use', 'reasoning_summary', 'diff_support'],
      catalogSource: 'static',
    }),
    modelProfile({
      id: 'custom-command-agent',
      provider: 'local',
      modelId: 'custom-command-agent',
      displayName: 'Custom Command Agent',
      executorTypes: ['custom-command'],
      isDefault: true,
      supportsStreaming: true,
      supportsToolUse: false,
      supportsReasoningSummary: false,
      supportsReasoningEffort: false,
      supportedReasoningEfforts: [],
      capabilities: ['streaming', 'diff_support'],
      catalogSource: 'static',
    }),
    ...codexConfiguredModelProfile,
    modelProfile({
      id: 'gpt-5.5',
      provider: 'openai',
      modelId: 'gpt-5.5',
      displayName: 'GPT-5.5',
      executorTypes: ['codex'],
      supportsReasoningEffort: true,
      supportedReasoningEfforts: codexReasoningEffortsForModel('gpt-5.5'),
      supportsImages: true,
      capabilities: [
        'streaming',
        'tool_use',
        'reasoning_summary',
        'reasoning_effort',
        'diff_support',
        'long_context',
        'images',
      ],
      catalogSource: 'static',
    }),
    modelProfile({
      id: 'gpt-5.4',
      provider: 'openai',
      modelId: 'gpt-5.4',
      displayName: 'GPT-5.4',
      executorTypes: ['codex'],
      isDefault: codexDefault.toLowerCase() === CODEX_DEFAULT_MODEL_ID,
      supportsReasoningEffort: true,
      supportedReasoningEfforts: codexReasoningEffortsForModel('gpt-5.4'),
      supportsImages: true,
      capabilities: [
        'streaming',
        'tool_use',
        'reasoning_summary',
        'reasoning_effort',
        'diff_support',
        'long_context',
        'images',
      ],
      catalogSource: 'static',
    }),
    modelProfile({
      id: 'gpt-5.4-mini',
      provider: 'openai',
      modelId: 'gpt-5.4-mini',
      displayName: 'GPT-5.4 Mini',
      executorTypes: ['codex'],
      supportsReasoningEffort: true,
      supportedReasoningEfforts: codexReasoningEffortsForModel('gpt-5.4-mini'),
      capabilities: [
        'streaming',
        'tool_use',
        'reasoning_summary',
        'reasoning_effort',
        'diff_support',
      ],
      catalogSource: 'static',
    }),
    modelProfile({
      id: 'gpt-5.3-codex',
      provider: 'openai',
      modelId: 'gpt-5.3-codex',
      displayName: 'GPT-5.3 Codex',
      executorTypes: ['codex'],
      supportsReasoningEffort: true,
      supportedReasoningEfforts: codexReasoningEffortsForModel('gpt-5.3-codex'),
      capabilities: [
        'streaming',
        'tool_use',
        'reasoning_summary',
        'reasoning_effort',
        'diff_support',
        'long_context',
      ],
      catalogSource: 'static',
    }),
    modelProfile({
      id: 'claude-code-default',
      provider: 'anthropic',
      modelId: claudeCodeDefault,
      displayName: claudeCodeDisplayName(claudeCodeDefault),
      executorTypes: ['claude-code'],
      isDefault: true,
      supportsReasoningEffort: true,
      supportedReasoningEfforts: claudeCodeReasoningEfforts,
      capabilities: [
        'streaming',
        'tool_use',
        'reasoning_summary',
        'reasoning_effort',
        'diff_support',
        'long_context',
      ],
      catalogSource: 'static',
    }),
    ...['sonnet', 'opus', 'haiku', 'best', 'opusplan'].map((alias) =>
      modelProfile({
        id: `claude-code-${alias}`,
        provider: 'anthropic',
        modelId: alias,
        displayName: claudeCodeDisplayName(alias),
        executorTypes: ['claude-code'],
        supportsReasoningEffort: true,
        supportedReasoningEfforts: claudeCodeReasoningEfforts,
        capabilities: [
          'streaming',
          'tool_use',
          'reasoning_summary',
          'reasoning_effort',
          'diff_support',
          'long_context',
        ],
        catalogSource: 'static',
      })
    ),
    modelProfile({
      id: 'claude-api-default',
      provider: 'anthropic',
      modelId: claudeApiDefault,
      displayName: `Claude API ${titleCaseModel(claudeApiDefault)}`,
      executorTypes: ['claude'],
      isDefault: true,
      supportsStreaming: false,
      supportsReasoningSummary: true,
      supportsReasoningEffort: false,
      supportedReasoningEfforts: [],
      capabilities: ['tool_use', 'reasoning_summary', 'diff_support', 'long_context'],
      catalogSource: 'static',
    }),
  ];
}

function localModels(local: LocalModelConfig): ModelProfile[] {
  const models: ModelProfile[] = [];

  if (local.codexModel && local.codexModel !== 'default') {
    models.push(
      modelProfile({
        id: local.codexModel,
        provider: local.codexProvider === 'oss' ? 'local' : 'openai',
        modelId: local.codexModel,
        displayName: `Codex ${titleCaseModel(local.codexModel)}`,
        executorTypes: ['codex'],
        supportsReasoningEffort: true,
        supportedReasoningEfforts: codexReasoningEffortsForModel(local.codexModel),
        supportsImages: /^(gpt-[45]|gpt-5|o\d)/i.test(local.codexModel),
        catalogSource: 'local-config',
        capabilities: openAiCapabilities(local.codexModel),
      })
    );
  }

  const claudeLocalModels = unique(
    [local.claudeModel, ...local.claudeAvailableModels].filter((entry): entry is string =>
      Boolean(entry && entry !== 'default')
    )
  );

  for (const modelId of claudeLocalModels) {
    if (!isAnthropicModelOrAlias(modelId)) {
      continue;
    }
    models.push(
      modelProfile({
        id: modelId.startsWith('claude-code-') ? modelId : `claude-code-${modelId}`,
        provider: 'anthropic',
        modelId,
        displayName: claudeCodeDisplayName(modelId),
        executorTypes: ['claude-code'],
        supportsReasoningEffort: true,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        catalogSource: 'local-config',
        capabilities: [
          'streaming',
          'tool_use',
          'reasoning_summary',
          'reasoning_effort',
          'diff_support',
          'long_context',
        ],
      })
    );
  }

  return models;
}

async function fetchCodexAppServerModels(
  config: ExecutorRegistryConfig,
  cwd?: string | null
): Promise<ModelProfile[]> {
  const runtime = createProviderRuntime('codex', config, cwd);
  const models = await runtime.listModels();
  return models
    .map((model) => codexRuntimeModelToProfile(model, config.codexOptions?.model))
    .filter((model): model is ModelProfile => Boolean(model));
}

async function fetchCodexNativeModels(
  config: ExecutorRegistryConfig,
  cwd?: string | null
): Promise<ModelProfile[]> {
  let appServerError: unknown;
  const appServerModels = await fetchCodexAppServerModels(config, cwd).catch((error) => {
    appServerError = error;
    return [] as ModelProfile[];
  });
  if (appServerModels.length > 0) {
    return appServerModels;
  }
  const cliModels = await fetchCodexCliModels(config, cwd);
  if (appServerError) {
    log.debug(
      { err: appServerError },
      'Codex app-server model/list unavailable; using CLI fallback'
    );
  }
  return cliModels;
}

async function fetchClaudeAgentSdkModels(
  config: ExecutorRegistryConfig,
  cwd?: string | null
): Promise<ModelProfile[]> {
  const runtime = createProviderRuntime('claude-code', config, cwd);
  const models = await runtime.listModels();
  return models
    .map(claudeRuntimeModelToProfile)
    .filter((model): model is ModelProfile => Boolean(model));
}

function claudeAgentSdkProbeUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Claude Agent SDK disabled|Claude Code native binary not found|Claude Code CLI was not found|ENOENT/i.test(
    message
  );
}

async function fetchClaudeCodeNativeModels(
  config: ExecutorRegistryConfig,
  cwd?: string | null
): Promise<ModelProfile[]> {
  const command = config.claudeCodeOptions?.command ?? 'claude';
  const discovery = findClaudeCli(command);
  if (!discovery && command === 'claude') {
    log.debug(
      'Skipping Claude Agent SDK supportedModels probe because Claude Code CLI was not found on PATH'
    );
    return fetchClaudeCodeCliModels(config, cwd);
  }

  const sdkModels = await fetchClaudeAgentSdkModels(config, cwd).catch((error) => {
    if (claudeAgentSdkProbeUnavailable(error)) {
      log.debug({ err: error }, 'Claude Agent SDK supportedModels unavailable');
    } else {
      log.warn({ err: error }, 'Claude Agent SDK supportedModels failed');
    }
    return [] as ModelProfile[];
  });
  if (sdkModels.length > 0) {
    return sdkModels;
  }
  return fetchClaudeCodeCliModels(config, cwd);
}

async function fetchOpenAiModels(
  apiKey: string | undefined,
  configuredDefault?: string
): Promise<ModelProfile[]> {
  if (!apiKey) {
    return [];
  }

  const json = await fetchJson<OpenAiModelsResponse>(OPENAI_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  return (json.data ?? [])
    .map((model) => model.id?.trim())
    .filter((id): id is string => Boolean(id && isLikelyOpenAiCodingModel(id)))
    .map((id) =>
      modelProfile({
        id,
        provider: 'openai',
        modelId: id,
        displayName: titleCaseModel(id),
        executorTypes: ['codex'],
        isDefault: isCodexDefaultModel(id, configuredDefault),
        supportsReasoningEffort: openAiCapabilities(id).includes('reasoning_effort'),
        supportedReasoningEfforts: openAiCapabilities(id).includes('reasoning_effort')
          ? codexReasoningEffortsForModel(id)
          : [],
        supportsImages: openAiCapabilities(id).includes('images'),
        catalogSource: 'provider',
        capabilities: openAiCapabilities(id),
      })
    );
}

async function fetchAnthropicModels(apiKey: string | undefined): Promise<ModelProfile[]> {
  if (!apiKey) {
    return [];
  }

  const json = await fetchJson<AnthropicModelsResponse>(ANTHROPIC_MODELS_URL, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });

  return (json.data ?? [])
    .flatMap((model) => {
      const id = model.id?.trim();
      return id ? [{ id, displayName: model.display_name?.trim() }] : [];
    })
    .map((model) =>
      modelProfile({
        id: model.id,
        provider: 'anthropic',
        modelId: model.id,
        displayName: normalizeModelDisplayName(model.displayName, model.id),
        executorTypes: ['claude', 'claude-code'],
        supportsStreaming: true,
        supportsReasoningEffort: true,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        supportsImages: false,
        catalogSource: 'provider',
        capabilities: [
          'streaming',
          'tool_use',
          'reasoning_summary',
          'reasoning_effort',
          'diff_support',
          'long_context',
        ],
      })
    );
}

function staticModelsForRefresh(
  models: ModelProfile[],
  options: { codexCliAvailable: boolean; claudeCodeCliAvailable: boolean }
): ModelProfile[] {
  return models.filter((model) => {
    if (
      options.codexCliAvailable &&
      model.executorTypes.length === 1 &&
      model.executorTypes.includes('codex')
    ) {
      return false;
    }
    if (
      options.claudeCodeCliAvailable &&
      model.executorTypes.length === 1 &&
      model.executorTypes.includes('claude-code')
    ) {
      return false;
    }
    return true;
  });
}

function withoutExecutorType(models: ModelProfile[], executorType: ExecutorType): ModelProfile[] {
  return models
    .map((model) => ({
      ...model,
      executorTypes: model.executorTypes.filter((type) => type !== executorType),
    }))
    .filter((model) => model.executorTypes.length > 0);
}

export class ModelRegistry {
  private readonly config: ExecutorRegistryConfig;
  private readonly refreshTtlMs: number;
  private readonly workingDirectory?: string | null;
  private readonly localConfig: LocalModelConfig;
  private readonly staticModelList: ModelProfile[];
  private readonly localModelList: ModelProfile[];
  private readonly baseModels: ModelProfile[];
  private readonly providerControlService?: Pick<ProviderControlService, 'list'>;
  private models: ModelProfile[];
  private lastRefreshAt = 0;
  private refreshInFlight?: Promise<ModelProfile[]>;

  constructor(config: ExecutorRegistryConfig, options: ModelRegistryOptions = {}) {
    this.config = config;
    this.refreshTtlMs = options.refreshTtlMs ?? DEFAULT_REFRESH_TTL_MS;
    this.workingDirectory = options.workingDirectory;
    this.providerControlService = options.providerControlService;
    this.localConfig = readLocalModelConfig(options.workingDirectory);
    this.staticModelList = staticModels(config);
    this.localModelList = localModels(this.localConfig);
    this.baseModels = mergeModelProfiles([...this.staticModelList, ...this.localModelList]);
    this.models = applyClaudeCodeRestrictions(
      mergeModelProfiles([...this.baseModels, ...this.controlPlaneProviderModels()]),
      this.localConfig.claudeAvailableModels
    );
  }

  list(): ModelProfile[] {
    return mergeModelProfiles([...this.models, ...this.controlPlaneProviderModels()]).filter(
      (model) => model.enabled
    );
  }

  async refresh(options: { force?: boolean } = {}): Promise<ModelProfile[]> {
    const now = Date.now();
    if (!options.force && now - this.lastRefreshAt < this.refreshTtlMs) {
      return this.list();
    }
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.refreshFromProviders()
      .catch((error) => {
        log.warn({ err: error }, 'Dynamic model refresh failed');
        return this.list();
      })
      .finally(() => {
        this.lastRefreshAt = Date.now();
        this.refreshInFlight = undefined;
      });

    return this.refreshInFlight;
  }

  listForExecutor(executorType: ExecutorType): ModelProfile[] {
    return this.list().filter((model) => model.executorTypes.includes(executorType));
  }

  async listForExecutorFresh(executorType: ExecutorType): Promise<ModelProfile[]> {
    await this.refresh();
    return this.listForExecutor(executorType);
  }

  get(id: string | undefined): ModelProfile | undefined {
    if (!id) {
      return undefined;
    }
    return this.list().find((model) => model.id === id);
  }

  getForExecutor(executorType: ExecutorType, id: string | undefined): ModelProfile | undefined {
    if (!id) {
      return undefined;
    }
    return this.listForExecutor(executorType).find(
      (model) => model.id === id || model.modelId === id
    );
  }

  getDefault(executorType: ExecutorType): ModelProfile {
    return (
      this.listForExecutor(executorType).find((model) => model.isDefault) ??
      this.listForExecutor(executorType)[0] ??
      this.list()[0]
    );
  }

  getEffectiveModelId(id: string | undefined): string | undefined {
    const model = this.get(id);
    if (!model || model.modelId === 'default') {
      return undefined;
    }
    return model.modelId;
  }

  private async refreshFromProviders(): Promise<ModelProfile[]> {
    const [codexNativeModels, claudeCodeNativeModels, openAiModels, anthropicModels] =
      await Promise.all([
        fetchCodexNativeModels(this.config, this.workingDirectory).catch((error) => {
          log.warn({ err: error }, 'Codex native model refresh failed');
          return [];
        }),
        fetchClaudeCodeNativeModels(this.config, this.workingDirectory).catch((error) => {
          log.warn({ err: error }, 'Claude Code native model refresh failed');
          return [];
        }),
        fetchOpenAiModels(this.config.codexOptions?.apiKey, this.config.codexOptions?.model).catch(
          (error) => {
            log.warn({ err: error }, 'OpenAI model refresh failed');
            return [];
          }
        ),
        fetchAnthropicModels(
          this.config.claudeCodeOptions?.apiKey ?? this.config.claudeApiKey
        ).catch((error) => {
          log.warn({ err: error }, 'Anthropic model refresh failed');
          return [];
        }),
      ]);
    const codexProviderModels = codexNativeModels.length > 0 ? codexNativeModels : openAiModels;
    const anthropicProviderModels =
      claudeCodeNativeModels.length > 0
        ? withoutExecutorType(anthropicModels, 'claude-code')
        : anthropicModels;

    this.models = applyClaudeCodeRestrictions(
      mergeModelProfiles([
        ...codexProviderModels,
        ...claudeCodeNativeModels,
        ...staticModelsForRefresh(this.staticModelList, {
          codexCliAvailable: codexNativeModels.length > 0,
          claudeCodeCliAvailable: claudeCodeNativeModels.length > 0,
        }),
        ...this.localModelList,
        ...anthropicProviderModels,
        ...this.controlPlaneProviderModels(),
      ]),
      this.localConfig.claudeAvailableModels
    );

    return this.list();
  }

  private controlPlaneProviderModels(): ModelProfile[] {
    if (!this.providerControlService) {
      return [];
    }

    return this.providerControlService
      .list()
      .filter((provider) => provider.enabled)
      .flatMap((provider) => provider.models.map((model) => providerModelProfile(provider, model)))
      .filter((model): model is ModelProfile => Boolean(model));
  }
}
