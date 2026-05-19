import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListTree, TerminalSquare } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { AgentTimeline } from '../components/agent-workbench/workbench-v2/AgentTimeline.tsx';
import {
  getAgentWorkbenchApi,
  type AgentWorkbenchApiSource,
} from '../components/agent-workbench/workbench-v2/agentWorkbenchApi.ts';
import { ComposerInput } from '../components/agent-workbench/workbench-v2/ComposerInput.tsx';
import {
  InspectorPanel,
  type InspectorTab,
} from '../components/agent-workbench/workbench-v2/InspectorPanel.tsx';
import { NativeTerminal } from '../components/agent-workbench/workbench-v2/NativeTerminal.tsx';
import { SessionSidebar } from '../components/agent-workbench/workbench-v2/SessionSidebar.tsx';
import { WorkbenchRunBar } from '../components/agent-workbench/workbench-v2/WorkbenchRunBar.tsx';
import { useWorkbenchInitialLoad } from '../components/agent-workbench/workbench-v2/useWorkbenchInitialLoad.ts';
import { useWorkbenchInspectorData } from '../components/agent-workbench/workbench-v2/useWorkbenchInspectorData.ts';
import { useWorkbenchFileContent } from '../components/agent-workbench/workbench-v2/useWorkbenchFileContent.ts';
import { useWorkbenchPermissionActions } from '../components/agent-workbench/workbench-v2/useWorkbenchPermissionActions.ts';
import { useWorkbenchReviewActions } from '../components/agent-workbench/workbench-v2/useWorkbenchReviewActions.ts';
import { useWorkbenchRuntimeControls } from '../components/agent-workbench/workbench-v2/useWorkbenchRuntimeControls.ts';
import { useWorkbenchSessionComposer } from '../components/agent-workbench/workbench-v2/useWorkbenchSessionComposer.ts';
import { useWorkbenchSessionData } from '../components/agent-workbench/workbench-v2/useWorkbenchSessionData.ts';
import { useWorkbenchSessionLifecycle } from '../components/agent-workbench/workbench-v2/useWorkbenchSessionLifecycle.ts';
import { useWorkbenchSessionPanelActions } from '../components/agent-workbench/workbench-v2/useWorkbenchSessionPanelActions.ts';
import { useWorkbenchSlashCommandCatalog } from '../components/agent-workbench/workbench-v2/useWorkbenchSlashCommandCatalog.ts';
import { useWorkbenchSlashCommands } from '../components/agent-workbench/workbench-v2/useWorkbenchSlashCommands.ts';
import { useWorkbenchTimers } from '../components/agent-workbench/workbench-v2/useWorkbenchTimers.ts';
import { usePersistentBoolean } from '../hooks/usePersistentBoolean.ts';
import { useT } from '../i18n/index.ts';
import type {
  WorkbenchDevice,
  WorkbenchExecutor,
  WorkbenchModel,
  WorkbenchSession,
} from '../components/agent-workbench/workbench-v2/types.ts';

type MainPanelTab = 'timeline' | 'terminal';
type BusyAction =
  | 'diff'
  | 'discard'
  | 'permission'
  | 'compact'
  | 'export'
  | 'init-plan'
  | 'init-apply'
  | 'model'
  | 'effort'
  | 'runtime'
  | 'stop';

