import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentWorkbenchApiSource } from './agentWorkbenchApi.ts';
import { permissionModeLabel } from './WorkbenchRunBar.tsx';
import type {
  AgentWorkbenchApi,
  PermissionMode,
  ReasoningEffort,
  WorkbenchDevice,
  WorkbenchExecutor,
  WorkbenchMode,
  WorkbenchModel,
  WorkbenchNativeTerminalProvider,
  WorkbenchRuntimeOptions,
  WorkbenchSession,
} from './types.ts';
import {
  compactWorkbenchRuntimeOptions,
  createTimestamp,
  hasSessionChange,
  isReadyWorkbenchDevice,
  modelDefault,
  normalizeReasoningEffort,
  providerDefault,
  reasoningEffortDefault,
  terminalProviderFrom,
  workbenchProjectPathDefault,
  worktreeWarningText,
} from './workbenchPageUtils.ts';
import { useLatestRef } from '../../../hooks/useLatestRef.ts';
import { useT } from '../../../i18n/index.ts';
import { getErrorMessage } from '../../../lib/format.ts';

type RuntimeBusyAction = 'model' | 'effort' | 'permission' | 'runtime';

type WorktreeStartCheck = { allowed: boolean; allowDirtyWorktree: boolean };

export function useWorkbenchRuntimeControls({
  api,
  apiSource,
  routeProjectPath,
  routeDeviceId,
  activeSession,
  activeSessionId,
  devices,
  executors,
  models,
  setSessions,
  setBusyAction,
  setLoadError,
  setNotice,
  scheduleRuntimeUpdate,
}: {
  api: AgentWorkbenchApi;
  apiSource: AgentWorkbenchApiSource;
  routeProjectPath?: string;
  routeDeviceId?: string;
  activeSession?: WorkbenchSession;
  activeSessionId?: string;
  devices: WorkbenchDevice[];
  executors: WorkbenchExecutor[];
  models: WorkbenchModel[];
  setSessions: Dispatch<SetStateAction<WorkbenchSession[]>>;
  setBusyAction: (value: RuntimeBusyAction | undefined) => void;
  setLoadError: (value: string) => void;
  setNotice: (value: string) => void;
  scheduleRuntimeUpdate: (callback: () => void, delayMs: number) => void;
}) {
  const { t } = useT();
  const tRef = useLatestRef(t);
  const [mode, setMode] = useState<WorkbenchMode>('agent');
  const [projectPath, setProjectPath] = useState(routeProjectPath ?? '');
  const projectPathTouchedRef = useRef(Boolean(routeProjectPath?.trim()));
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>();
  const [selectedProvider, setSelectedProvider] = useState<string>();
  const [terminalProvider, setTerminalProvider] =
    useState<WorkbenchNativeTerminalProvider>('codex');
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>();
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [runtimeOptions, setRuntimeOptions] = useState<WorkbenchRuntimeOptions>({});
  const [useRag, setUseRag] = useState(false);
  const [ragTopK, setRagTopK] = useState(6);
  const [worktreeWarning, setWorktreeWarning] = useState<string>();

  const syncRuntimeControls = useCallback((session: WorkbenchSession) => {
    setProjectPath(session.projectPath);
    setMode(session.mode);
    setSelectedProvider(session.provider);
    setTerminalProvider(terminalProviderFrom(session.provider));
    setSelectedDeviceId(session.deviceId);
    const nextModel = session.model === 'provider default'
      ? modelDefault(session.provider, models)
      : session.model;
    setSelectedModelId(nextModel);
    setReasoningEffort(
      session.reasoningEffort ??
        reasoningEffortDefault(session.provider, nextModel, executors, models)
    );
    setPermissionMode(session.permissionMode);
    setRuntimeOptions(session.runtimeOptions ?? {});
  }, [executors, models]);

  const initializeRuntimeControls = useCallback(
    ({
      firstSession,
      loadedDevices,
      loadedExecutors,
      loadedModels,
      routeDeviceId,
    }: {
      firstSession?: WorkbenchSession;
      loadedDevices: WorkbenchDevice[];
      loadedExecutors: WorkbenchExecutor[];
      loadedModels: WorkbenchModel[];
      routeDeviceId?: string;
    }) => {
      const nextProvider = firstSession?.provider ?? providerDefault(apiSource, loadedExecutors);
      const readyDevice = loadedDevices.find(isReadyWorkbenchDevice);
      const nextDeviceId = firstSession?.deviceId ?? routeDeviceId ?? readyDevice?.id;
      const nextProjectPath = workbenchProjectPathDefault({
        routeProjectPath,
        firstSession,
        devices: loadedDevices,
        routeDeviceId,
      });
      setSelectedProvider(nextProvider);
      setTerminalProvider(terminalProviderFrom(nextProvider));
      setSelectedDeviceId(nextDeviceId);
      const nextModel = firstSession?.model && firstSession.model !== 'provider default'
        ? firstSession.model
        : modelDefault(nextProvider, loadedModels);
      setSelectedModelId(nextModel);
      setReasoningEffort(
        firstSession?.reasoningEffort ??
          reasoningEffortDefault(nextProvider, nextModel, loadedExecutors, loadedModels)
      );
      setPermissionMode(firstSession?.permissionMode ?? 'default');
      setRuntimeOptions(firstSession?.runtimeOptions ?? {});
      setProjectPath(nextProjectPath);
      projectPathTouchedRef.current = Boolean(routeProjectPath?.trim());
      setMode(firstSession?.mode ?? 'agent');
    },
    [apiSource, routeProjectPath]
  );

  const applyRuntimeControlChanges = useCallback((changes: Partial<WorkbenchSession>) => {
    if (hasSessionChange(changes, 'projectPath') && changes.projectPath !== undefined)
      setProjectPath(changes.projectPath);
    if (hasSessionChange(changes, 'mode') && changes.mode) setMode(changes.mode);
    if (hasSessionChange(changes, 'provider')) {
      setSelectedProvider(changes.provider);
      setTerminalProvider(terminalProviderFrom(changes.provider));
    }
    if (hasSessionChange(changes, 'deviceId')) setSelectedDeviceId(changes.deviceId);
    if (hasSessionChange(changes, 'model')) setSelectedModelId(changes.model);
    if (hasSessionChange(changes, 'reasoningEffort')) setReasoningEffort(changes.reasoningEffort);
    if (hasSessionChange(changes, 'permissionMode') && changes.permissionMode)
      setPermissionMode(changes.permissionMode);
    if (hasSessionChange(changes, 'runtimeOptions'))
      setRuntimeOptions(changes.runtimeOptions ?? {});
  }, []);

  const applyNativeTerminalRuntimeState = useCallback(
    (state: {
      modelId?: string | null;
      reasoningEffort?: ReasoningEffort | null;
      permissionMode?: PermissionMode;
      runtimeOptions?: WorkbenchRuntimeOptions;
    }) => {
      const hasModel = Object.prototype.hasOwnProperty.call(state, 'modelId');
      const hasEffort = Object.prototype.hasOwnProperty.call(state, 'reasoningEffort');
      const hasPermissionMode = Object.prototype.hasOwnProperty.call(state, 'permissionMode');
      const hasRuntimeOptions = Object.prototype.hasOwnProperty.call(state, 'runtimeOptions');
      const nextModel = hasModel
        ? state.modelId === null
          ? modelDefault('codex', models)
          : state.modelId
        : undefined;
      const nextEffort = hasEffort
        ? state.reasoningEffort ??
          reasoningEffortDefault('codex', nextModel ?? selectedModelId, executors, models)
        : undefined;
      const nextServiceTier = state.runtimeOptions?.serviceTier === 'fast' ? 'fast' : undefined;
      const mergeRuntimeOptions = (current?: WorkbenchRuntimeOptions) =>
        compactWorkbenchRuntimeOptions({ ...(current ?? {}), serviceTier: nextServiceTier }) ?? {};

      setSelectedProvider('codex');
      setTerminalProvider('codex');
      if (nextModel !== undefined) setSelectedModelId(nextModel);
      if (hasEffort) setReasoningEffort(nextEffort);
      if (hasPermissionMode && state.permissionMode) setPermissionMode(state.permissionMode);
      if (hasRuntimeOptions) {
        setRuntimeOptions((current) => mergeRuntimeOptions(current));
      }

      if (!activeSessionId) return;
      setSessions((current) =>
        current.map((session) => {
          if (session.id !== activeSessionId || terminalProviderFrom(session.provider) !== 'codex')
            return session;

          const changes: Partial<WorkbenchSession> = {};
          if (nextModel !== undefined) changes.model = nextModel;
          if (hasEffort) changes.reasoningEffort = nextEffort;
          if (hasPermissionMode && state.permissionMode)
            changes.permissionMode = state.permissionMode;
          if (hasRuntimeOptions)
            changes.runtimeOptions = mergeRuntimeOptions(session.runtimeOptions);
          if (!Object.keys(changes).length) return session;
          return { ...session, ...changes, updatedAt: createTimestamp() };
        })
      );
    },
    [activeSessionId, executors, models, selectedModelId, setSessions]
  );

  useEffect(() => {
    if (!activeSession) return;
    syncRuntimeControls(activeSession);
  }, [activeSession, syncRuntimeControls]);

  useEffect(() => {
    if (activeSession) return;
    const nextProvider = selectedProvider ?? providerDefault(apiSource, executors);
    const nextModel = selectedModelId ?? modelDefault(nextProvider, models);
    if (!selectedProvider) setSelectedProvider(nextProvider);
    if (!selectedModelId) setSelectedModelId(nextModel);
    if (!reasoningEffort) {
      setReasoningEffort(reasoningEffortDefault(nextProvider, nextModel, executors, models));
    }
  }, [
    activeSession,
    apiSource,
    executors,
    models,
    reasoningEffort,
    selectedModelId,
    selectedProvider,
  ]);

  useEffect(() => {
    if (
      selectedProvider === 'codex' ||
      selectedProvider === 'claude-code' ||
      selectedProvider === 'claude'
    ) {
      setTerminalProvider(terminalProviderFrom(selectedProvider));
    }
  }, [selectedProvider]);

  useEffect(() => {
    if (activeSession || projectPathTouchedRef.current || projectPath.trim()) return;
    const nextProjectPath = workbenchProjectPathDefault({
      routeProjectPath,
      devices,
      routeDeviceId,
    });
    if (!nextProjectPath) return;
    setProjectPath(nextProjectPath);
    if (selectedDeviceId) return;
    const routeDevice = routeDeviceId
      ? devices.find((device) => device.id === routeDeviceId)
      : undefined;
    const nextDevice = routeDevice ?? devices.find(isReadyWorkbenchDevice);
    if (nextDevice?.id) setSelectedDeviceId(nextDevice.id);
  }, [activeSession, devices, projectPath, routeDeviceId, routeProjectPath, selectedDeviceId]);

  const handleProjectPathChange = useCallback((value: string) => {
    projectPathTouchedRef.current = true;
    setProjectPath(value);
  }, []);

  const handleDeviceChange = useCallback(
    (deviceId: string) => {
      setSelectedDeviceId(deviceId || undefined);
      if (activeSession || projectPathTouchedRef.current) return;
      const nextDevice = deviceId
        ? devices.find((device) => device.id === deviceId)
        : devices.find(isReadyWorkbenchDevice);
      if (nextDevice?.workRoot?.trim()) setProjectPath(nextDevice.workRoot);
    },
    [activeSession, devices]
  );

  const resetRuntimeForNewSession = useCallback(() => {
    const nextProjectPath = workbenchProjectPathDefault({
      routeProjectPath,
      devices,
      routeDeviceId,
    });
    const routeDevice = routeDeviceId
      ? devices.find((device) => device.id === routeDeviceId)
      : undefined;
    const nextDevice = routeDevice ?? devices.find(isReadyWorkbenchDevice);
    setProjectPath(nextProjectPath);
    setSelectedDeviceId(nextDevice?.id);
    projectPathTouchedRef.current = Boolean(routeProjectPath?.trim());
  }, [devices, routeDeviceId, routeProjectPath]);

  async function handleProviderChange(provider: string) {
    const nextModel = modelDefault(provider, models);
    setSelectedProvider(provider);
    setTerminalProvider(terminalProviderFrom(provider));
    setSelectedModelId(nextModel);
    setReasoningEffort((current) =>
      normalizeReasoningEffort(current, provider, nextModel, executors, models) ??
      reasoningEffortDefault(provider, nextModel, executors, models)
    );
    if (provider !== 'codex') {
      setRuntimeOptions(
        (current) =>
          compactWorkbenchRuntimeOptions({
            ...current,
            webSearch: undefined,
            serviceTier: undefined,
          }) ?? {}
      );
    }
  }

  async function handleModelChange(modelId: string) {
    const provider =
      activeSession?.provider ?? selectedProvider ?? (apiSource === 'mock' ? 'mock' : undefined);
    const targetModelId = modelId === 'provider default' ? modelDefault(provider, models) : modelId;
    setSelectedModelId(targetModelId);
    setReasoningEffort((current) =>
      normalizeReasoningEffort(current, provider, targetModelId, executors, models) ??
      reasoningEffortDefault(provider, targetModelId, executors, models)
    );
    if (!activeSession || !targetModelId || targetModelId === activeSession.model) return;
    setBusyAction('model');
    setLoadError('');
    try {
      const updated = await api.switchModel(activeSession.id, targetModelId);
      setSessions((current) =>
        current.map((session) => (session.id === updated.id ? updated : session))
      );
      syncRuntimeControls(updated);
      setNotice(
        t.workbench.messages.modelSet(
          modelId === 'provider default' ? t.workbench.common.providerDefault : targetModelId
        )
      );
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errorSwitchModel));
      setSelectedModelId(activeSession.model);
      setReasoningEffort(activeSession.reasoningEffort);
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleReasoningEffortChange(effort?: ReasoningEffort) {
    const provider =
      activeSession?.provider ?? selectedProvider ?? (apiSource === 'mock' ? 'mock' : undefined);
    const modelId = activeSession?.model ?? selectedModelId;
    const normalizedEffort = normalizeReasoningEffort(effort, provider, modelId, executors, models);
    setReasoningEffort(normalizedEffort);
    if (!activeSession || normalizedEffort === activeSession.reasoningEffort) return;
    setBusyAction('effort');
    setLoadError('');
    try {
      const updated = await api.switchReasoningEffort(activeSession.id, normalizedEffort);
      setSessions((current) =>
        current.map((session) => (session.id === updated.id ? updated : session))
      );
      syncRuntimeControls(updated);
      setNotice(
        t.workbench.messages.effortSet(
          normalizedEffort
            ? t.workbench.effortLabels[normalizedEffort]
            : t.workbench.effortLabels.default
        )
      );
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errorSwitchEffort));
      setReasoningEffort(activeSession.reasoningEffort);
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handlePermissionModeChange(nextMode: PermissionMode) {
    const currentMode = activeSession?.mode ?? mode;
    const normalizedMode: PermissionMode =
      currentMode === 'plan' || currentMode === 'review' ? 'read-only' : nextMode;
    setPermissionMode(normalizedMode);
    if (!activeSession || normalizedMode === activeSession.permissionMode) return;
    setBusyAction('permission');
    setLoadError('');
    try {
      const updated = await api.switchPermissionMode(activeSession.id, normalizedMode);
      setSessions((current) =>
        current.map((session) => (session.id === updated.id ? updated : session))
      );
      syncRuntimeControls(updated);
      setNotice(
        `${t.workbench.header.permission}: ${permissionModeLabel(updated.permissionMode, t)}`
      );
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.updatePermissionRule));
      setPermissionMode(activeSession.permissionMode);
    } finally {
      setBusyAction(undefined);
    }
  }

  function handleRuntimeOptionsChange(nextOptions: WorkbenchRuntimeOptions) {
    const compacted = compactWorkbenchRuntimeOptions(nextOptions) ?? {};
    setRuntimeOptions(compacted);

    if (!activeSession) return;

    const sessionId = activeSession.id;
    scheduleRuntimeUpdate(() => {
      setBusyAction('runtime');
      setLoadError('');
      void api
        .switchRuntimeOptions(sessionId, compactWorkbenchRuntimeOptions(compacted))
        .then((updated) => {
          setSessions((current) =>
            current.map((session) => (session.id === updated.id ? updated : session))
          );
          syncRuntimeControls(updated);
          setNotice(tRef.current.workbench.v2.runtimeOptionsUpdated);
        })
        .catch((error) => {
          setLoadError(getErrorMessage(error, tRef.current.workbench.errors.sendMessage));
          setRuntimeOptions(activeSession.runtimeOptions ?? {});
        })
        .finally(() => {
          setBusyAction(undefined);
        });
    }, 500);
  }

  async function checkWorktreeBeforeStart(nextProjectPath: string): Promise<WorktreeStartCheck> {
    try {
      const status = await api.getWorktreeStatus(nextProjectPath, selectedDeviceId);
      const warning = worktreeWarningText(
        status.dirty,
        status.statusText,
        status.warning,
        t.workbench.worktreeWarning.title
      );
      setWorktreeWarning(warning);
      if (!status.dirty) return { allowed: true, allowDirtyWorktree: false };
      return {
        allowed: true,
        allowDirtyWorktree: true,
      };
    } catch {
      setWorktreeWarning(undefined);
      return { allowed: true, allowDirtyWorktree: false };
    }
  }

  return {
    mode,
    setMode,
    projectPath,
    handleProjectPathChange,
    selectedDeviceId,
    handleDeviceChange,
    selectedProvider,
    setSelectedProvider,
    terminalProvider,
    setTerminalProvider,
    selectedModelId,
    setSelectedModelId,
    reasoningEffort,
    setReasoningEffort,
    permissionMode,
    runtimeOptions,
    setRuntimeOptions,
    useRag,
    setUseRag,
    ragTopK,
    setRagTopK,
    worktreeWarning,
    syncRuntimeControls,
    initializeRuntimeControls,
    applyRuntimeControlChanges,
    applyNativeTerminalRuntimeState,
    handleProviderChange,
    handleModelChange,
    handleReasoningEffortChange,
    handlePermissionModeChange,
    handleRuntimeOptionsChange,
    checkWorktreeBeforeStart,
    resetRuntimeForNewSession,
  };
}
