import { randomUUID } from 'node:crypto';
import type { ProviderConfigRepository } from '@rac/storage';
import type {
  ModelProfile,
  ProviderConfig,
  ProviderConfigInput,
  ProviderProbeResult,
  PublicProviderConfig,
} from '@rac/shared';
import { ProviderSecretVault } from './provider-secret.js';
import { NotFoundError } from './errors.js';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

export interface ProviderRuntimeBinding {
  providerConfigId?: string;
  modelId?: string;
  environment?: Record<string, string>;
}

function csv(value: string | undefined): string[] {
  return value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];
}

function publicProvider(config: ProviderConfig): PublicProviderConfig {
  const { apiKeyEncrypted: _apiKeyEncrypted, ...rest } = config;
  return {
    ...rest,
    hasApiKey: Boolean(config.apiKeyEncrypted),
  };
}

function fetchWithTimeout(url: URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function modelIds(payload: unknown): string[] {
  const value = isRecord(payload)
    ? payload.data ?? payload.models
    : payload;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (isRecord(item) && typeof item.id === 'string') return item.id;
      if (isRecord(item) && typeof item.name === 'string') return item.name;
      return undefined;
    })
    .filter((item): item is string => Boolean(item));
}

function textPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
}

function parseJsonText(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export class ProviderControlService {
  private vault: ProviderSecretVault;

  constructor(
    private repo: ProviderConfigRepository,
    secretKey: string,
  ) {
    this.vault = new ProviderSecretVault(secretKey);
  }

  ensureEnvironmentProfiles(env: NodeJS.ProcessEnv = process.env): void {
    const now = new Date().toISOString();
    const profiles: ProviderConfig[] = [];

    if (env.OPENAI_API_KEY) {
      profiles.push({
        id: 'env-openai',
        name: 'OpenAI environment',
        type: 'openai-compatible',
        baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        apiKeyEncrypted: this.vault.encrypt(env.OPENAI_API_KEY),
        models: csv(env.OPENAI_MODELS),
        timeoutMs: undefined,
        enabled: true,
        usagePurpose: 'general',
        readonly: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (env.OPENROUTER_API_KEY) {
      profiles.push({
        id: 'env-openrouter',
        name: 'OpenRouter environment',
        type: 'openrouter',
        baseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        apiKeyEncrypted: this.vault.encrypt(env.OPENROUTER_API_KEY),
        models: csv(env.OPENROUTER_MODELS),
        timeoutMs: undefined,
        enabled: true,
        usagePurpose: 'general',
        readonly: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    const anthropicKey = env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY;
    if (anthropicKey) {
      profiles.push({
        id: 'env-anthropic',
        name: 'Anthropic environment',
        type: 'anthropic',
        baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
        apiKeyEncrypted: this.vault.encrypt(anthropicKey),
        models: csv(env.ANTHROPIC_MODELS || env.CLAUDE_MODELS),
        timeoutMs: undefined,
        enabled: true,
        usagePurpose: 'general',
        readonly: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (env.OLLAMA_BASE_URL) {
      profiles.push({
        id: 'env-ollama',
        name: 'Ollama environment',
        type: 'openai-compatible',
        baseUrl: env.OLLAMA_BASE_URL,
        apiKeyEncrypted: env.OLLAMA_API_KEY ? this.vault.encrypt(env.OLLAMA_API_KEY) : undefined,
        models: csv(env.OLLAMA_MODELS),
        timeoutMs: undefined,
        enabled: true,
        usagePurpose: 'general',
        readonly: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const profile of profiles) {
      this.repo.upsert(profile);
    }
  }

  list(): PublicProviderConfig[] {
    return this.repo.findAll().map(publicProvider);
  }

  findPublic(id: string): PublicProviderConfig | undefined {
    const config = this.repo.findById(id);
    return config ? publicProvider(config) : undefined;
  }

  create(input: ProviderConfigInput): PublicProviderConfig {
    const now = new Date().toISOString();
    const config: ProviderConfig = {
      id: `provider-${randomUUID()}`,
      name: input.name,
      type: input.type,
      baseUrl: input.baseUrl?.trim() || undefined,
      apiKeyEncrypted: input.apiKey?.trim() ? this.vault.encrypt(input.apiKey.trim()) : undefined,
      models: input.models ?? [],
      timeoutMs: input.timeoutMs,
      enabled: input.enabled ?? true,
      usagePurpose: input.usagePurpose ?? 'general',
      readonly: false,
      createdAt: now,
      updatedAt: now,
    };
    this.repo.create(config);
    return publicProvider(config);
  }

  update(id: string, input: Partial<ProviderConfigInput>): PublicProviderConfig | undefined {
    const patch: Partial<Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.type !== undefined) patch.type = input.type;
    if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl.trim() || undefined;
    if (input.models !== undefined) patch.models = input.models;
    if (input.timeoutMs !== undefined) patch.timeoutMs = input.timeoutMs;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.usagePurpose !== undefined) patch.usagePurpose = input.usagePurpose;
    if (input.apiKey?.trim()) patch.apiKeyEncrypted = this.vault.encrypt(input.apiKey.trim());
    const updated = this.repo.update(id, patch);
    return updated ? publicProvider(updated) : undefined;
  }

  delete(id: string): boolean {
    return this.repo.delete(id);
  }

  decryptApiKey(id: string): string | undefined {
    const config = this.repo.findById(id);
    if (!config?.apiKeyEncrypted) {
      return undefined;
    }
    return this.vault.decrypt(config.apiKeyEncrypted);
  }

  runtimeBindingForModel(model: ModelProfile | undefined): ProviderRuntimeBinding {
    if (!model?.providerConfigId) {
      return { modelId: model?.modelId === 'default' ? undefined : model?.modelId };
    }

    const config = this.repo.findById(model.providerConfigId);
    if (!config || !config.enabled) {
      return { modelId: model.modelId === 'default' ? undefined : model.modelId };
    }

    const apiKey = config.apiKeyEncrypted ? this.vault.decrypt(config.apiKeyEncrypted) : undefined;
    const baseUrl = config.baseUrl?.trim();
    const environment: Record<string, string> = {};

    if (config.type === 'anthropic') {
      if (apiKey) environment.ANTHROPIC_API_KEY = apiKey;
      if (baseUrl) environment.ANTHROPIC_BASE_URL = baseUrl;
    } else {
      if (apiKey) {
        environment.OPENAI_API_KEY = apiKey;
        if (config.type === 'openrouter') {
          environment.OPENROUTER_API_KEY = apiKey;
        }
      }
      if (baseUrl) {
        environment.OPENAI_BASE_URL = baseUrl;
        if (config.type === 'openrouter') {
          environment.OPENROUTER_BASE_URL = baseUrl;
        }
      }
    }

    return {
      providerConfigId: config.id,
      modelId: model.modelId === 'default' ? undefined : model.modelId,
      environment: Object.keys(environment).length ? environment : undefined,
    };
  }

  private modelEndpoint(config: ProviderConfig): URL {
    const base = (config.baseUrl || (
      config.type === 'anthropic'
        ? DEFAULT_ANTHROPIC_BASE_URL
        : config.type === 'openrouter'
          ? DEFAULT_OPENROUTER_BASE_URL
          : DEFAULT_OPENAI_BASE_URL
    )).replace(/\/+$/, '');
    const path = config.type === 'anthropic'
      ? (/\/v1$/i.test(base) ? '/models' : '/v1/models')
      : (/\/(?:api\/)?v1$/i.test(base) ? '/models' : '/v1/models');
    return new URL(`${base}${path}`);
  }

  async testConnection(id: string): Promise<ProviderProbeResult> {
    const config = this.repo.findById(id);
    if (!config) {
      throw new NotFoundError('Provider not found');
    }

    const started = Date.now();
    let apiKey: string | undefined;
    try {
      apiKey = config.apiKeyEncrypted ? this.vault.decrypt(config.apiKeyEncrypted) : undefined;
    } catch (err) {
      return {
        id,
        enabled: config.enabled,
        hasApiKey: true,
        ok: false,
        models: [],
        latencyMs: Date.now() - started,
        message: err instanceof Error ? err.message : 'Provider secret could not be decrypted.',
      };
    }

    const endpoint = this.modelEndpoint(config);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (config.type === 'anthropic') {
      if (apiKey) headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    try {
      const response = await fetchWithTimeout(
        endpoint,
        { method: 'GET', headers },
        config.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
      );
      const text = await response.text();
      const payload = parseJsonText(text);
      const models = modelIds(payload);
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        return {
          id,
          enabled: config.enabled,
          hasApiKey: Boolean(apiKey),
          ok: false,
          endpoint: endpoint.toString(),
          status: response.status,
          latencyMs,
          models: [],
          message: `Provider returned ${response.status} ${response.statusText}${text ? `: ${textPreview(text)}` : ''}`,
        };
      }
      return {
        id,
        enabled: config.enabled,
        hasApiKey: Boolean(apiKey),
        ok: true,
        endpoint: endpoint.toString(),
        status: response.status,
        latencyMs,
        models,
        message: models.length > 0
          ? `Provider responded with ${models.length} model(s).`
          : 'Provider responded, but no models were listed.',
      };
    } catch (err) {
      return {
        id,
        enabled: config.enabled,
        hasApiKey: Boolean(apiKey),
        ok: false,
        endpoint: endpoint.toString(),
        latencyMs: Date.now() - started,
        models: [],
        message: err instanceof Error ? err.message : 'Provider probe failed.',
      };
    }
  }
}