export default function AgentWorkbenchPage() {
  const { t } = useT();
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const apiSource: AgentWorkbenchApiSource = useMemo(
    () => (searchParams.get('mock') === '1' ? 'mock' : 'real'),
    [searchParams]
  );
  const api = useMemo(() => getAgentWorkbenchApi(apiSource), [apiSource]);
  const routeSessionId = searchParams.get('sessionId') ?? undefined;
  const routeDeviceId = searchParams.get('deviceId') ?? undefined;
  const routeHasProjectPath = searchParams.has('projectPath') || searchParams.has('cwd');
  const routeProjectPath = searchParams.get('projectPath') ?? searchParams.get('cwd') ?? undefined;

  const {
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId,
    eventsBySession,
    setEventsBySession,
    selectedItemId,
    setSelectedItemId,
    activeSession,
    timelineItems,
    selectedItem,
    running,
    updateSession,
    appendEvent,
    loadSessionEvents,
    refreshSessions,
  } = useWorkbenchSessionData(api);
  const [devices, setDevices] = useState<WorkbenchDevice[]>([]);
  const [executors, setExecutors] = useState<WorkbenchExecutor[]>([]);
  const [models, setModels] = useState<WorkbenchModel[]>([]);
  const [mainPanelTab, setMainPanelTab] = useState<MainPanelTab>('timeline');
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [notice, setNotice] = useState('');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('files');
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    logs,
    sessionDiff,
    permissionRules,
    permissionHits,
    summaries,
    usage,
    initPlan,
    setSessionDiff,
    setPermissionRules,
    setSummaries,
    setInitPlan,
    resetInspectorData,
    refreshInspectorData,
  } = useWorkbenchInspectorData(api);
  const [busyAction, setBusyAction] = useState<BusyAction>();
  const [processingApprovalId, setProcessingApprovalId] = useState<string>();
  const [loadError, setLoadError] = useState('');
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const {
    schedule,
    clearScheduled: clearScheduledMockEvents,
    scheduleRuntimeUpdate,
  } = useWorkbenchTimers();
  const {
    mode,
    setMode,
    projectPath,
    handleProjectPathChange,
    selectedDeviceId,
    handleDeviceChange,
    selectedProvider,
    terminalProvider,
    setTerminalProvider,
    selectedModelId,
    reasoningEffort,
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
  } = useWorkbenchRuntimeControls({
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
    setBusyAction: (value) => setBusyAction(value),
    setLoadError,
    setNotice,
    scheduleRuntimeUpdate,
  });
  const { slashCommands, setSlashCommands } = useWorkbenchSlashCommandCatalog({
    api,
    selectedProvider,
    projectPath,
  });
  const applySessionUpdate = useCallback(
    (sessionId: string, changes: Partial<WorkbenchSession>) => {
      updateSession(sessionId, changes);
      if (sessionId !== activeSessionId) return;
      applyRuntimeControlChanges(changes);
    },
    [activeSessionId, applyRuntimeControlChanges, updateSession]
  );
  const {
    streamState,
    setStreamStateIdle,
    handleSelectTimelineItem,
    handleSelectSession,
    handleNewSession,
    handleStop,
    handleApprovalDecision,
  } = useWorkbenchSessionLifecycle({
    api,
    apiSource,
    activeSessionId,
    running,
    sessions,
    timelineItems,
    selectedItemId,
    setSessions,
    setEventsBySession,
    setActiveSessionId: (sessionId) => setActiveSessionId(sessionId),
    setSelectedItemId,
    setLoadError,
    setNotice,
    setBusyAction: (value) => setBusyAction(value),
    setProcessingApprovalId,
    setInspectorTab,
    setMode,
    setRuntimeOptions,
    setSessionDiff,
    resetInspectorData,
    refreshInspectorData,
    syncRuntimeControls,
    applySessionUpdate,
    updateSession,
    appendEvent,
    loadSessionEvents,
    refreshSessions,
    schedule,
    clearScheduledMockEvents,
    resetRuntimeForNewSession,
  });
  const { handleRefreshDiff, handleOpenFile, handleDiscardFile, handleDiscardAll } =
    useWorkbenchReviewActions({
      api,
      activeSessionId,
      setSessionDiff,
      setEventsBySession,
      setBusyAction: (value) => setBusyAction(value),
      setLoadError,
      setNotice,
      setInspectorTab,
    });
  const { handleCompact, handleExport, handlePlanInitClaude, handleApplyInitClaude } =
    useWorkbenchSessionPanelActions({
      api,
      activeSessionId,
      setSummaries,
      setInitPlan,
      setBusyAction: (value) => setBusyAction(value),
      setLoadError,
      setNotice,
      setInspectorTab,
      appendEvent,
    });
  const { handleCreatePermissionRule, handleTogglePermissionRule, handleDeletePermissionRule } =
    useWorkbenchPermissionActions({
      api,
      setPermissionRules,
      setBusyAction: (value) => setBusyAction(value),
      setLoadError,
    });
  const { handleReadFileContent } = useWorkbenchFileContent({
    api,
    apiSource,
    activeSessionId,
    eventsBySession,
  });
  const handleSlashCommand = useWorkbenchSlashCommands({
    api,
    slashCommands,
    sessions,
    activeSessionId,
    setSessions,
    setActiveSessionId: (sessionId) => setActiveSessionId(sessionId),
    setEventsBySession,
    setSelectedItemId,
    setLoadError,
    setNotice,
    setInspectorTab,
    syncRuntimeControls,
    appendEvent,
    refreshInspectorData,
    handleRefreshDiff,
    handleCompact,
    handleExport,
    handleSelectSession,
  });
  const handleSend = useWorkbenchSessionComposer({
    api,
    apiSource,
    activeSession,
    activeSessionId,
    mode,
    setMode,
    projectPath,
    selectedProvider,
    selectedModelId,
    reasoningEffort,
    executors,
    models,
    runtimeOptions,
    permissionMode,
    selectedDeviceId,
    useRag,
    ragTopK,
    setSessions,
    setActiveSessionId: (sessionId) => setActiveSessionId(sessionId),
    setSelectedItemId,
    setEventsBySession,
    setLoadError,
    setNotice,
    appendEvent,
    loadSessionEvents,
    refreshInspectorData,
    refreshSessions,
    syncRuntimeControls,
    schedule,
    checkWorktreeBeforeStart,
    handleSlashCommand,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentBoolean(
    'rac:workbench:sidebarCollapsed'
  );
  const [inspectorCollapsed, setInspectorCollapsed] = usePersistentBoolean(
    'rac:workbench:inspectorCollapsed'
  );
  const handleStartRunAction = useCallback(() => {
    setMainPanelTab('timeline');
    window.requestAnimationFrame(() => composerInputRef.current?.focus());
  }, []);
  const handleInspectProjectAction = useCallback(() => {
    setMainPanelTab('timeline');
    void handleSend('Inspect this project and summarize the structure, risks, and recommended next steps.');
  }, [handleSend]);
  const handleReviewLogsAction = useCallback(() => {
    setInspectorCollapsed(false);
    setInspectorTab('logs');
  }, [setInspectorCollapsed]);
  useWorkbenchInitialLoad({
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
  });

  useEffect(() => {
    if (!selectedDeviceId) return undefined;
    let cancelled = false;
    api
      .listModels(undefined, selectedDeviceId)
      .then((loadedModels) => {
        if (!cancelled) setModels(loadedModels);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedDeviceId]);

  const floatingStatus = loadError || notice;

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  return (
    <div
      data-testid="agent-workbench-v2"
      className="agent-workbench-shell relative flex h-full min-h-0 flex-col gap-2"
    >
      {floatingStatus && (
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-50 flex justify-end">
          <div
            role={loadError ? 'alert' : 'status'}
            aria-live={loadError ? 'assertive' : 'polite'}
            className={`pointer-events-auto max-w-full rounded-sm border px-3 py-2 text-sm shadow-lg backdrop-blur sm:max-w-md ${
              loadError
                ? 'border-danger/30 bg-danger-soft text-danger'
                : 'border-info/30 bg-info-soft text-info'
            }`}
          >
            <span className="block min-w-0 break-words">{floatingStatus}</span>
          </div>
        </div>
      )}

      <div
        className={
          sidebarCollapsed && inspectorCollapsed
            ? 'workbench-grid-shell grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[44px_minmax(0,1fr)] xl:grid-cols-[44px_minmax(0,1fr)_44px]'
            : sidebarCollapsed
              ? 'workbench-grid-shell grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[44px_minmax(0,1fr)] xl:grid-cols-[44px_minmax(0,1fr)_minmax(320px,25%)]'
              : inspectorCollapsed
                ? 'workbench-grid-shell grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[270px_minmax(0,1fr)] xl:grid-cols-[minmax(260px,25%)_minmax(0,1fr)_44px]'
                : 'workbench-grid-shell grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[270px_minmax(0,1fr)] xl:grid-cols-[minmax(260px,25%)_minmax(420px,1fr)_minmax(320px,25%)]'
        }
      >
        <SessionSidebar
          key={sidebarCollapsed ? 'sidebar-rail' : 'sidebar-expanded'}
          sessions={sessions}
          activeSessionId={activeSessionId}
          collapsed={sidebarCollapsed}
          loading={sessionsLoading}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          onSelectSession={(sessionId) => void handleSelectSession(sessionId)}
          onNewSession={() => void handleNewSession()}
        />

        <main className="agent-panel relative z-20 flex min-h-0 min-w-0 flex-col overflow-visible">
          <WorkbenchRunBar
            session={activeSession}
            projectPath={activeSession?.projectPath ?? projectPath}
            projectPathLocked={Boolean(activeSession)}
            mode={mode}
            streamState={streamState}
            apiSource={apiSource}
            devices={devices}
            executors={executors}
            models={models}
            selectedDeviceId={selectedDeviceId}
            selectedProvider={selectedProvider}
            selectedModelId={selectedModelId}
            reasoningEffort={reasoningEffort}
            runtimeOptions={runtimeOptions}
            worktreeWarning={worktreeWarning}
            onProjectPathChange={handleProjectPathChange}
            onDeviceChange={handleDeviceChange}
            onProviderChange={(provider) => void handleProviderChange(provider)}
            onModelChange={(modelId) => void handleModelChange(modelId)}
            onReasoningEffortChange={(effort) => void handleReasoningEffortChange(effort)}
          />
          <div className="flex flex-shrink-0 items-center gap-1 border-b border-border-soft bg-bg-surface-1 px-3 pt-1.5">
            {(['timeline', 'terminal'] as MainPanelTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-current={mainPanelTab === tab ? 'page' : undefined}
                className={`inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-xs font-semibold transition-colors ${
                  mainPanelTab === tab
                    ? 'border-accent text-text-primary'
                    : 'border-transparent text-text-tertiary hover:text-text-primary'
                }`}
                onClick={() => {
                  setMainPanelTab(tab);
                  if (tab === 'terminal') setTerminalOpened(true);
                }}
              >
                {tab === 'timeline' ? (
                  <ListTree aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <TerminalSquare aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                {tab === 'timeline' ? t.workbench.v2.timelineTab : t.workbench.v2.remoteTuiTab}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className={mainPanelTab === 'timeline' ? 'h-full min-h-0' : 'hidden'}>
              <AgentTimeline
                items={timelineItems}
                selectedItemId={selectedItem?.id}
                approvalProcessingId={processingApprovalId}
                running={running}
                onSelectItem={handleSelectTimelineItem}
                onApprovalDecision={(approvalId, decision) =>
                  void handleApprovalDecision(approvalId, decision)
                }
                onStartRun={handleStartRunAction}
                onInspectProject={handleInspectProjectAction}
                onReviewLogs={handleReviewLogsAction}
              />
            </div>
            {terminalOpened && (
              <div className={mainPanelTab === 'terminal' ? 'h-full min-h-0' : 'hidden'}>
                <NativeTerminal
                  active={mainPanelTab === 'terminal'}
                  provider={terminalProvider}
                  projectPath={activeSession?.projectPath ?? projectPath}
                  deviceId={activeSession?.deviceId ?? selectedDeviceId}
                  sessionId={activeSession?.id}
                  apiSource={apiSource}
                  onProviderChange={setTerminalProvider}
                  onRuntimeStateChange={applyNativeTerminalRuntimeState}
                />
              </div>
            )}
          </div>
          <ComposerInput
            inputRef={composerInputRef}
            session={activeSession}
            mode={mode}
            running={running}
            stopping={busyAction === 'stop'}
            initializing={sessionsLoading}
            slashCommands={slashCommands}
            projectPath={activeSession?.projectPath ?? projectPath}
            projectPathLocked={Boolean(activeSession)}
            streamState={streamState}
            apiSource={apiSource}
            devices={devices}
            executors={executors}
            models={models}
            selectedDeviceId={selectedDeviceId}
            selectedProvider={selectedProvider}
            selectedModelId={selectedModelId}
            reasoningEffort={reasoningEffort}
            permissionMode={permissionMode}
            runtimeOptions={runtimeOptions}
            usage={usage}
            useRag={useRag}
            ragTopK={ragTopK}
            onModeChange={setMode}
            onProjectPathChange={handleProjectPathChange}
            onDeviceChange={handleDeviceChange}
            onProviderChange={(provider) => void handleProviderChange(provider)}
            onModelChange={(modelId) => void handleModelChange(modelId)}
            onReasoningEffortChange={(effort) => void handleReasoningEffortChange(effort)}
            onPermissionModeChange={(nextMode) => void handlePermissionModeChange(nextMode)}
            onRuntimeOptionsChange={handleRuntimeOptionsChange}
            onUseRagChange={setUseRag}
            onRagTopKChange={setRagTopK}
            onSend={(value) => void handleSend(value)}
            onStop={() => void handleStop()}
          />
        </main>

        <div className="min-h-[420px] overflow-hidden xl:min-h-0">
          <InspectorPanel
            key={inspectorCollapsed ? 'inspector-rail' : 'inspector-expanded'}
            session={activeSession}
            selectedItem={selectedItem}
            items={timelineItems}
            collapsed={inspectorCollapsed}
            onToggleCollapse={() => setInspectorCollapsed((v) => !v)}
            activeTab={inspectorTab}
            logs={logs}
            diff={sessionDiff}
            permissionRules={permissionRules}
            permissionHits={permissionHits}
            summaries={summaries}
            usage={usage}
            initPlan={initPlan}
            busyAction={busyAction}
            onTabChange={setInspectorTab}
            onRefreshDiff={() => void handleRefreshDiff()}
            onOpenFile={(filePath) => void handleOpenFile(filePath)}
            onDiscardFile={(filePath) => void handleDiscardFile(filePath)}
            onDiscardAll={() => void handleDiscardAll()}
            onCreatePermissionRule={(input) => void handleCreatePermissionRule(input)}
            onTogglePermissionRule={(rule) => void handleTogglePermissionRule(rule)}
            onDeletePermissionRule={(ruleId) => void handleDeletePermissionRule(ruleId)}
            onCompact={() => void handleCompact()}
            onExport={(options, delivery) => void handleExport(options, delivery)}
            onPlanInitClaude={() => void handlePlanInitClaude()}
            onApplyInitClaude={() => void handleApplyInitClaude()}
            onReadFileContent={(filePath) => handleReadFileContent(filePath)}
          />
        </div>
      </div>
    </div>
  );
}
