import { useT } from '../../../i18n/index.ts';
import type {
  PermissionMode,
  ReasoningEffort,
  WorkbenchDevice,
  WorkbenchExecutor,
  WorkbenchMode,
  WorkbenchModel,
  WorkbenchRuntimeOptions,
  WorkbenchSession,
} from './types.ts';
import { formatModelDisplayName } from './modelDisplayName.ts';
import { classNames, compactPath } from './utils.tsx';

type WorkbenchRunBarProps = {
  session?: WorkbenchSession;
  projectPath: string;
  projectPathLocked: boolean;
  mode: WorkbenchMode;
  streamState?: 'idle' | 'connecting' | 'open' | 'reconnecting';
  apiSource?: 'real' | 'mock';
  devices: WorkbenchDevice[];
  executors: WorkbenchExecutor[];
  models: WorkbenchModel[];
  selectedDeviceId?: string;
  selectedProvider?: string;
  selectedModelId?: string;
  reasoningEffort?: ReasoningEffort;
  runtimeOptions?: WorkbenchRuntimeOptions;
  worktreeWarning?: string;
  onProjectPathChange: (value: string) => void;
  onDeviceChange: (deviceId: string) => void;
  onProviderChange: (provider: string) => void;
  onModelChange: (modelId: string) => void;
  onReasoningEffortChange: (effort?: ReasoningEffort) => void;
};

export function permissionModeLabel(mode: PermissionMode, t: ReturnType<typeof useT>['t']): string {
  if (mode === 'read-only') return t.workbench.permissionModes.readOnly;
  if (mode === 'auto-review') return t.workbench.permissionModes.autoReview;
  if (mode === 'full-access') return t.workbench.permissionModes.fullAccess;
  return t.workbench.permissionModes.default;
}

export function supportedReasoningOptionsFor(
  provider: string | undefined,
  modelId: string | undefined,
  executors: WorkbenchExecutor[],
  models: WorkbenchModel[]
): ReasoningEffort[] {
  const model =
    modelId && modelId !== 'provider default'
      ? models.find((item) => item.id === modelId)
      : undefined;
  if (model?.supportedReasoningEfforts?.length) {
    return model.supportedReasoningEfforts;
  }
  if (model && model.supportsReasoningEffort === false) {
    return [];
  }

  const executor = executors.find((item) => item.type === provider);
  return executor?.supportedReasoningEfforts ?? [];
}

export function WorkbenchRunBar({
  session,
  projectPath,
  apiSource = 'real',
  devices,
  executors,
  models,
  selectedDeviceId,
  selectedProvider,
  selectedModelId,
  reasoningEffort,
  runtimeOptions,
  worktreeWarning,
}: WorkbenchRunBarProps) {
  const { t } = useT();
  const provider = session?.provider ?? selectedProvider ?? apiSource;
  const modelId =
    session?.model && session.model !== 'provider default' ? session.model : selectedModelId;
  const visibleModels = models.filter(
    (model) => !provider || model.executorTypes.includes(provider)
  );
  const selectedDevice = devices.find((device) => device.id === (session?.deviceId ?? selectedDeviceId));
  const bridgeDisconnected = selectedDevice?.bridgeStatus === 'disconnected';
  const deviceExecutorTypes = new Set(selectedDevice?.executors ?? []);
  const deviceExecutors = deviceExecutorTypes.size
    ? executors.filter((executor) => deviceExecutorTypes.has(executor.type))
    : executors;
  const visibleExecutors = deviceExecutors.length
    ? deviceExecutors
    : [{ type: provider, displayName: provider, available: true }];
  const executor = visibleExecutors.find((item) => item.type === provider);
  const selectedModel = visibleModels.find((model) => model.id === modelId);
  const providerLabel = executor?.displayName ?? provider ?? t.workbench.common.defaultValue;
  const modelLabel =
    selectedModel?.displayName ??
    (modelId ? formatModelDisplayName(modelId) : t.workbench.common.defaultValue);
  const status = session?.status ?? 'idle';
  const statusLabel = t.workbench.statusLabels[status];
  const workspace = compactPath(
    projectPath || session?.projectPath || t.workbench.v2.noProjectSelected
  );
  const taskTitle = session?.title ?? t.workbench.v2.newAgentSession;
  const permissionMode = session?.permissionMode ?? 'default';
  const permissionLabel = permissionModeLabel(permissionMode, t);
  const effort = session?.reasoningEffort ?? reasoningEffort;
  const effortLabel = effort ? t.workbench.effortLabels[effort] : t.workbench.effortLabels.default;
  const fastLabel =
    (session?.runtimeOptions ?? runtimeOptions)?.serviceTier === 'fast'
      ? ` - ${t.workbench.v2.fast}: on`
      : '';
  const secondaryMeta = `${providerLabel} - ${modelLabel} - ${t.workbench.reasoningEffort}: ${effortLabel} - ${t.workbench.header.permission}: ${permissionLabel}${fastLabel}`;
  const degraded =
    executor?.degraded ||
    selectedModel?.degraded ||
    executor?.nativeRuntime === 'cli-fallback' ||
    executor?.capabilitySource === 'cli-fallback' ||
    selectedModel?.catalogSource === 'cli-fallback';
  const degradedSource =
    executor?.nativeRuntime === 'cli-fallback' || executor?.capabilitySource === 'cli-fallback'
      ? 'CLI fallback'
      : selectedModel?.catalogSource === 'cli-fallback'
        ? 'CLI model discovery'
        : 'fallback catalog';

  return (
    <div
      data-testid="session-status-bar"
      className="border-b border-border-soft bg-bg-surface-1 px-3 py-2"
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            className={classNames(
              'agent-state-dot',
              status === 'running' && 'agent-state-dot-running bg-success',
              status === 'waiting_approval' && 'bg-warning',
              status === 'completed' && 'bg-success',
              status === 'failed' && 'bg-danger',
              status === 'idle' && 'bg-success',
              status === 'cancelled' && 'bg-warning'
            )}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-primary">
              <span className="mr-2 text-text-secondary">{statusLabel}</span>
              {taskTitle}
              <span className="ml-2 text-text-tertiary">- {workspace}</span>
            </div>
            <div className="truncate text-[11px] text-text-tertiary">{secondaryMeta}</div>
          </div>
        </div>
      </div>

      {worktreeWarning && (
        <div className="mt-1 rounded-xs bg-warning-soft px-2 py-0.5 text-xs text-warning ring-1 ring-warning/30">
          {worktreeWarning}
        </div>
      )}
      {bridgeDisconnected && (
        <div className="mt-1 rounded-xs bg-danger-soft px-2 py-0.5 text-xs text-danger ring-1 ring-danger/30">
          Remote workspace bridge is not connected for {selectedDevice.name}.
        </div>
      )}
      {degraded && (
        <div
          data-testid="degraded-mode-banner"
          className="mt-1 rounded-xs bg-warning-soft px-2 py-0.5 text-xs text-warning ring-1 ring-warning/30"
        >
          Degraded mode: using {degradedSource}; native provider discovery is unavailable.
        </div>
      )}
    </div>
  );
}
