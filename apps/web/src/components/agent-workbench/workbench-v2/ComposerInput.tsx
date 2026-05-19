import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Paperclip,
  ShieldCheck,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-react';
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode, RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import DirPicker from '../../DirPicker.tsx';
import { useT } from '../../../i18n/index.ts';
import type { SlashCommand as BackendSlashCommand } from '../../../types.ts';
import type {
  PermissionMode,
  ReasoningEffort,
  WorkbenchDevice,
  WorkbenchExecutor,
  WorkbenchMode,
  WorkbenchModel,
  WorkbenchRuntimeOptions,
  WorkbenchSession,
  WorkbenchUsage,
} from './types.ts';
import { AnimatedCollapse } from './AnimatedCollapse.tsx';
import {
  SlashCommandMenu,
  buildSlashCommands,
  filteredSlashCommands,
  type SlashCommand,
} from './SlashCommandMenu.tsx';
import { permissionModeLabel, supportedReasoningOptionsFor } from './WorkbenchRunBar.tsx';
import { formatModelDisplayName } from './modelDisplayName.ts';
import { classNames } from './utils.tsx';
import { modelDefault, reasoningEffortDefault } from './workbenchPageUtils.ts';

type ComposerInputProps = {
  inputRef?: RefObject<HTMLTextAreaElement>;
  session?: WorkbenchSession;
  mode: WorkbenchMode;
  running: boolean;
  stopping?: boolean;
  initializing?: boolean;
  slashCommands: BackendSlashCommand[];
  projectPath: string;
  projectPathLocked: boolean;
  streamState?: 'idle' | 'connecting' | 'open' | 'reconnecting';
  apiSource?: 'real' | 'mock';
  devices: WorkbenchDevice[];
  executors: WorkbenchExecutor[];
  models: WorkbenchModel[];
  selectedDeviceId?: string;
  selectedProvider?: string;
  selectedModelId?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode: PermissionMode;
  runtimeOptions?: WorkbenchRuntimeOptions;
  usage?: WorkbenchUsage | null;
  useRag: boolean;
  ragTopK: number;
  onModeChange: (mode: WorkbenchMode) => void;
  onProjectPathChange: (value: string) => void;
  onDeviceChange: (deviceId: string) => void;
  onProviderChange: (provider: string) => void;
  onModelChange: (modelId: string) => void;
  onReasoningEffortChange: (effort?: ReasoningEffort) => void;
  onPermissionModeChange: (permissionMode: PermissionMode) => void;
  onRuntimeOptionsChange: (options: WorkbenchRuntimeOptions) => void;
  onUseRagChange: (value: boolean) => void;
  onRagTopKChange: (value: number) => void;
  onSend: (content: string) => void;
  onStop: () => void;
};

const modeOptions: WorkbenchMode[] = ['agent', 'plan', 'review'];
const permissionModeOptions: PermissionMode[] = [
  'read-only',
  'default',
  'auto-review',
  'full-access',
];
const COMPOSER_SETTINGS_OPEN_KEY = 'rac:workbench:composerSettingsOpen:v2';
type QuickMenu = 'primary' | 'model' | 'speed' | 'permission';
type SpeedMode = 'standard' | 'fast';
type WorkbenchTranslations = ReturnType<typeof useT>['t'];

function splitPathList(value: string): string[] {
  return value
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePathForCompare(pathValue: string): string {
  const normalized = pathValue.trim().replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized)) return normalized.toLowerCase().replace(/\/+$/, '');
  return normalized.replace(/\/+$/, '');
}

function appendUniquePath(paths: string[], pathValue: string): string[] {
  const trimmed = pathValue.trim();
  if (!trimmed) return paths;
  const selected = normalizePathForCompare(trimmed);
  if (paths.some((item) => normalizePathForCompare(item) === selected)) return paths;
  return [...paths, trimmed];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeMention(value: string, fileRef: string): string {
  const mentionPattern = new RegExp(`(^|\\s)@${escapeRegExp(fileRef)}(?=\\s|$)`, 'g');
  return value
    .replace(mentionPattern, (match, prefix: string) => (prefix ? prefix : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .trimStart();
}

function compactModelLabel(value: string): string {
  return value
    .replace(/^gpt-/i, '')
    .replace(/\s+codex$/i, ' Codex')
    .replace(/\s+/g, ' ')
    .trim();
}

function codexEffortLabel(effort: ReasoningEffort | undefined, t: WorkbenchTranslations): string {
  if (!effort) return t.workbench.v2.composerEffortLabels.default;
  return t.workbench.v2.composerEffortLabels[effort] ?? effort;
}

function speedModeLabel(mode: SpeedMode, t: WorkbenchTranslations): string {
  return mode === 'fast' ? t.workbench.v2.fast : t.workbench.v2.standard;
}

function formatCompactTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}m`;
  }
  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(value >= 100_000 ? 0 : 1))}k`;
  }
  return value.toLocaleString();
}

function FieldShell({
  label,
  children,
  className,
  title,
  required = false,
  invalid = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  title?: string;
  required?: boolean;
  invalid?: boolean;
}) {
  return (
    <div
      className={classNames(
        'agent-settings-field',
        invalid && 'agent-settings-field-invalid',
        className
      )}
      title={title}
    >
      <span className="agent-settings-field-label">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
    </div>
  );
}

type SettingsSelectFieldProps = Omit<
  ComponentPropsWithoutRef<'select'>,
  'className' | 'children'
