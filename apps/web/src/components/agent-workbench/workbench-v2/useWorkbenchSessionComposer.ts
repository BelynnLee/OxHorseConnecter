import type { Dispatch, SetStateAction } from 'react';
import type {
  AgentWorkbenchApi,
  PermissionMode,
  ReasoningEffort,
  TimelineEvent,
  UserMessageEvent,
  WorkbenchExecutor,
  WorkbenchModel,
  WorkbenchRuntimeOptions,
  WorkbenchSession,
  WorkbenchStatus,
} from './types.ts';
import {
  compactWorkbenchRuntimeOptions,
  createId,
  createTimestamp,
  normalizeReasoningEffort,
  reasoningEffortDefault,
  titleFromPrompt,
} from './workbenchPageUtils.ts';
import { useT } from '../../../i18n/index.ts';
import { getErrorMessage } from '../../../lib/format.ts';

type WorktreeStartCheck = { allowed: boolean; allowDirtyWorktree: boolean };

export function useWorkbenchSessionComposer({
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
  setActiveSessionId,
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
}: {
  api: AgentWorkbenchApi;
  apiSource: 'real' | 'mock';
  activeSession?: WorkbenchSession;
  activeSessionId?: string;
  mode: WorkbenchSession['mode'];
  setMode: (mode: WorkbenchSession['mode']) => void;
  projectPath: string;
  selectedProvider?: string;
  selectedModelId?: string;
  reasoningEffort?: ReasoningEffort;
  executors: WorkbenchExecutor[];
  models: WorkbenchModel[];
  runtimeOptions: WorkbenchRuntimeOptions;
  permissionMode: PermissionMode;
  selectedDeviceId?: string;
  useRag: boolean;
  ragTopK: number;
  setSessions: Dispatch<SetStateAction<WorkbenchSession[]>>;
  setActiveSessionId: (sessionId: string) => void;
  setSelectedItemId: (itemId: string | undefined) => void;
  setEventsBySession: Dispatch<SetStateAction<Record<string, TimelineEvent[]>>>;
  setLoadError: (value: string) => void;
  setNotice: (value: string) => void;
  appendEvent: (sessionId: string, event: TimelineEvent, options?: { select?: boolean }) => void;
  loadSessionEvents: (
    sessionId: string,
    options?: { replace?: boolean }
  ) => Promise<TimelineEvent[]>;
  refreshInspectorData: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  syncRuntimeControls: (session: WorkbenchSession) => void;
  schedule: (callback: () => void, delayMs: number) => void;
  checkWorktreeBeforeStart: (projectPath: string) => Promise<WorktreeStartCheck>;
  handleSlashCommand: (content: string) => Promise<boolean>;
}) {
  const { t } = useT();

  function setSessionStatus(sessionId: string, status: WorkbenchStatus) {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId ? { ...session, status, updatedAt: createTimestamp() } : session
      )
    );
  }

  function simulateMockAgentTurn(sessionId: string, cwd: string) {
    const turnId = createId('turn');
    setSessionStatus(sessionId, 'running');

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-reasoning`,
          sessionId,
          type: 'reasoning_summary',
          timestamp: createTimestamp(),
          content: `${t.workbench.conversation.labels.summary}: ${t.workbench.v2.mockTurnQueued}`,
        },
        { select: true }
      );
    }, 240);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-msg-a`,
          sessionId,
          type: 'message_delta',
          timestamp: createTimestamp(),
          role: 'assistant',
          content: `${t.workbench.v2.mockTurnQueued} `,
        },
        { select: true }
      );
    }, 520);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-msg-b`,
          sessionId,
          type: 'message_delta',
          timestamp: createTimestamp(),
          role: 'assistant',
          content: t.workbench.v2.mockTurnTypedEvents,
        },
        { select: true }
      );
    }, 780);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-tool-start`,
          sessionId,
          type: 'tool_call_started',
          timestamp: createTimestamp(),
          toolCallId: `${turnId}-tool`,
          name: 'mock.inspectFiles',
          input: { files: ['apps/web/src/pages/AgentWorkbenchPage.tsx'] },
        },
        { select: true }
      );
    }, 1020);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-tool-complete`,
          sessionId,
          type: 'tool_call_completed',
          timestamp: createTimestamp(),
          toolCallId: `${turnId}-tool`,
          name: 'mock.inspectFiles',
          output: { matched: 1, notes: t.workbench.v2.mockWorkbenchEntryActive },
          status: 'success',
        },
        { select: true }
      );
    }, 1250);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-cmd-start`,
          sessionId,
          type: 'command_started',
          timestamp: createTimestamp(),
          commandId: `${turnId}-cmd`,
          cwd,
          command: 'pnpm typecheck:web',
          riskLevel: 'safe',
        },
        { select: true }
      );
    }, 1480);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-cmd-out`,
          sessionId,
          type: 'command_output',
          timestamp: createTimestamp(),
          commandId: `${turnId}-cmd`,
          stream: 'stdout',
          content: `${t.workbench.stateMessages.completed}.\n`,
        },
        { select: true }
      );
    }, 1710);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-cmd-done`,
          sessionId,
          type: 'command_completed',
          timestamp: createTimestamp(),
          commandId: `${turnId}-cmd`,
          exitCode: 0,
          durationMs: 1800,
        },
        { select: true }
      );
    }, 1920);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-diff`,
          sessionId,
          type: 'file_diff_created',
          timestamp: createTimestamp(),
          filePath: 'apps/web/src/components/agent-workbench/workbench-v2/mock-response.ts',
          changeType: 'added',
          patch: [
            'diff --git a/mock-response.ts b/mock-response.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/mock-response.ts',
            '@@ -0,0 +1,3 @@',
            '+export const status = "simulated";',
            '+export const source = "ComposerInput";',
            '+export const prompt = "user request";',
          ].join('\n'),
        },
        { select: true }
      );
    }, 2140);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-cmd-verify-start`,
          sessionId,
          type: 'command_started',
          timestamp: createTimestamp(),
          commandId: `${turnId}-cmd-verify`,
          cwd,
          command: 'pnpm typecheck:web',
          riskLevel: 'safe',
        },
        { select: true }
      );
    }, 2260);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-cmd-verify-out`,
          sessionId,
          type: 'command_output',
          timestamp: createTimestamp(),
          commandId: `${turnId}-cmd-verify`,
          stream: 'stdout',
          content: `${t.workbench.stateMessages.completed}.\n`,
        },
        { select: true }
      );
    }, 2380);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-cmd-verify-done`,
          sessionId,
          type: 'command_completed',
          timestamp: createTimestamp(),
          commandId: `${turnId}-cmd-verify`,
          exitCode: 0,
          durationMs: 900,
        },
        { select: true }
      );
    }, 2500);

    schedule(() => {
      appendEvent(
        sessionId,
        {
          id: `${turnId}-done`,
          sessionId,
          type: 'session_completed',
          timestamp: createTimestamp(),
          status: 'success',
        },
        { select: true }
      );
    }, 2680);
  }

  return async function handleSend(content: string) {
    setLoadError('');
    setNotice('');

    if (await handleSlashCommand(content)) return;

    const nextMode = content.startsWith('/plan') || content.startsWith('/wb:plan')
      ? 'plan'
      : content.startsWith('/review') || content.startsWith('/wb:review')
        ? 'review'
        : mode;
    setMode(nextMode);
    const nextProjectPath = activeSession?.projectPath || projectPath;
    const nextProvider =
      selectedProvider ?? activeSession?.provider ?? (apiSource === 'mock' ? 'mock' : undefined);
    const nextModel = selectedModelId ?? activeSession?.model;
    const nextReasoningEffort = normalizeReasoningEffort(
      reasoningEffort,
      nextProvider,
      nextModel,
      executors,
      models
    ) ?? reasoningEffortDefault(nextProvider, nextModel, executors, models);
    const nextRuntimeOptions = compactWorkbenchRuntimeOptions(runtimeOptions);
    const nextPermissionMode: PermissionMode =
      nextMode === 'plan' || nextMode === 'review'
        ? 'read-only'
        : (permissionMode ?? activeSession?.permissionMode ?? 'default');

    try {
      const confirmDangerousSkip =
        nextPermissionMode === 'full-access'
          ? window.confirm(t.workbench.v2.fullAccessConfirm)
          : false;
      if (nextPermissionMode === 'full-access' && !confirmDangerousSkip) return;

      const worktreeCheck = await checkWorktreeBeforeStart(nextProjectPath);
      if (!worktreeCheck.allowed) return;

      const createdSession = await api.createSession({
        projectPath: nextProjectPath,
        prompt: content,
        mode: nextMode,
        model: nextModel,
        provider: nextProvider,
        deviceId: selectedDeviceId ?? activeSession?.deviceId,
        reasoningEffort: nextReasoningEffort,
        permissionMode: nextPermissionMode,
        confirmDangerousSkip,
        runtimeOptions: nextRuntimeOptions,
        allowDirtyWorktree: worktreeCheck.allowDirtyWorktree,
        useRag,
        ragTopK,
      });
      const session = {
        ...createdSession,
        title: createdSession.title || titleFromPrompt(content, t.workbench.v2.newAgentSession),
        status: 'running' as WorkbenchStatus,
      };

      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setActiveSessionId(session.id);
      syncRuntimeControls(session);
      setSelectedItemId(undefined);

      const userMessage: UserMessageEvent = {
        id: createId('user-message'),
        sessionId: session.id,
        type: 'user_message',
        timestamp: createTimestamp(),
        role: 'user',
        content,
      };
      setEventsBySession((current) => ({ ...current, [session.id]: [userMessage] }));
      setSelectedItemId(userMessage.id);

      if (apiSource === 'mock') {
        simulateMockAgentTurn(session.id, session.projectPath);
      } else {
        const events = await loadSessionEvents(session.id);
        if (events.some((event) => event.type === 'session_completed')) {
          await refreshInspectorData(session.id);
        }
      }
      await refreshSessions();
    } catch (error) {
      const sessionId = activeSessionId ?? 'local-error';
      if (!activeSessionId) {
        setEventsBySession((current) => ({ ...current, [sessionId]: current[sessionId] ?? [] }));
        setActiveSessionId(sessionId);
      }
      appendEvent(
        sessionId,
        {
          id: createId('send-error'),
          sessionId,
          type: 'error',
          timestamp: createTimestamp(),
          message: getErrorMessage(error, t.workbench.errors.startAgent),
        },
        { select: true }
      );
      setLoadError(getErrorMessage(error, t.workbench.errors.startAgent));
    }
  };
}
