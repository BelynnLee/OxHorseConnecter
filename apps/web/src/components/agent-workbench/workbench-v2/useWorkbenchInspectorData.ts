import { useCallback, useState } from 'react';
import type {
  AgentWorkbenchApi,
  WorkbenchContextSummary,
  WorkbenchDiff,
  WorkbenchInitPlan,
  WorkbenchLog,
  WorkbenchPermissionHit,
  WorkbenchPermissionRule,
  WorkbenchUsage,
} from './types.ts';

export function useWorkbenchInspectorData(api: AgentWorkbenchApi) {
  const [logs, setLogs] = useState<WorkbenchLog[]>([]);
  const [sessionDiff, setSessionDiff] = useState<WorkbenchDiff | null>(null);
  const [permissionRules, setPermissionRules] = useState<WorkbenchPermissionRule[]>([]);
  const [permissionHits, setPermissionHits] = useState<WorkbenchPermissionHit[]>([]);
  const [summaries, setSummaries] = useState<WorkbenchContextSummary[]>([]);
  const [usage, setUsage] = useState<WorkbenchUsage | null>(null);
  const [initPlan, setInitPlan] = useState<WorkbenchInitPlan | null>(null);

  const resetInspectorData = useCallback(() => {
    setLogs([]);
    setSessionDiff(null);
    setSummaries([]);
    setUsage(null);
    setInitPlan(null);
  }, []);

  const refreshInspectorData = useCallback(
    async (sessionId: string) => {
      const [
        logResult,
        diffResult,
        ruleResult,
        hitResult,
        summaryResult,
        usageResult,
      ] = await Promise.allSettled([
        api.getSessionLogs(sessionId, { limit: 200 }),
        api.getSessionDiff(sessionId),
        api.listPermissionRules(),
        api.listPermissionHits(100),
        api.getSessionSummaries(sessionId),
        api.getSessionUsage(sessionId),
      ]);

      if (logResult.status === 'fulfilled') setLogs(logResult.value);
      if (diffResult.status === 'fulfilled') setSessionDiff(diffResult.value);
      if (ruleResult.status === 'fulfilled') setPermissionRules(ruleResult.value);
      if (hitResult.status === 'fulfilled') setPermissionHits(hitResult.value);
      if (summaryResult.status === 'fulfilled') setSummaries(summaryResult.value);
      if (usageResult.status === 'fulfilled') setUsage(usageResult.value);
    },
    [api]
  );

  return {
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
  };
}