> & {
  label: string;
  title?: string;
  required?: boolean;
  invalid?: boolean;
  fieldClassName?: string;
  selectClassName?: string;
  children: ReactNode;
};

function SettingsSelectField({
  label,
  title,
  required,
  invalid,
  fieldClassName,
  selectClassName,
  children,
  disabled,
  ...selectProps
}: SettingsSelectFieldProps) {
  return (
    <FieldShell
      label={label}
      className={fieldClassName}
      title={title}
      required={required}
      invalid={invalid}
    >
      <div className="relative min-w-0 flex-1">
        <select
          {...selectProps}
          disabled={disabled}
          title={title}
          className={classNames('agent-settings-select', selectClassName)}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className={classNames(
            'pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary',
            disabled && 'opacity-45'
          )}
        />
      </div>
    </FieldShell>
  );
}

function ComposerSettings({
  session,
  projectPath,
  projectPathLocked,
  streamState = 'idle',
  apiSource = 'real',
  devices,
  executors,
  selectedDeviceId,
  selectedProvider,
  runtimeOptions,
  useRag,
  ragTopK,
  onProjectPathChange,
  onDeviceChange,
  onProviderChange,
  onRuntimeOptionsChange,
  onUseRagChange,
  onRagTopKChange,
}: Pick<
  ComposerInputProps,
  | 'session'
  | 'projectPath'
  | 'projectPathLocked'
  | 'streamState'
  | 'apiSource'
  | 'devices'
  | 'executors'
  | 'selectedDeviceId'
  | 'selectedProvider'
  | 'runtimeOptions'
  | 'useRag'
  | 'ragTopK'
  | 'onProjectPathChange'
  | 'onDeviceChange'
  | 'onProviderChange'
  | 'onRuntimeOptionsChange'
  | 'onUseRagChange'
  | 'onRagTopKChange'
>) {
  const { t } = useT();
  const sessionLocked = Boolean(session);
  const provider = session?.provider ?? selectedProvider ?? apiSource;
  const deviceId = session?.deviceId ?? selectedDeviceId ?? '';
  const selectedDevice = devices.find((device) => device.id === deviceId);
  const runtime = runtimeOptions ?? session?.runtimeOptions ?? {};
  const deviceExecutorTypes = new Set(selectedDevice?.executors ?? []);
  const deviceExecutors = deviceExecutorTypes.size
    ? executors.filter((executor) => deviceExecutorTypes.has(executor.type))
    : executors;
  const visibleExecutors = deviceExecutors.length
    ? deviceExecutors
    : [{ type: provider, displayName: provider, available: true }];
  const providerIsCodex = provider === 'codex';
  const providerIsClaude = provider === 'claude-code';
  const updateRuntime = (patch: WorkbenchRuntimeOptions) =>
    onRuntimeOptionsChange({ ...runtime, ...patch });
  const extraDirs = runtime.extraDirs ?? [];
  const projectBrowseStart = selectedDevice?.workRoot || projectPath;
  const extraDirBrowseStart = extraDirs.length
    ? extraDirs[extraDirs.length - 1]
    : projectBrowseStart;
  const browseDeviceId =
    apiSource === 'mock' || selectedDevice?.bridgeStatus !== 'connected'
      ? undefined
      : deviceId || undefined;
  const appendExtraDir = (pathValue: string) => {
    updateRuntime({ extraDirs: appendUniquePath(extraDirs, pathValue) });
  };
  const bridgeNotReady = selectedDevice?.bridgeStatus === 'disconnected';
  const deviceTitle = selectedDevice
    ? `${selectedDevice.name} - ${t.workbench.deviceStatus[selectedDevice.status]}${selectedDevice.trusted ? '' : ` - ${t.workbench.onlineButUntrusted}`}${selectedDevice.workRoot && selectedDevice.workRootExists !== false ? '' : ' - workspace not ready'}${bridgeNotReady ? ' - workspace bridge disconnected' : ''}`
    : t.workbench.v2.autoDevice;
  const selectedExecutor = visibleExecutors.find((executor) => executor.type === provider);
  const providerTitle = selectedExecutor?.displayName ?? provider;
  const extraDirsTitle = extraDirs.length
    ? extraDirs.join('; ')
    : t.workbench.v2.extraDirectoriesPlaceholder;
  const streamTitle = `${t.workbench.header.stream}: ${t.workbench.streamState[streamState]}`;
  const projectMissing = !projectPath.trim();
  const providerMissing = visibleExecutors.length > 0 && !provider;

  return (
    <div className="agent-composer-settings" data-testid="composer-settings-panel">
      <div className="agent-composer-settings-panel">
        <section className="agent-settings-group agent-settings-group-required">
          <div className="agent-settings-group-title">
            <span>{t.workbench.v2.requiredSetup}</span>
            <span className="agent-settings-required-note">* {t.workbench.v2.required}</span>
          </div>
          <div className="agent-composer-settings-row agent-composer-settings-row-primary">
            <FieldShell
              label={t.workbench.v2.project}
              className="agent-settings-field-project"
              title={projectPath}
              required
              invalid={projectMissing}
            >
              <DirPicker
                inputTestId="header-project-path"
                value={projectPath}
                onChange={onProjectPathChange}
                disabled={projectPathLocked}
                browseStartPath={projectBrowseStart}
                browseDeviceId={browseDeviceId}
                placeholder={t.workbench.header.projectPathPlaceholder}
                className="min-w-0 flex-1 normal-case"
                inputClassName="h-8 w-full truncate bg-transparent pr-6 font-mono text-xs font-normal normal-case text-text-secondary outline-none disabled:opacity-70"
                buttonClassName="inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-xs px-1.5 text-[11px] font-medium normal-case text-text-tertiary transition-colors hover:bg-bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                dropdownClassName="dir-picker-dropdown absolute left-0 top-full z-[130] mt-1 w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-sm border border-border-default"
              />
            </FieldShell>

            <SettingsSelectField
              label={t.workbench.device}
              title={deviceTitle}
              fieldClassName="agent-settings-field-device"
              data-testid="header-device-select"
              value={deviceId}
              disabled={sessionLocked}
              aria-label={t.workbench.device}
              onChange={(event) => onDeviceChange(event.target.value)}
            >
              <option value="">{t.workbench.v2.autoDevice}</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} - {t.workbench.deviceStatus[device.status]}
                  {device.trusted ? '' : ` - ${t.workbench.onlineButUntrusted}`}
                  {device.workRoot && device.workRootExists !== false
                    ? ''
                    : ' - workspace not ready'}
                  {device.bridgeStatus === 'disconnected' ? ' - bridge disconnected' : ''}
                </option>
              ))}
            </SettingsSelectField>

            <SettingsSelectField
              label={t.workbench.v2.provider}
              title={providerTitle}
              fieldClassName="agent-settings-field-provider"
              required
              invalid={providerMissing}
              data-testid="header-provider-select"
              value={provider}
              disabled={sessionLocked}
              aria-label={t.workbench.v2.provider}
              onChange={(event) => onProviderChange(event.target.value)}
            >
              {visibleExecutors.map((executor) => (
                <option key={executor.type} value={executor.type} disabled={!executor.available}>
                  {executor.displayName}
                </option>
              ))}
            </SettingsSelectField>

          </div>
        </section>

        <details className="agent-settings-group agent-settings-group-advanced">
          <summary className="agent-settings-group-title agent-settings-group-summary">
            <span>{t.workbench.v2.advancedOptions}</span>
            <ChevronRight aria-hidden="true" className="agent-settings-summary-icon h-3.5 w-3.5" />
          </summary>
          <div className="agent-composer-settings-row agent-composer-settings-row-runtime">
            <FieldShell
              label={t.workbench.v2.extraDirs}
              className="agent-settings-field-extra"
              title={extraDirsTitle}
            >
              <DirPicker
                inputTestId="runtime-extra-dirs-input"
                value={extraDirs.join('; ')}
                onChange={(value) => updateRuntime({ extraDirs: splitPathList(value) })}
                onSelect={appendExtraDir}
                browseStartPath={extraDirBrowseStart}
                browseDeviceId={browseDeviceId}
                selectedValue={extraDirs[extraDirs.length - 1]}
                browseAriaLabel={t.workbench.v2.extraDirectories}
                showBrowseLabel={false}
                placeholder={t.workbench.v2.extraDirectoriesPlaceholder}
                className="min-w-0 flex-1"
                inputClassName="h-8 w-full truncate bg-transparent pr-7 font-mono text-xs font-normal normal-case text-text-secondary outline-none"
                buttonClassName="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xs px-1 text-text-tertiary transition-colors hover:bg-bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                dropdownClassName="dir-picker-dropdown absolute right-0 bottom-full z-[130] mb-1 w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-sm border border-border-default"
              />
            </FieldShell>

            <label className="agent-settings-toggle" title={t.workbench.v2.rag}>
              <input
                data-testid="runtime-rag-checkbox"
                type="checkbox"
                checked={useRag}
                className="h-3.5 w-3.5"
                onChange={(event) => onUseRagChange(event.target.checked)}
              />
              <span className="truncate">{t.workbench.v2.rag}</span>
            </label>

            {useRag && (
              <FieldShell label={t.workbench.v2.topK} className="agent-settings-field-short">
                <input
                  data-testid="runtime-rag-top-k-input"
                  type="number"
                  min="1"
                  max="30"
                  step="1"
                  value={ragTopK}
                  className="h-full min-w-0 flex-1 bg-transparent text-xs font-normal normal-case text-text-secondary outline-none"
                  aria-label={t.workbench.v2.ragTopK}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    onRagTopKChange(
                      Number.isFinite(parsed) ? Math.min(30, Math.max(1, parsed)) : 6
                    );
                  }}
                />
              </FieldShell>
            )}

            <label className="agent-settings-toggle" title={t.workbench.v2.web}>
              <input
                data-testid="runtime-web-search-checkbox"
                type="checkbox"
                checked={Boolean(runtime.webSearch)}
                disabled={!providerIsCodex}
                className="h-3.5 w-3.5"
                onChange={(event) => updateRuntime({ webSearch: event.target.checked })}
              />
              <span className="truncate">{t.workbench.v2.web}</span>
            </label>

            <div className="agent-composer-settings-meta" title={streamTitle}>
              <span className="agent-settings-meta-pill">
                {t.workbench.v2.streamShort}:{' '}
                <span className="ml-1 truncate text-text-secondary">
                  {t.workbench.streamState[streamState]}
                </span>
              </span>
            </div>
          </div>

          {providerIsClaude && (
            <div className="agent-composer-settings-row agent-composer-settings-row-runtime">
              <FieldShell label={t.workbench.v2.agent} className="min-w-[8rem] flex-[1_1_9rem]">
                <input
                  data-testid="runtime-claude-agent-input"
                  value={runtime.claudeAgent ?? ''}
                  className="h-full min-w-0 flex-1 bg-transparent text-xs font-normal normal-case text-text-secondary outline-none"
                  aria-label={t.workbench.v2.claudeAgent}
                  onChange={(event) => updateRuntime({ claudeAgent: event.target.value })}
                />
              </FieldShell>
              <FieldShell label={t.workbench.v2.fallback} className="min-w-[9rem] flex-[1_1_10rem]">
                <input
                  data-testid="runtime-claude-fallback-input"
                  value={runtime.claudeFallbackModel ?? ''}
                  className="h-full min-w-0 flex-1 bg-transparent text-xs font-normal normal-case text-text-secondary outline-none"
                  aria-label={t.workbench.v2.claudeFallbackModel}
                  onChange={(event) => updateRuntime({ claudeFallbackModel: event.target.value })}
                />
              </FieldShell>
              <FieldShell label={t.workbench.v2.budget} className="min-w-[6.5rem] flex-[0_1_7rem]">
                <input
                  data-testid="runtime-claude-budget-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={runtime.claudeMaxBudgetUsd ?? ''}
                  className="h-full min-w-0 flex-1 bg-transparent text-xs font-normal normal-case text-text-secondary outline-none"
                  aria-label={t.workbench.v2.claudeMaxBudgetUsd}
                  onChange={(event) =>
                    updateRuntime({
                      claudeMaxBudgetUsd: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    })
                  }
                />
              </FieldShell>
              <FieldShell label={t.workbench.v2.prompt} className="min-w-[10rem] flex-[1_1_12rem]">
                <input
                  data-testid="runtime-claude-prompt-input"
                  value={runtime.claudeAppendSystemPrompt ?? ''}
                  className="h-full min-w-0 flex-1 bg-transparent text-xs font-normal normal-case text-text-secondary outline-none"
                  aria-label={t.workbench.v2.claudeAppendSystemPrompt}
                  onChange={(event) =>
                    updateRuntime({ claudeAppendSystemPrompt: event.target.value })
                  }
                />
              </FieldShell>
            </div>
          )}
        </details>
      </div>
    </div>
  );
}

