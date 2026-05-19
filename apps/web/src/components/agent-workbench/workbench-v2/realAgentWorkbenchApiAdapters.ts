import type {
  AgentEvent as BackendAgentEvent,
  AgentPermissionHit,
  AgentPermissionRule,
  AgentUsage,
  AgentWorkbenchExecutor,
  Device,
  ExecutorType,
  InitClaudePlan,
  ModelProfile,
} from '../../../types.ts';
import { patchForPath } from './agentEventNormalizer.ts';
import type {
  CreateWorkbenchSessionInput,
  PermissionMode,
  ReasoningEffort,
  WorkbenchDevice,
  WorkbenchDiff,
  WorkbenchExecutor,
  WorkbenchInitPlan,
  WorkbenchModel,
  WorkbenchPermissionHit,
  WorkbenchPermissionRule,
  WorkbenchPermissionRuleInput,
  WorkbenchRuntimeOptions,
  WorkbenchSession,
  WorkbenchUsage,
} from './types.ts';

export function normalizePermissionMode(value: unknown): PermissionMode | undefined {
  if (
    value === 'read-only' ||
    value === 'default' ||
    value === 'auto-review' ||
    value === 'full-access'
  ) {
    return value;
  }
  if (value === 'auto' || value === 'ask' || value === 'untrusted' || value === 'on-request') {
    return 'default';
  }
  return undefined;
}

export function findRunnableDevice(devices: Device[], preferredId?: string): Device | undefined {
  const ready = (device: Device) =>
    device.trusted &&
    device.status === 'online' &&
    Boolean(device.workRoot) &&
    device.workRootExists !== false &&
    device.bridgeStatus !== 'disconnected';
  if (preferredId) {
    const preferred = devices.find((device) => device.id === preferredId);
    if (preferred && ready(preferred)) return preferred;
  }
  return devices.find(ready);
}

export function executorFromInput(input: CreateWorkbenchSessionInput): ExecutorType | undefined {
  return executorFromProvider(input.provider);
}

export function executorFromProvider(provider: string | undefined): ExecutorType | undefined {
  if (
    provider === 'mock' ||
    provider === 'codex' ||
    provider === 'claude' ||
    provider === 'claude-code' ||
    provider === 'custom-command'
  ) {
    return provider;
  }
  return undefined;
}

export function isExecutorType(value: string | undefined): value is ExecutorType {
  return (
    value === 'mock' ||
    value === 'codex' ||
    value === 'claude' ||
    value === 'claude-code' ||
    value === 'custom-command'
  );
}

function isWorkbenchReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  );
}

function normalizeReasoningEfforts(
  value: readonly unknown[] | undefined
): ReasoningEffort[] | undefined {
  const result = (value ?? []).filter(isWorkbenchReasoningEffort);
  return result.length ? result : undefined;
}

export function normalizeDevice(device: Device): WorkbenchDevice {
  return {
    id: device.id,
    name: device.name,
    status: device.status,
    trusted: device.trusted,
    executors: device.executors?.map((executor) => executor.type),
    workRoot: device.workRoot,
    workRootExists: device.workRootExists,
    lastHeartbeatAt: device.lastHeartbeatAt,
    lastBridgeConnectedAt: device.lastBridgeConnectedAt,
    lastBridgeDisconnectedAt: device.lastBridgeDisconnectedAt,
    bridgeStatus: device.bridgeStatus,
    lastDisconnectReason: device.lastDisconnectReason,
    workerReconnectCount: device.workerReconnectCount,
  };
}

export function normalizePermissionRule(rule: AgentPermissionRule): WorkbenchPermissionRule {
  return {
    id: rule.id,
    provider: rule.provider,
    projectPath: rule.projectPath,
    scope: rule.scope,
    ruleType: rule.ruleType,
    pattern: rule.pattern,
    decision: rule.decision,
    enabled: rule.enabled,
    builtIn: rule.builtIn,
    description: rule.description,
    riskLevel: rule.riskLevel,
  };
}

export function permissionRuleInput(
  input: Partial<WorkbenchPermissionRuleInput>
): Partial<AgentPermissionRule> {
  return {
    provider: isExecutorType(input.provider)
      ? input.provider
      : input.provider === 'all'
        ? 'all'
        : undefined,
    projectPath: input.projectPath,
    scope: input.scope,
    ruleType: input.ruleType,
    pattern: input.pattern,
    decision: input.decision,
    enabled: input.enabled,
    builtIn: input.builtIn,
    description: input.description,
    riskLevel:
      input.riskLevel === 'low' ||
      input.riskLevel === 'medium' ||
      input.riskLevel === 'high' ||
      input.riskLevel === 'critical'
        ? input.riskLevel
        : undefined,
  };
}

