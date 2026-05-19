import type { Dispatch, SetStateAction } from 'react';
import type { SlashCommand } from '../../../types.ts';
import type { InspectorTab } from './InspectorPanel.tsx';
import type { AgentWorkbenchApi, ExportOptions, TimelineEvent, WorkbenchSession } from './types.ts';
import { createId, createTimestamp, parseSlashInput } from './workbenchPageUtils.ts';
import { useT } from '../../../i18n/index.ts';
import { getErrorMessage } from '../../../lib/format.ts';

export function useWorkbenchSlashCommands({
  api,
  slashCommands,
  sessions,
  activeSessionId,
  setSessions,
  setActiveSessionId,
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
}: {
  api: AgentWorkbenchApi;
  slashCommands: SlashCommand[];
  sessions: WorkbenchSession[];
  activeSessionId?: string;
  setSessions: Dispatch<SetStateAction<WorkbenchSession[]>>;
  setActiveSessionId: (sessionId: string) => void;
  setEventsBySession: Dispatch<SetStateAction<Record<string, TimelineEvent[]>>>;
  setSelectedItemId: (itemId: string | undefined) => void;
  setLoadError: (value: string) => void;
  setNotice: (value: string) => void;
  setInspectorTab: (value: InspectorTab) => void;
  syncRuntimeControls: (session: WorkbenchSession) => void;
  appendEvent: (sessionId: string, event: TimelineEvent, options?: { select?: boolean }) => void;
  refreshInspectorData: (sessionId: string) => Promise<void>;
  handleRefreshDiff: () => Promise<void>;
  handleCompact: () => Promise<void>;
  handleExport: (options: ExportOptions, delivery: 'copy' | 'download') => Promise<void>;
  handleSelectSession: (sessionId: string) => Promise<void>;
}) {
  const { t } = useT();

  return async function handleSlashCommand(content: string): Promise<boolean> {
    const parsed = parseSlashInput(content);
    if (!parsed) return false;
    const command = slashCommands.find((entry) => entry.name === parsed.name && entry.enabled);
    const localName = parsed.name.startsWith('wb:') ? parsed.name.slice(3) : parsed.name;

    function showCommandError(message: string) {
      setInspectorTab('logs');
      if (activeSessionId) {
        appendEvent(
          activeSessionId,
          {
            id: createId('command-error'),
            sessionId: activeSessionId,
            type: 'error',
            timestamp: createTimestamp(),
            message,
          },
          { select: true }
        );
      } else {
        setLoadError(message);
      }
    }

    if (!command) {
      if (parsed.name === 'plan' || parsed.name === 'review') return false;
      showCommandError(t.workbench.messages.unknownCommand(parsed.name));
      return true;
    }

    if (command.handler === 'agent-mode') {
      return false;
    }

    if (command.handler === 'host') {
      if (!activeSessionId) {
        showCommandError(t.workbench.messages.sessionRequired);
        return true;
      }
      try {
        const result = await api.executeSlashCommand(activeSessionId, content);
        setSessions((current) => {
          const next = current.map((session) =>
            session.id === result.session.id ? result.session : session
          );
          return result.newSession
            ? [result.newSession, ...next.filter((session) => session.id !== result.newSession?.id)]
            : next;
        });
        syncRuntimeControls(result.session);
        if (result.event) appendEvent(result.session.id, result.event, { select: true });
        if (localName === 'permissions') setInspectorTab('approvals');
        if (localName === 'config') setInspectorTab('logs');
        if (result.newSession) {
          setActiveSessionId(result.newSession.id);
          syncRuntimeControls(result.newSession);
          setNotice(t.workbench.v2.chooseOrStartSession);
        }
        await refreshInspectorData(result.session.id);
        return true;
      } catch (error) {
        showCommandError(getErrorMessage(error, t.workbench.errors.sendMessage));
        return true;
      }
    }

    if (localName === 'diff') {
      setInspectorTab('diff');
      if (activeSessionId) await handleRefreshDiff();
      return true;
    }

    if (localName === 'permissions') {
      setInspectorTab('approvals');
      return true;
    }

    if (localName === 'compact') {
      await handleCompact();
      return true;
    }

    if (localName === 'export') {
      await handleExport({ includeDiff: true, includeRawLogs: false }, 'copy');
      return true;
    }

    if (localName === 'clear') {
      if (activeSessionId) {
        setEventsBySession((current) => ({ ...current, [activeSessionId]: [] }));
        setSelectedItemId(undefined);
      }
      return true;
    }

    if (localName === 'resume') {
      const latest = sessions[0];
      if (latest) await handleSelectSession(latest.id);
      return true;
    }

    if (localName === 'checkpoint') {
      if (activeSessionId) {
        appendEvent(
          activeSessionId,
          {
            id: createId('checkpoint'),
            sessionId: activeSessionId,
            type: 'checkpoint_created',
            timestamp: createTimestamp(),
            checkpointId: createId('checkpoint-id'),
            title: parsed.args || t.workbench.v2.checkpointCreated,
          },
          { select: true }
        );
      }
      return true;
    }

    showCommandError(t.workbench.messages.unknownCommand(parsed.name));
    return true;
  };
}