export function ComposerInput({
  inputRef,
  session,
  mode,
  running,
  stopping = false,
  initializing = false,
  slashCommands: backendSlashCommands,
  projectPath,
  projectPathLocked,
  streamState,
  apiSource,
  devices,
  executors,
  models,
  selectedDeviceId,
  selectedProvider,
  selectedModelId,
  reasoningEffort,
  permissionMode,
  runtimeOptions,
  usage,
  useRag,
  ragTopK,
  onModeChange,
  onProjectPathChange,
  onDeviceChange,
  onProviderChange,
  onModelChange,
  onReasoningEffortChange,
  onPermissionModeChange,
  onRuntimeOptionsChange,
  onUseRagChange,
  onRagTopKChange,
  onSend,
  onStop,
}: ComposerInputProps) {
  const { t } = useT();
  const [value, setValue] = useState('');
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [menuVisible, setMenuVisible] = useState(false);
  const [fileRefs, setFileRefs] = useState<string[]>([]);
  const [quickMenu, setQuickMenu] = useState<QuickMenu | null>(null);
  const quickControlsRef = useRef<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COMPOSER_SETTINGS_OPEN_KEY) === '1';
  });
  useEffect(() => {
    window.localStorage.setItem(COMPOSER_SETTINGS_OPEN_KEY, settingsOpen ? '1' : '0');
  }, [settingsOpen]);
  useEffect(() => {
    if (!quickMenu) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (quickControlsRef.current?.contains(event.target as Node)) return;
      setQuickMenu(null);
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setQuickMenu(null);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [quickMenu]);
  const trimmedValue = value.trim();
  const showSlashMenu = menuVisible && value.trimStart().startsWith('/');
  const slashCommands = useMemo(
    () => buildSlashCommands(backendSlashCommands, t),
    [backendSlashCommands, t]
  );
  const commands = useMemo(
    () => filteredSlashCommands(value, slashCommands),
    [slashCommands, value]
  );
  const providerForValidation = session?.provider ?? selectedProvider ?? apiSource;
  const modelForValidation =
    session?.model && session.model !== 'provider default'
      ? session.model
      : (selectedModelId ?? modelDefault(providerForValidation, models));
  const selectedDeviceForValidation = devices.find(
    (device) => device.id === (session?.deviceId ?? selectedDeviceId)
  );
  const initialLoadPending = initializing;
  const readyDeviceAvailable = devices.some(
    (device) =>
      device.trusted &&
      device.status === 'online' &&
      device.workRoot &&
      device.workRootExists !== false &&
      device.bridgeStatus !== 'disconnected'
  );
  const deviceConfigurationError = initialLoadPending
    ? undefined
    : selectedDeviceForValidation
      ? selectedDeviceForValidation.trusted &&
        selectedDeviceForValidation.status === 'online' &&
        selectedDeviceForValidation.workRoot &&
        selectedDeviceForValidation.workRootExists !== false &&
        selectedDeviceForValidation.bridgeStatus !== 'disconnected'
        ? undefined
        : selectedDeviceForValidation.bridgeStatus === 'disconnected'
          ? 'Selected device workspace bridge is not connected.'
          : 'Selected device workspace is not ready.'
      : readyDeviceAvailable
        ? undefined
        : 'No ready device workspace is available.';
  const configurationErrors = [
    !projectPath.trim() ? 'Project is required.' : undefined,
    deviceConfigurationError,
    executors.length > 0 && !providerForValidation ? 'Provider is required.' : undefined,
    models.length > 0 && !modelForValidation ? 'Model is required.' : undefined,
  ].filter((item): item is string => Boolean(item));
  const configurationBlocked = configurationErrors.length > 0;
  const configurationHint = configurationErrors.join(' ');
  const sendBlocked = initialLoadPending || configurationBlocked;
  const providerForControls = session?.provider ?? selectedProvider ?? apiSource;
  const runtimeForControls = runtimeOptions ?? session?.runtimeOptions ?? {};
  const speedFast = runtimeForControls.serviceTier === 'fast';
  const selectedExecutorForControls = executors.find(
    (executor) => executor.type === providerForControls
  );
  const executorSpeedOptions = (selectedExecutorForControls?.supportedServiceTiers ?? []).filter(
    (tier): tier is SpeedMode => tier === 'standard' || tier === 'fast'
  );
  const fastCommandAvailable =
    providerForControls === 'codex' &&
    backendSlashCommands.some((command) => {
      if (!command.enabled) return false;
      const normalizedName = command.name.replace(/^wb:/, '');
      return normalizedName === 'fast' || /^\/(?:wb:)?fast\b/u.test(command.usage);
    });
  const speedOptionsForControls = executorSpeedOptions.length
    ? Array.from(new Set<SpeedMode>(['standard', ...executorSpeedOptions]))
    : fastCommandAvailable
      ? (['standard', 'fast'] satisfies SpeedMode[])
      : [];
  const speedEnabled = speedOptionsForControls.includes('fast');
  const selectedSpeedModeForControls: SpeedMode = speedFast ? 'fast' : 'standard';
  const visibleModelsForControls = models.filter(
    (model) => !providerForControls || model.executorTypes.includes(providerForControls)
  );
  const modelIdForControls =
    session?.model && session.model !== 'provider default'
      ? session.model
      : (selectedModelId ?? modelDefault(providerForControls, models) ?? '');
  const modelOptionsForControls =
    modelIdForControls &&
    modelIdForControls !== 'provider default' &&
    !visibleModelsForControls.some((model) => model.id === modelIdForControls)
      ? [
          {
            id: modelIdForControls,
            displayName: formatModelDisplayName(modelIdForControls),
            provider: providerForControls ?? 'custom',
            executorTypes: providerForControls ? [providerForControls] : [],
          } satisfies WorkbenchModel,
          ...visibleModelsForControls,
        ]
      : visibleModelsForControls;
  const supportedReasoningOptionsForControls = supportedReasoningOptionsFor(
    providerForControls,
    modelIdForControls,
    executors,
    models
  );
  const defaultReasoningEffortForControls = reasoningEffortDefault(
    providerForControls,
    modelIdForControls,
    executors,
    models
  );
  const effortForControls =
    session?.reasoningEffort ?? reasoningEffort ?? defaultReasoningEffortForControls ?? '';
  const reasoningOptionsForControls =
    effortForControls &&
    !supportedReasoningOptionsForControls.includes(effortForControls as ReasoningEffort)
      ? [effortForControls as ReasoningEffort, ...supportedReasoningOptionsForControls]
      : supportedReasoningOptionsForControls;
  const visibleEffortForControls = reasoningOptionsForControls.includes(
    effortForControls as ReasoningEffort
  )
    ? effortForControls
    : '';
  const reasoningDisabledForControls = reasoningOptionsForControls.length === 0;
  const permissionLockedForControls =
    session?.mode === 'plan' || session?.mode === 'review' || mode === 'plan' || mode === 'review';
  const selectedPermissionModeForControls = (
    permissionLockedForControls ? 'read-only' : (session?.permissionMode ?? permissionMode)
  ) as PermissionMode;
  const selectedModelForControls = modelOptionsForControls.find(
    (model) => model.id === modelIdForControls
  );
  const modelTitleForControls =
    selectedModelForControls?.displayName ??
    (modelIdForControls
      ? formatModelDisplayName(modelIdForControls)
      : t.workbench.common.providerDefault);
  const effortTitleForControls = visibleEffortForControls
    ? codexEffortLabel(visibleEffortForControls as ReasoningEffort, t)
    : codexEffortLabel(undefined, t);
  const permissionTitleForControls = permissionModeLabel(selectedPermissionModeForControls, t);
  const compactModelTitle = compactModelLabel(modelTitleForControls);
  const modelTriggerLabel = `${compactModelTitle} ${effortTitleForControls}`.trim();
  const contextWindowTokens = selectedModelForControls?.contextWindowTokens;
  const contextUsedTokens = usage?.inputTokens ?? 0;
  const contextUsagePercent =
    contextWindowTokens && contextWindowTokens > 0
      ? Math.min(100, Math.max(0, Math.round((contextUsedTokens / contextWindowTokens) * 100)))
      : undefined;
  const contextMeterStyle = {
    '--agent-context-used': `${contextUsagePercent ?? 0}%`,
  } as CSSProperties;
  const showContextMeter = Boolean(usage || contextWindowTokens);
  const contextUsageTitle = contextWindowTokens
    ? t.workbench.v2.contextUsageTokens(
        formatCompactTokenCount(contextUsedTokens),
        formatCompactTokenCount(contextWindowTokens)
      )
    : t.workbench.v2.contextTokensUsed(formatCompactTokenCount(contextUsedTokens));

  function pickCommand(command: SlashCommand) {
    setValue(command.insertText);
    setMenuVisible(false);
    if (command.mode) onModeChange(command.mode);
  }

  function send() {
    if (!trimmedValue || running) return;
    if (initialLoadPending) return;
    if (configurationBlocked) {
      setSettingsOpen(true);
      return;
    }
    onSend(trimmedValue);
    setValue('');
    setFileRefs([]);
    setMenuVisible(false);
  }

  function addFileRef(fileRef: string) {
    setFileRefs((current) => (current.includes(fileRef) ? current : [...current, fileRef]));
    setValue((current) =>
      current.includes(`@${fileRef}`)
        ? current
        : `${current}${current && !/\s$/.test(current) ? ' ' : ''}@${fileRef}`
    );
  }

  function removeFileRef(fileRef: string) {
    setFileRefs((current) => current.filter((item) => item !== fileRef));
    setValue((current) => removeMention(current, fileRef));
  }

  function requestFileRef() {
    const fileRef = window.prompt(t.workbench.v2.attachFile);
    if (fileRef?.trim()) {
      addFileRef(fileRef.trim());
    }
  }

  function selectModel(modelId: string) {
    onModelChange(modelId);
    setQuickMenu(null);
  }

  function selectReasoningEffort(nextEffort?: ReasoningEffort) {
    onReasoningEffortChange(nextEffort);
    setQuickMenu(null);
  }

  function selectPermissionMode(nextMode: PermissionMode) {
    onPermissionModeChange(nextMode);
    setQuickMenu(null);
  }

  function selectSpeed(nextMode: SpeedMode) {
    if (!speedEnabled) return;
    onRuntimeOptionsChange({
      ...runtimeForControls,
      serviceTier: nextMode === 'fast' ? 'fast' : undefined,
    });
    setQuickMenu('speed');
  }

  const settingsControl = (
    <ComposerSettings
      session={session}
      projectPath={projectPath}
      projectPathLocked={projectPathLocked}
      streamState={streamState}
      apiSource={apiSource}
      devices={devices}
      executors={executors}
      selectedDeviceId={selectedDeviceId}
      selectedProvider={selectedProvider}
      runtimeOptions={runtimeOptions}
      useRag={useRag}
      ragTopK={ragTopK}
      onProjectPathChange={onProjectPathChange}
      onDeviceChange={onDeviceChange}
      onProviderChange={onProviderChange}
      onRuntimeOptionsChange={onRuntimeOptionsChange}
      onUseRagChange={onUseRagChange}
      onRagTopKChange={onRagTopKChange}
    />
  );

  const settingsToggle = (
    <button
      type="button"
      data-testid="composer-settings-toggle"
      onClick={() => setSettingsOpen((value) => !value)}
      aria-expanded={settingsOpen}
      aria-label={
        settingsOpen ? t.workbench.toolCallCard.collapse : t.workbench.toolCallCard.expand
      }
      title={settingsOpen ? t.workbench.toolCallCard.collapse : t.workbench.toolCallCard.expand}
      className={classNames(
        'agent-composer-icon-button',
        settingsOpen
          ? 'agent-composer-icon-button-active'
          : 'agent-composer-icon-button-muted'
      )}
    >
      <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="sr-only">{t.workbench.header.settings}</span>
      <ChevronRight
        aria-hidden="true"
        className={classNames(
          'h-3 w-3 transition-transform duration-200 ease-out',
          settingsOpen && 'rotate-90'
        )}
      />
    </button>
  );

  if (running) {
    return (
      <div className="border-t border-border-soft bg-bg-app px-2 py-2 sm:px-3">
        <div className="agent-running-bar">
          <div className="agent-running-status-row">
            <span className="agent-state-dot agent-state-dot-running bg-info" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-secondary">
              {t.workbench.composer.runningPlaceholder}
            </span>
            {settingsToggle}
            <button
              type="button"
              data-testid="agent-stop-button"
              className="btn-danger h-8 px-3 text-xs"
              disabled={stopping}
              onClick={onStop}
            >
              {stopping ? `${t.workbench.stop}...` : t.workbench.stop}
            </button>
          </div>
          <AnimatedCollapse open={settingsOpen}>{settingsControl}</AnimatedCollapse>
        </div>
      </div>
    );
  }

  return (
    <div className="relative border-t border-border-soft bg-bg-app px-2 py-2 sm:px-3">
      {showSlashMenu && (
        <SlashCommandMenu
          query={value}
          commands={slashCommands}
          selectedIndex={Math.min(selectedCommandIndex, commands.length - 1)}
          onSelectedIndexChange={setSelectedCommandIndex}
          onPickCommand={pickCommand}
        />
      )}

      <div className="agent-composer-shell agent-composer-modern">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="agent-mode-pill" aria-label={t.workbench.v2.mode}>
            {modeOptions.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onModeChange(item)}
                className={classNames(
                  'agent-mode-pill-button',
                  mode === item && 'agent-mode-pill-button-active'
                )}
              >
                {t.workbench.composer.modeLabels[item]}
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            {fileRefs.length > 0 && (
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1 overflow-hidden">
                {fileRefs.slice(0, 2).map((fileRef) => (
                  <span
                    key={fileRef}
                    data-testid="file-ref-chip"
                    className="relative z-10 inline-flex min-w-0 max-w-full items-center gap-1 rounded-pill bg-bg-surface-2 px-2 py-1 font-mono text-[11px] text-text-tertiary ring-1 ring-border-soft"
                  >
                    <span className="min-w-0 truncate">@{fileRef}</span>
                    <button
                      type="button"
                      data-testid="remove-file-ref"
                      className="relative z-20 grid h-4 w-4 flex-shrink-0 place-items-center rounded-pill text-[10px] text-text-disabled hover:bg-bg-surface-3 hover:text-text-primary"
                      aria-label={t.workbench.v2.removeFile(fileRef)}
                      onClick={() => removeFileRef(fileRef)}
                    >
                      <X aria-hidden="true" className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {fileRefs.length > 2 && (
                  <span className="text-[11px] text-text-tertiary">+{fileRefs.length - 2}</span>
                )}
              </div>
            )}
            {settingsToggle}
          </div>
        </div>

        <AnimatedCollapse open={settingsOpen}>{settingsControl}</AnimatedCollapse>

        {configurationBlocked && (
          <div
            role="alert"
            className="rounded-xs border border-danger/25 bg-danger-soft px-2 py-1.5 text-xs text-danger"
          >
            {configurationHint}
          </div>
        )}

        <textarea
          ref={inputRef}
          data-testid="agent-composer-input"
          value={value}
          onFocus={() => setMenuVisible(value.trimStart().startsWith('/'))}
          onChange={(event) => {
            setValue(event.target.value);
            setMenuVisible(event.target.value.trimStart().startsWith('/'));
            setSelectedCommandIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setMenuVisible(false);
              return;
            }
            if (showSlashMenu && event.key === 'ArrowDown') {
              event.preventDefault();
              setSelectedCommandIndex((current) => Math.min(current + 1, commands.length - 1));
              return;
            }
            if (showSlashMenu && event.key === 'ArrowUp') {
              event.preventDefault();
              setSelectedCommandIndex((current) => Math.max(current - 1, 0));
              return;
            }
            if (showSlashMenu && event.key === 'Enter' && !event.shiftKey && commands.length) {
              event.preventDefault();
              pickCommand(commands[Math.min(selectedCommandIndex, commands.length - 1)]);
              return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
          className="agent-composer-textarea"
          placeholder={t.workbench.composer.inputPlaceholder}
          aria-label={t.workbench.composer.inputPlaceholder}
        />

        <div className="agent-composer-footer">
          <button
            type="button"
            data-testid="attach-file-button"
            className="agent-attach-button"
            aria-label={t.workbench.v2.attachFile}
            title={t.workbench.v2.attachFile}
            onClick={requestFileRef}
          >
            <Paperclip aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="sr-only">{t.workbench.v2.attachFile}</span>
          </button>

          {showContextMeter && (
            <div className="agent-context-meter-anchor">
              <button
                type="button"
                data-testid="composer-context-meter"
                className={classNames(
                  'agent-context-meter',
                  contextUsagePercent === undefined && 'agent-context-meter-indeterminate'
                )}
                style={contextMeterStyle}
                title={contextUsageTitle}
                aria-label={contextUsageTitle}
              >
                <span className="agent-context-meter-dot" />
              </button>
              <div className="agent-context-meter-card" role="status">
                <div className="agent-context-meter-card-title">
                  {t.workbench.v2.contextWindow}
                </div>
                {contextUsagePercent !== undefined && (
                  <div className="agent-context-meter-card-percent">
                    {t.workbench.v2.contextUsagePercent(contextUsagePercent)}
                  </div>
                )}
                <div className="agent-context-meter-card-tokens">{contextUsageTitle}</div>
                {selectedModelForControls?.autoCompactTokenLimit && (
                  <div className="agent-context-meter-card-note">
                    {t.workbench.v2.autoCompactAt(
                      formatCompactTokenCount(selectedModelForControls.autoCompactTokenLimit)
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={quickControlsRef} className="agent-composer-quick-controls">
            <div className="agent-codex-menu-anchor">
              <button
                type="button"
                data-testid="composer-model-menu-button"
                className="agent-codex-trigger agent-codex-model-trigger"
                aria-haspopup="menu"
                aria-expanded={
                  quickMenu === 'primary' || quickMenu === 'model' || quickMenu === 'speed'
                }
                title={`${modelTitleForControls} - ${effortTitleForControls}`}
                disabled={modelOptionsForControls.length === 0}
                onClick={() =>
                  setQuickMenu((value) =>
                    value === 'primary' || value === 'model' || value === 'speed'
                      ? null
                      : 'primary'
                  )
                }
              >
                {speedFast && <Zap aria-hidden="true" className="h-3.5 w-3.5" />}
                <span className="truncate">{modelTriggerLabel}</span>
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
              </button>

              {(quickMenu === 'primary' || quickMenu === 'model' || quickMenu === 'speed') && (
                <div
                  className={classNames(
                    'agent-codex-menu-stack',
                    (quickMenu === 'model' || quickMenu === 'speed') &&
                      'agent-codex-menu-stack-expanded'
                  )}
                >
                  <div
                    className="agent-codex-menu-panel agent-codex-primary-menu"
                    role="menu"
                    data-testid="composer-model-menu"
                  >
                    <div className="agent-codex-menu-title">{t.workbench.v2.intelligence}</div>
                    <div className="agent-codex-menu-list">
                      {!defaultReasoningEffortForControls && (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={!visibleEffortForControls}
                          disabled={reasoningDisabledForControls}
                          className="agent-codex-menu-item"
                          onClick={() => selectReasoningEffort(undefined)}
                        >
                          <span className="truncate">{codexEffortLabel(undefined, t)}</span>
                          {!visibleEffortForControls && (
                            <Check aria-hidden="true" className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}

                      {reasoningOptionsForControls.map((item) => {
                        const selected = item === visibleEffortForControls;
                        return (
                          <button
                            key={item}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            disabled={reasoningDisabledForControls}
                            className="agent-codex-menu-item"
                            onClick={() => selectReasoningEffort(item)}
                          >
                            <span className="truncate">{codexEffortLabel(item, t)}</span>
                            {selected && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                          </button>
                        );
                      })}

                      <div className="agent-codex-menu-separator" />

                      <button
                        type="button"
                        data-testid="composer-model-submenu-button"
                        className="agent-codex-menu-item"
                        aria-expanded={quickMenu === 'model'}
                        onClick={() =>
                          setQuickMenu((value) => (value === 'model' ? 'primary' : 'model'))
                        }
                      >
                        <span className="agent-codex-menu-item-main">
                          {speedFast && <Zap aria-hidden="true" className="h-3.5 w-3.5" />}
                          <span className="truncate">{compactModelTitle}</span>
                        </span>
                        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>

                      {speedEnabled && speedOptionsForControls.length > 0 && (
                        <button
                          type="button"
                          data-testid="composer-speed-submenu-button"
                          className="agent-codex-menu-item"
                          aria-expanded={quickMenu === 'speed'}
                          onClick={() =>
                            setQuickMenu((value) => (value === 'speed' ? 'primary' : 'speed'))
                          }
                        >
                          <span className="truncate">{t.workbench.v2.speed}</span>
                          <span className="agent-codex-menu-item-main">
                            <span className="agent-codex-menu-item-meta">
                              {speedModeLabel(selectedSpeedModeForControls, t)}
                            </span>
                            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {quickMenu === 'model' && (
                    <div
                      className="agent-codex-menu-panel agent-codex-submenu"
                      role="menu"
                      data-testid="composer-model-submenu"
                    >
                      <div className="agent-codex-menu-title">{t.workbench.model}</div>
                      <div className="agent-codex-menu-list">
                        {modelOptionsForControls.map((model) => {
                          const selected = model.id === modelIdForControls;
                          return (
                            <button
                              key={model.id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              className="agent-codex-menu-item"
                              onClick={() => selectModel(model.id)}
                            >
                              <span className="agent-codex-menu-item-main">
                                {speedFast && <Zap aria-hidden="true" className="h-3.5 w-3.5" />}
                                <span className="truncate">{model.displayName}</span>
                              </span>
                              {selected && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {quickMenu === 'speed' && (
                    <div
                      className="agent-codex-menu-panel agent-codex-submenu"
                      role="menu"
                      data-testid="composer-speed-menu"
                    >
                      <div className="agent-codex-menu-title">{t.workbench.v2.speed}</div>
                      <div className="agent-codex-menu-list">
                        {speedOptionsForControls.map((item) => {
                          const selected = item === selectedSpeedModeForControls;
                          return (
                            <button
                              key={item}
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              className="agent-codex-menu-item"
                              onClick={() => selectSpeed(item)}
                            >
                              <span className="truncate">{speedModeLabel(item, t)}</span>
                              {selected && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="agent-codex-menu-anchor">
              <button
                type="button"
                data-testid="composer-permission-menu-button"
                className="agent-codex-trigger agent-codex-permission-trigger"
                aria-haspopup="menu"
                aria-expanded={quickMenu === 'permission'}
                title={permissionTitleForControls}
                disabled={permissionLockedForControls}
                onClick={() =>
                  setQuickMenu((value) => (value === 'permission' ? null : 'permission'))
                }
              >
                <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="truncate">{permissionTitleForControls}</span>
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
              </button>

              {quickMenu === 'permission' && (
                <div
                  className="agent-codex-menu-panel agent-codex-permission-menu"
                  role="menu"
                  data-testid="composer-permission-menu"
                >
                  <div className="agent-codex-menu-title">
                    {t.workbench.composer.commands.permissions}
                  </div>
                  <div className="agent-codex-menu-list">
                    {permissionModeOptions.map((item) => {
                      const selected = item === selectedPermissionModeForControls;
                      return (
                        <button
                          key={item}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className="agent-codex-menu-item"
                          onClick={() => selectPermissionMode(item)}
                        >
                          <span className="truncate">{permissionModeLabel(item, t)}</span>
                          {selected && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            data-testid="agent-send-button"
            className={classNames(
              'agent-send-button',
              trimmedValue && !sendBlocked
                ? 'agent-send-button-ready'
                : 'agent-send-button-disabled'
            )}
            disabled={!trimmedValue || sendBlocked}
            title={configurationBlocked ? configurationHint : undefined}
            aria-label={t.workbench.send}
            onClick={send}
          >
            <ArrowUp aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only">{t.workbench.send}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