export function normalizeInitPlan(plan: InitClaudePlan): WorkbenchInitPlan {
  return {
    sessionId: plan.sessionId,
    projectPath: plan.projectPath,
    status: plan.status,
    files: plan.files.map((file) => ({
      path: file.path,
      action: file.action,
      reason: file.reason,
    })),
    createdFiles: plan.createdFiles,
    deniedReason: plan.deniedReason,
    error: plan.error,
  };
}

function sessionStatusFromAgentStatus(
  status: Extract<BackendAgentEvent, { type: 'session.status' | 'session.started' }>['status']
): WorkbenchSession['status'] | undefined {
  if (status === 'idle') return 'idle';
  if (status === 'running') return 'running';
  if (status === 'waiting_approval') return 'waiting_approval';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return undefined;
}

export function sessionUpdateFromBackendEvent(
  event: BackendAgentEvent,
  fallbackSessionId: string
): { sessionId: string; changes: Partial<WorkbenchSession> } | undefined {
  if (event.type !== 'session.status' && event.type !== 'session.started') return undefined;

  const changes: Partial<WorkbenchSession> = {
    updatedAt: event.createdAt,
  };
  const status = sessionStatusFromAgentStatus(event.status);
  if (status) changes.status = status;
  if (event.model !== undefined) changes.model = event.model || 'provider default';
  if (Object.prototype.hasOwnProperty.call(event, 'reasoningEffort')) {
    changes.reasoningEffort = event.reasoningEffort ?? undefined;
  }
  if (event.mode) changes.mode = event.mode;
  if (event.cwd !== undefined) changes.projectPath = event.cwd;
  if (event.executorType) changes.provider = event.executorType;
  if (event.permissionMode) {
    const permissionMode = normalizePermissionMode(event.permissionMode);
    if (permissionMode) changes.permissionMode = permissionMode;
  }
  if (event.runtimeOptions !== undefined) {
    changes.runtimeOptions = event.runtimeOptions as WorkbenchRuntimeOptions | undefined;
  }

  return {
    sessionId: event.type === 'session.started' ? event.sessionId : fallbackSessionId,
    changes,
  };
}

export function workbenchDiffFromBackendEvent(
  sessionId: string,
  event: Extract<BackendAgentEvent, { type: 'diff.updated' }>
): WorkbenchDiff {
  return {
    sessionId,
    files: event.files.map((file) => ({
      filePath: file.path,
      changeType: file.changeType === 'created' ? 'added' : file.changeType,
      patch: patchForPath(event.patch, file.path, event.files.length),
      insertions: file.insertions,
      deletions: file.deletions,
    })),
    patchText: event.patch,
    insertions: event.files.reduce((sum, file) => sum + (file.insertions ?? 0), 0),
    deletions: event.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
  };
}

export function normalizeWorkbenchExecutor(executor: AgentWorkbenchExecutor): WorkbenchExecutor {
  return {
    type: executor.type,
    displayName: executor.displayName,
    available: executor.available,
    permissionMode: executor.permissionMode,
    supportedReasoningEfforts: normalizeReasoningEfforts(executor.supportedReasoningEfforts),
    supportedServiceTiers: executor.supportedServiceTiers,
    nativeRuntime: executor.nativeRuntime,
    capabilitySource: executor.capabilitySource,
    degraded: executor.degraded,
  };
}

export function normalizeWorkbenchModel(model: ModelProfile): WorkbenchModel {
  return {
    id: model.id,
    displayName: model.displayName,
    provider: model.provider,
    executorTypes: model.executorTypes,
    isDefault: model.isDefault,
    supportsReasoningEffort: model.supportsReasoningEffort,
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportedReasoningEfforts: normalizeReasoningEfforts(model.supportedReasoningEfforts),
    contextWindowTokens: model.contextWindowTokens,
    autoCompactTokenLimit: model.autoCompactTokenLimit,
    catalogSource: model.catalogSource,
    degraded: model.degraded,
  };
}

export function normalizePermissionHit(hit: AgentPermissionHit): WorkbenchPermissionHit {
  return {
    id: hit.id,
    provider: hit.provider,
    inputType: hit.inputType,
    inputValue: hit.inputValue,
    decision: hit.decision,
    reason: hit.reason,
    createdAt: hit.createdAt,
  };
}

export function normalizeUsage(usage: AgentUsage | null | undefined): WorkbenchUsage | null {
  if (!usage) return null;
  return {
    uncachedInputTokens: usage.uncachedInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreation5mInputTokens: usage.cacheCreation5mInputTokens,
    cacheCreation1hInputTokens: usage.cacheCreation1hInputTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimated: usage.estimated,
    model: usage.model,
    totalCost: usage.totalCost,
    currency: usage.currency,
  };
}
