import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { AgentWorkbenchApiSource } from './agentWorkbenchApi.ts';
import type {
  AgentWorkbenchApi,
  TimelineEvent,
  WorkbenchDevice,
  WorkbenchExecutor,
  WorkbenchModel,
  WorkbenchSession,
} from './types.ts';
import type { SlashCommand } from '../../../types.ts';
import { useLatestRef } from '../../../hooks/useLatestRef.ts';
import { useT } from '../../../i18n/index.ts';
import { getErrorMessage } from '../../../lib/format.ts';

export function useWorkbenchInitialLoad({
  api,
  apiSource,
  routeSessionId,
  routeDeviceId,
  routeHasProjectPath,
  setSessions,
  setDevices,
  setExecutors,
  setModels,
  setSlashCommands,
  setActiveSessionId,
  setSelectedItemId,
  setEventsBySession,
  setSessionsLoading,
  setLoadError,
  setNotice,
  setStreamStateIdle,
  resetInspectorData,
  initializeRuntimeControls,
}: {
  api: AgentWorkbenchApi;
  apiSource: AgentWorkbenchApiSource;
  routeSessionId?: string;
  routeDeviceId?: string;
  routeHasProjectPath: boolean;
  setSessions: Dispatch<SetStateAction<WorkbenchSession[]>>;
  setDevices: Dispatch<SetStateAction<WorkbenchDevice[]>>;
  setExecutors: Dispatch<SetStateAction<WorkbenchExecutor[]>>;
  setModels: Dispatch<SetStateAction<WorkbenchModel[]>>;
  setSlashCommands: Dispatch<SetStateAction<SlashCommand[]>>;
  setActiveSessionId: (sessionId: string | undefined) => void;
  setSelectedItemId: (itemId: string | undefined) => void;
  setEventsBySession: Dispatch<SetStateAction<Record<string, TimelineEvent[]>>>;
  setSessionsLoading: (loading: boolean) => void;
  setLoadError: (value: string) => void;
  setNotice: (value: string) => void;
  setStreamStateIdle: () => void;
  resetInspectorData: () => void;
  initializeRuntimeControls: (input: {
    firstSession?: WorkbenchSession;
    loadedDevices: WorkbenchDevice[];
    loadedExecutors: WorkbenchExecutor[];
    loadedModels: WorkbenchModel[];
    routeDeviceId?: string;
  }) => void;
}) {
  const { t } = useT();
  const tRef = useLatestRef(t);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    setNotice('');
    setStreamStateIdle();
    setActiveSessionId(undefined);
    setSelectedItemId(undefined);
    setEventsBySession({});
    setSessionsLoading(true);
    resetInspectorData();

    async function loadInitialData() {
      let coreData:
        | {
            firstSession?: WorkbenchSession;
            loadedDevices: WorkbenchDevice[];
          }
        | undefined;
      let runtimeData:
        | {
            loadedExecutors: WorkbenchExecutor[];
            loadedModels: WorkbenchModel[];
          }
        | undefined;

      function maybeInitializeRuntimeControls() {
        if (cancelled || !coreData || !runtimeData) return;
        initializeRuntimeControls({
          firstSession: coreData.firstSession,
          loadedDevices: coreData.loadedDevices,
          loadedExecutors: runtimeData.loadedExecutors,
          loadedModels: runtimeData.loadedModels,
          routeDeviceId,
        });
      }

      const loadedDevicesPromise = api.listDevices().catch(() => [] as WorkbenchDevice[]);

      void loadedDevicesPromise.then((loadedDevices) => {
        if (cancelled) return;
        setDevices(loadedDevices);
        coreData = { firstSession: undefined, loadedDevices };
        maybeInitializeRuntimeControls();
      });

      const loadedSessionsPromise = api.listSessions().catch((error) => {
        if (!cancelled) {
          setLoadError(getErrorMessage(error, tRef.current.workbench.errors.loadSessions));
        }
        return [] as WorkbenchSession[];
      });
      const loadedExecutorsPromise = api.listExecutors().catch(() => [] as WorkbenchExecutor[]);
      const loadedModelsPromise = api.listModels().catch(() => [] as WorkbenchModel[]);
      const loadedSlashCommandsPromise = api.listSlashCommands().catch(() => [] as SlashCommand[]);

      void Promise.all([
        loadedExecutorsPromise,
        loadedModelsPromise,
        loadedSlashCommandsPromise,
      ]).then(([loadedExecutors, loadedModels, loadedSlashCommands]) => {
        if (cancelled) return;
        setExecutors(loadedExecutors);
        setModels(loadedModels);
        setSlashCommands(loadedSlashCommands);
        runtimeData = { loadedExecutors, loadedModels };
        maybeInitializeRuntimeControls();
      });

      try {
        const [loadedSessions, loadedDevices] = await Promise.all([
          loadedSessionsPromise,
          loadedDevicesPromise,
        ]);
        if (cancelled) return;

        setSessions(loadedSessions);
        setDevices(loadedDevices);

        const routedSession = routeSessionId
          ? loadedSessions.find((session) => session.id === routeSessionId)
          : undefined;
        const shouldOpenNewSession =
          !routeSessionId && (Boolean(routeDeviceId) || routeHasProjectPath);
        const firstSession =
          routedSession ?? (shouldOpenNewSession ? undefined : loadedSessions[0]);
        coreData = { firstSession, loadedDevices };
        maybeInitializeRuntimeControls();

        const initialSessionId = firstSession?.id ?? routeSessionId;
        if (!initialSessionId) return;
        setActiveSessionId(initialSessionId);
        const events = await api.getSessionEvents(initialSessionId);
        if (cancelled) return;
        setEventsBySession({ [initialSessionId]: events });
      } catch (error) {
        if (!cancelled) {
          setSessions([]);
          setLoadError(getErrorMessage(error, tRef.current.workbench.errorLoad));
        }
      } finally {
        if (!cancelled) {
          setSessionsLoading(false);
        }
      }
    }

    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, [
    api,
    apiSource,
    initializeRuntimeControls,
    resetInspectorData,
    routeDeviceId,
    routeHasProjectPath,
    routeSessionId,
    setActiveSessionId,
    setDevices,
    setEventsBySession,
    setExecutors,
    setLoadError,
    setModels,
    setNotice,
    setSelectedItemId,
    setSessions,
    setSessionsLoading,
    setSlashCommands,
    setStreamStateIdle,
    tRef,
  ]);
}
