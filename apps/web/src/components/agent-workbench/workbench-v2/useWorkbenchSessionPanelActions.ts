import type { Dispatch, SetStateAction } from 'react';
import type { InspectorTab } from './InspectorPanel.tsx';
import type {
  AgentWorkbenchApi,
  ExportOptions,
  TimelineEvent,
  WorkbenchContextSummary,
  WorkbenchInitPlan,
} from './types.ts';
import { createId, createTimestamp } from './workbenchPageUtils.ts';
import { useT } from '../../../i18n/index.ts';
import { getErrorMessage } from '../../../lib/format.ts';

type SessionPanelBusyAction = 'compact' | 'export' | 'init-plan' | 'init-apply';

export function useWorkbenchSessionPanelActions({
  api,
  activeSessionId,
  setSummaries,
  setInitPlan,
  setBusyAction,
  setLoadError,
  setNotice,
  setInspectorTab,
  appendEvent,
}: {
  api: AgentWorkbenchApi;
  activeSessionId?: string;
  setSummaries: Dispatch<SetStateAction<WorkbenchContextSummary[]>>;
  setInitPlan: Dispatch<SetStateAction<WorkbenchInitPlan | null>>;
  setBusyAction: (value: SessionPanelBusyAction | undefined) => void;
  setLoadError: (value: string) => void;
  setNotice: (value: string) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  appendEvent: (sessionId: string, event: TimelineEvent, options?: { select?: boolean }) => void;
}) {
  const { t } = useT();

  async function handleCompact() {
    if (!activeSessionId) return;
    setBusyAction('compact');
    setInspectorTab('actions');
    try {
      const summary = await api.compactSession(activeSessionId);
      setSummaries((current) => [summary, ...current.filter((item) => item.id !== summary.id)]);
      appendEvent(
        activeSessionId,
        {
          id: createId('compact-summary'),
          sessionId: activeSessionId,
          type: 'reasoning_summary',
          timestamp: createTimestamp(),
          content: `${t.workbench.review.compactSummaries}: ${summary.summary}`,
        },
        { select: true }
      );
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.compactSession));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleExport(options: ExportOptions, delivery: 'copy' | 'download') {
    if (!activeSessionId) return;
    setBusyAction('export');
    setInspectorTab('actions');
    try {
      const result = await api.exportSessionMarkdown(activeSessionId, options);
      if (delivery === 'download') {
        const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = result.filename;
        anchor.click();
        URL.revokeObjectURL(url);
      } else if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(result.markdown);
        } catch {
          // Clipboard permissions vary in embedded browsers; the export result is still valid.
        }
      }
      setNotice(t.workbench.messages.exportReady(result.filename));
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.exportSession));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handlePlanInitClaude() {
    if (!activeSessionId) return;
    setBusyAction('init-plan');
    setInspectorTab('actions');
    try {
      setInitPlan(await api.getInitClaudePlan(activeSessionId));
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.scanClaude));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function handleApplyInitClaude() {
    if (!activeSessionId) return;
    setBusyAction('init-apply');
    setInspectorTab('actions');
    try {
      setInitPlan(await api.applyInitClaudePlan(activeSessionId));
    } catch (error) {
      setLoadError(getErrorMessage(error, t.workbench.errors.initClaude));
    } finally {
      setBusyAction(undefined);
    }
  }

  return {
    handleCompact,
    handleExport,
    handlePlanInitClaude,
    handleApplyInitClaude,
  };
}
