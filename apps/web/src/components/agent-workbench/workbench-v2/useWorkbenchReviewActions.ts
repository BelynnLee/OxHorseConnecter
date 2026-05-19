import type { Dispatch, SetStateAction } from 'react';
import type { InspectorTab } from './InspectorPanel.tsx';
import type { AgentWorkbenchApi, TimelineEvent, WorkbenchDiff } from './types.ts';
import { useT } from '../../../i18n/index.ts';
import { getErrorMessage } from '../../../lib/format.ts';

type ReviewBusyAction = 'diff' | 'discard';

export function useWorkbenchReviewActions({
  api,
  activeSessionId,
  setSessionDiff,
  setEventsBySession,
  setBusyAction,
  setLoadError,
  setNotice,
  setInspectorTab,
}: {
  api: AgentWorkbenchApi;
  activeSessionId?: string;
  setSessionDiff: Dispatch<SetStateAction<WorkbenchDiff | null>>;
  setEventsBySession: Dispatch<SetStateAction<Record<string, TimelineEvent[]>>>;
  setBusyAction: (value: ReviewBusyAction | undefined) => void;
  setLoadError: (value: string) => void;
  setNotice: (value: string) => void;
  setInspectorTab: (tab: InspectorTab) => void;
}) {
  const { t } = useT();

  async function handleRefreshDiff() {
    if (!activeSessionId) return;
    setBusyAction('diff');
    try {
      setSessionDiff(await api.refreshSessionDiff(activeSessionId));
      setInspectorTab('diff');
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.refreshReviewData));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleOpenFile(filePath: string) {
    if (!activeSessionId) return;
    try {
      await api.openFile(activeSessionId, filePath);
      setNotice(`${t.workbench.review.openFile}: ${filePath}`);
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.openFile));
    }
  }

  async function handleDiscardFile(filePath: string) {
    if (!activeSessionId) return;
    setBusyAction('discard');
    try {
      setSessionDiff(await api.discardFile(activeSessionId, filePath));
      setEventsBySession((current) => ({
        ...current,
        [activeSessionId]: (current[activeSessionId] ?? []).filter(
          (event) => event.type !== 'file_diff_created' || event.filePath !== filePath
        ),
      }));
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.discardFile));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleDiscardAll() {
    if (!activeSessionId) return;
    setBusyAction('discard');
    try {
      setSessionDiff(await api.discardAll(activeSessionId));
      setEventsBySession((current) => ({
        ...current,
        [activeSessionId]: (current[activeSessionId] ?? []).filter(
          (event) => event.type !== 'file_diff_created'
        ),
      }));
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.discardAll));
    } finally {
      setBusyAction(undefined);
    }
  }

  return {
    handleRefreshDiff,
    handleOpenFile,
    handleDiscardFile,
    handleDiscardAll,
  };
}
