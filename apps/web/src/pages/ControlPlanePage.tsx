import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import type {
  AgentOperation,
  AgentRun,
  AgentPermissionRule,
  ControlPlaneAgentSession,
  Device,
  EvalRun,
  EvalTask,
  MetricsSummary,
  Project,
  PublicProviderConfig,
  RagHit,
  RagIndex,
  RagQueryResult,
} from '../types.ts';
import {
  analyzeFailure,
  callMcpTool,
  createControlPlaneProvider,
  createEvalMatrixRuns,
  createEvalRun,
  createEvalTask,
  createProjectPermissionRule,
  createProject,
  deleteControlPlaneProvider,
  deleteProjectPermissionRule,
  deleteRagIndex,
  getControlPlaneProviders,
  getControlPlaneSessions,
  getDevices,
  getAgentRuns,
  getEvalRuns,
  getEvalTasks,
  getMetricsAgents,
  getMetricsFailureReasons,
  getMetricsModels,
  getMetricsProjects,
  getMetricsSummary,
  getMcpTools,
  getSessionAgentOperations,
  getProjectPermissionRules,
  getProjectGitStatus,
  getProjects,
  getRagHits,
  getRagIndexes,
  indexRagRepo,
  queryRag,
  setProjectEnabled,
  testControlPlaneProvider,
  updateControlPlaneProvider,
  updateProjectPermissionRule,
} from '../api.ts';
import { Button } from '../components/ui/Button.tsx';
import { LoadingState } from '../components/ui/LoadingState.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { SegmentedTabs } from '../components/ui/SegmentedTabs.tsx';
import { ControlPlaneAnalysisTab } from '../components/control-plane/ControlPlaneAnalysisTab.tsx';
import {
  ControlPlaneStatusLine,
  controlPlaneTabs,
  splitCsv,
  type ControlPlaneTabId,
  type MetricGroup,
} from '../components/control-plane/ControlPlaneCommon.tsx';
import { ControlPlaneEvalsTab } from '../components/control-plane/ControlPlaneEvalsTab.tsx';
import { ControlPlaneMetricsTab } from '../components/control-plane/ControlPlaneMetricsTab.tsx';
import { ControlPlaneMcpTab } from '../components/control-plane/ControlPlaneMcpTab.tsx';
import { ControlPlaneProjectsTab } from '../components/control-plane/ControlPlaneProjectsTab.tsx';
import { ControlPlaneProvidersTab } from '../components/control-plane/ControlPlaneProvidersTab.tsx';
import { ControlPlaneRagTab } from '../components/control-plane/ControlPlaneRagTab.tsx';
import { ControlPlaneRunsTab } from '../components/control-plane/ControlPlaneRunsTab.tsx';
import { getErrorMessage } from '../lib/format.ts';
import { useT } from '../i18n/index.ts';

export default function ControlPlanePage() {
  const { t } = useT();
  const cp = t.controlPlane;
  const [activeTab, setActiveTab] = useState<ControlPlaneTabId>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [providers, setProviders] = useState<PublicProviderConfig[]>([]);
  const [controlPlaneSessions, setControlPlaneSessions] = useState<ControlPlaneAgentSession[]>([]);
  const [controlPlaneSessionsTotal, setControlPlaneSessionsTotal] = useState(0);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [agentRunsTotal, setAgentRunsTotal] = useState(0);
  const [summary, setSummary] = useState<MetricsSummary>();
  const [projectMetrics, setProjectMetrics] = useState<MetricGroup[]>([]);
  const [modelMetrics, setModelMetrics] = useState<MetricGroup[]>([]);
  const [agentMetrics, setAgentMetrics] = useState<MetricGroup[]>([]);
  const [failureReasons, setFailureReasons] = useState<Array<{ reason: string; count: number }>>(
    []
  );
  const [ragIndexes, setRagIndexes] = useState<RagIndex[]>([]);
  const [ragHits, setRagHits] = useState<RagHit[]>([]);
  const [evalTasks, setEvalTasks] = useState<EvalTask[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>([]);
  const [mcpTools, setMcpTools] = useState<
    Array<{
      name: string;
      description: string;
      mutating: boolean;
      inputSchema: Record<string, unknown>;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [gitStatus, setGitStatus] = useState<Record<string, string>>({});
  const [permissionRules, setPermissionRules] = useState<AgentPermissionRule[]>([]);
  const [ragResult, setRagResult] = useState<RagQueryResult>();
  const [failureResult, setFailureResult] = useState<Record<string, unknown>>();
  const [mcpResult, setMcpResult] = useState<Record<string, unknown>>();
  const [operations, setOperations] = useState<AgentOperation[]>([]);

  const [projectForm, setProjectForm] = useState({ deviceId: '', name: '', path: '', description: '' });
  const [permissionForm, setPermissionForm] = useState({
    projectId: '',
    provider: 'all',
    ruleType: 'command',
    pattern: '',
    decision: 'ask',
    riskLevel: 'high',
    description: '',
  });
  const [providerForm, setProviderForm] = useState({
    name: '',
    type: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    models: '',
    usagePurpose: 'general',
    timeoutMs: '',
  });
  const [ragForm, setRagForm] = useState({ projectId: '', query: '', topK: '6' });
  const [evalTaskForm, setEvalTaskForm] = useState({
    name: '',
    repo: '',
    prompt: '',
    mustContain: '',
  });
  const [evalRunForm, setEvalRunForm] = useState({
    taskId: '',
    agentType: 'codex',
    model: '',
    sessionId: '',
    deviceId: '',
    projectId: '',
    workingDirectory: '',
    permissionMode: 'default',
    useRag: false,
  });
  const [evalMatrixForm, setEvalMatrixForm] = useState({
    taskIds: '',
    agentTypes: 'codex',
    models: '',
    promptVariants: '',
    ragVariants: 'off',
  });
  const [failureForm, setFailureForm] = useState({ sessionId: '', error: '', logs: '' });
  const [mcpForm, setMcpForm] = useState({
    name: 'get_project_structure',
    sessionId: '',
    projectId: '',
    argumentsJson: '{\n  "maxDepth": 2\n}',
  });

  const enabledProjects = useMemo(() => projects.filter((project) => project.enabled), [projects]);
  const ragIndexByProject = useMemo(
    () => new Map(ragIndexes.map((index) => [index.projectId, index])),
    [ragIndexes]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [
        loadedProjects,
        loadedDevices,
        loadedProviders,
        loadedControlPlaneSessions,
        loadedAgentRuns,
        loadedSummary,
        loadedProjectMetrics,
        loadedModelMetrics,
        loadedAgentMetrics,
        loadedFailureReasons,
        loadedRagIndexes,
        loadedRagHits,
        loadedEvalTasks,
        loadedEvalRuns,
        loadedMcpTools,
      ] = await Promise.all([
        getProjects(),
        getDevices(),
        getControlPlaneProviders(),
        getControlPlaneSessions({ limit: 50 }),
        getAgentRuns({ limit: 50 }),
        getMetricsSummary(),
        getMetricsProjects(),
        getMetricsModels(),
        getMetricsAgents(),
        getMetricsFailureReasons(),
        getRagIndexes(),
        getRagHits({ limit: 30 }),
        getEvalTasks(),
        getEvalRuns(),
        getMcpTools(),
      ]);
      setProjects(loadedProjects);
      setDevices(loadedDevices);
      setProjectForm((current) => ({
        ...current,
        deviceId: current.deviceId || loadedDevices.find((device) => device.trusted)?.id || '',
      }));
      setProviders(loadedProviders);
      setControlPlaneSessions(loadedControlPlaneSessions.items);
      setControlPlaneSessionsTotal(loadedControlPlaneSessions.total);
      setAgentRuns(loadedAgentRuns.items);
      setAgentRunsTotal(loadedAgentRuns.total);
      setSummary(loadedSummary);
      setProjectMetrics(loadedProjectMetrics);
      setModelMetrics(loadedModelMetrics);
      setAgentMetrics(loadedAgentMetrics);
      setFailureReasons(loadedFailureReasons);
      setRagIndexes(loadedRagIndexes);
      setRagHits(loadedRagHits);
      setEvalTasks(loadedEvalTasks);
      setEvalRuns(loadedEvalRuns);
      setMcpTools(loadedMcpTools);
      setPermissionForm((current) => ({
        ...current,
        projectId: current.projectId || loadedProjects.find((p) => p.enabled)?.id || '',
      }));
      setRagForm((current) => ({
        ...current,
        projectId: current.projectId || loadedProjects.find((p) => p.enabled)?.id || '',
      }));
      setEvalRunForm((current) => ({
        ...current,
        taskId: current.taskId || loadedEvalTasks[0]?.id || '',
        projectId: current.projectId || loadedProjects.find((p) => p.enabled)?.id || '',
      }));
      setMcpForm((current) => ({
        ...current,
        name: current.name || loadedMcpTools[0]?.name || 'get_project_structure',
        projectId: current.projectId || loadedProjects.find((p) => p.enabled)?.id || '',
      }));
    } catch (err) {
      setError(getErrorMessage(err, cp.messages.errorLoad));
    } finally {
      setLoading(false);
    }
  }, [cp.messages.errorLoad]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!permissionForm.projectId) {
      setPermissionRules([]);
      return;
    }
    let cancelled = false;
    getProjectPermissionRules(permissionForm.projectId)
      .then((rules) => {
        if (!cancelled) setPermissionRules(rules);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, cp.messages.errorLoadPermissionRules));
      });
    return () => {
      cancelled = true;
    };
  }, [permissionForm.projectId, cp.messages.errorLoadPermissionRules]);

  async function runAction(
    label: string,
    action: () => Promise<void | string>,
    done = cp.messages.done
  ): Promise<void> {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      const message = await action();
      setNotice(message || done);
    } catch (err) {
      setError(getErrorMessage(err, cp.messages.requestFailed));
    } finally {
      setBusy('');
    }
  }

  async function handleProjectSubmit(event: FormEvent) {
    event.preventDefault();
    await runAction(
      'project-create',
      async () => {
        await createProject({
          deviceId: projectForm.deviceId,
          name: projectForm.name.trim() || undefined,
          path: projectForm.path.trim(),
          description: projectForm.description.trim() || undefined,
        });
        setProjectForm((current) => ({ deviceId: current.deviceId, name: '', path: '', description: '' }));
        await loadData();
      },
      cp.messages.projectRegistered
    );
  }

  async function handlePermissionRuleSubmit(event: FormEvent) {
    event.preventDefault();
    await runAction(
      'permission-create',
      async () => {
        const projectId = permissionForm.projectId;
        await createProjectPermissionRule(projectId, {
          provider: permissionForm.provider as AgentPermissionRule['provider'],
          ruleType: permissionForm.ruleType as AgentPermissionRule['ruleType'],
          pattern: permissionForm.pattern.trim(),
          decision: permissionForm.decision as AgentPermissionRule['decision'],
          riskLevel: permissionForm.riskLevel as AgentPermissionRule['riskLevel'],
          description: permissionForm.description.trim() || undefined,
          enabled: true,
        });
        setPermissionForm((current) => ({ ...current, pattern: '', description: '' }));
        setPermissionRules(await getProjectPermissionRules(projectId));
      },
      cp.messages.permissionRuleSaved
    );
  }

  async function handleProviderSubmit(event: FormEvent) {
    event.preventDefault();
    const timeout = providerForm.timeoutMs.trim() ? Number(providerForm.timeoutMs) : undefined;
    await runAction(
      'provider-create',
      async () => {
        await createControlPlaneProvider({
          name: providerForm.name.trim(),
          type: providerForm.type as 'openai-compatible' | 'openrouter' | 'anthropic',
          baseUrl: providerForm.baseUrl.trim() || undefined,
          apiKey: providerForm.apiKey.trim() || undefined,
          models: splitCsv(providerForm.models),
          timeoutMs: Number.isFinite(timeout) ? timeout : undefined,
          usagePurpose: providerForm.usagePurpose as
            | 'agent'
            | 'rag'
            | 'evaluation'
            | 'failure_analysis'
            | 'general',
          enabled: true,
        });
        setProviderForm({
          name: '',
          type: 'openai-compatible',
          baseUrl: '',
          apiKey: '',
          models: '',
          usagePurpose: 'general',
          timeoutMs: '',
        });
        await loadData();
      },
      cp.messages.providerSaved
    );
  }

  async function handleEvalTaskSubmit(event: FormEvent) {
    event.preventDefault();
    await runAction(
      'eval-task-create',
      async () => {
        await createEvalTask({
          name: evalTaskForm.name.trim(),
          repo: evalTaskForm.repo.trim(),
          prompt: evalTaskForm.prompt.trim(),
          expected: { mustContain: splitCsv(evalTaskForm.mustContain) },
        });
        setEvalTaskForm({ name: '', repo: '', prompt: '', mustContain: '' });
        await loadData();
      },
      cp.messages.evalTaskCreated
    );
  }

  async function handleEvalRunSubmit(event: FormEvent) {
    event.preventDefault();
    await runAction(
      'eval-run-create',
      async () => {
        await createEvalRun({
          taskId: evalRunForm.taskId,
          agentType: evalRunForm.agentType.trim(),
          model: evalRunForm.model.trim() || undefined,
          sessionId: evalRunForm.sessionId.trim() || undefined,
          deviceId: evalRunForm.deviceId.trim() || undefined,
          projectId: evalRunForm.projectId || undefined,
          workingDirectory: evalRunForm.workingDirectory.trim() || undefined,
          permissionMode: evalRunForm.permissionMode as
            | 'read-only'
            | 'default'
            | 'auto-review'
            | 'full-access',
          useRag: evalRunForm.useRag,
        });
        await loadData();
      },
      cp.messages.evalRunCreated
    );
  }

  async function handleEvalMatrixSubmit(event: FormEvent) {
    event.preventDefault();
    const ragValues =
      evalMatrixForm.ragVariants === 'both' ? [false, true] : [evalMatrixForm.ragVariants === 'on'];
    await runAction(
      'eval-matrix-create',
      async () => {
        await createEvalMatrixRuns({
          taskId: evalRunForm.taskId || undefined,
          taskIds: splitCsv(evalMatrixForm.taskIds),
          agentTypes: splitCsv(evalMatrixForm.agentTypes),
          models: splitCsv(evalMatrixForm.models),
          promptVariants: splitCsv(evalMatrixForm.promptVariants),
          useRagValues: ragValues,
          deviceId: evalRunForm.deviceId.trim() || undefined,
          projectId: evalRunForm.projectId || undefined,
          workingDirectory: evalRunForm.workingDirectory.trim() || undefined,
          permissionMode: evalRunForm.permissionMode as
            | 'read-only'
            | 'default'
            | 'auto-review'
            | 'full-access',
        });
        await loadData();
      },
      cp.messages.evalMatrixCreated
    );
  }

  async function handleFailureSubmit(event: FormEvent) {
    event.preventDefault();
    await runAction(
      'failure-analyze',
      async () => {
        setFailureResult(
          await analyzeFailure({
            sessionId: failureForm.sessionId.trim() || undefined,
            error: failureForm.error.trim() || undefined,
            logs: failureForm.logs.trim() || undefined,
          })
        );
      },
      cp.messages.failureAnalysisCompleted
    );
  }

  async function handleLoadOperations() {
    await runAction(
      'operations-load',
      async () => {
        setOperations(
          await getSessionAgentOperations(failureForm.sessionId.trim(), { limit: 1000 })
        );
      },
      cp.messages.agentOperationsLoaded
    );
  }

  async function handleMcpSubmit(event: FormEvent) {
    event.preventDefault();
    await runAction(
      'mcp-call',
      async () => {
        const parsedArgs = mcpForm.argumentsJson.trim()
          ? (JSON.parse(mcpForm.argumentsJson) as Record<string, unknown>)
          : {};
        const args: Record<string, unknown> = {
          ...parsedArgs,
        };
        if (mcpForm.projectId) args.projectId = mcpForm.projectId;
        if (mcpForm.sessionId.trim()) args.sessionId = mcpForm.sessionId.trim();
        setMcpResult(await callMcpTool({ name: mcpForm.name, arguments: args }));
      },
      cp.messages.mcpToolCompleted
    );
  }

  if (loading) {
    return <LoadingState label={cp.loading} />;
  }

  return (
    <div className="page-shell">
      <PageHeader
        icon={<Activity className="h-4 w-4" />}
        title={cp.title}
        subtitle={cp.summaryLine(
          projects.length,
          providers.length,
          controlPlaneSessionsTotal,
          agentRunsTotal
        )}
        className="flex-shrink-0"
        actions={
          <Button
            type="button"
            onClick={() => void loadData()}
            variant="secondary"
            disabled={Boolean(busy)}
          >
            <RefreshCw className="h-4 w-4" />
            {t.refresh}
          </Button>
        }
      />

      <ControlPlaneStatusLine error={error} notice={notice} />

      <SegmentedTabs
        onChange={setActiveTab}
        tabs={controlPlaneTabs.map((tab) => {
          const Icon = tab.icon;
          return {
            id: tab.id,
            icon: <Icon className="h-4 w-4" />,
            label: cp.tabs[tab.id],
          };
        })}
        value={activeTab}
      />

      <div className="scroll-area pb-2">
        {activeTab === 'projects' && (
          <ControlPlaneProjectsTab
            projects={projects}
            devices={devices}
            permissionRules={permissionRules}
            projectForm={projectForm}
            permissionForm={permissionForm}
            gitStatus={gitStatus}
            busy={busy}
            onProjectFormChange={setProjectForm}
            onPermissionFormChange={setPermissionForm}
            onProjectSubmit={(event) => void handleProjectSubmit(event)}
            onPermissionSubmit={(event) => void handlePermissionRuleSubmit(event)}
            onTogglePermissionRule={(rule) =>
              void runAction(
                `permission-toggle-${rule.id}`,
                async () => {
                  const updated = await updateProjectPermissionRule(
                    permissionForm.projectId,
                    rule.id,
                    {
                      enabled: !rule.enabled,
                    }
                  );
                  setPermissionRules((items) =>
                    items.map((item) => (item.id === updated.id ? updated : item))
                  );
                },
                rule.enabled
                  ? cp.messages.permissionRuleDisabled
                  : cp.messages.permissionRuleEnabled
              )
            }
            onDeletePermissionRule={(rule) =>
              void runAction(
                `permission-delete-${rule.id}`,
                async () => {
                  await deleteProjectPermissionRule(permissionForm.projectId, rule.id);
                  setPermissionRules((items) => items.filter((item) => item.id !== rule.id));
                },
                cp.messages.permissionRuleDeleted
              )
            }
            onLoadGitStatus={(project) =>
              void runAction(
                `git-${project.id}`,
                async () => {
                  const result = await getProjectGitStatus(project.id);
                  setGitStatus((current) => ({
                    ...current,
                    [project.id]: result.status,
                  }));
                },
                cp.messages.gitStatusLoaded
              )
            }
            onToggleProject={(project) =>
              void runAction(
                `project-toggle-${project.id}`,
                async () => {
                  const updated = await setProjectEnabled(project.id, !project.enabled);
                  setProjects((items) =>
                    items.map((item) => (item.id === updated.id ? updated : item))
                  );
                },
                project.enabled ? cp.messages.projectDisabled : cp.messages.projectEnabled
              )
            }
          />
        )}

        {activeTab === 'providers' && (
          <ControlPlaneProvidersTab
            providers={providers}
            providerForm={providerForm}
            busy={busy}
            onProviderFormChange={setProviderForm}
            onSubmit={(event) => void handleProviderSubmit(event)}
            onTestProvider={(provider) =>
              void runAction(`provider-test-${provider.id}`, async () => {
                const result = await testControlPlaneProvider(provider.id);
                if (!result.ok) {
                  throw new Error(result.message);
                }
                const modelPreview = result.models.slice(0, 4).join(', ');
                return modelPreview
                  ? `${result.message} ${modelPreview}${result.models.length > 4 ? ', ...' : ''}`
                  : result.message;
              })
            }
            onToggleProvider={(provider) =>
              void runAction(`provider-toggle-${provider.id}`, async () => {
                const updated = await updateControlPlaneProvider(provider.id, {
                  enabled: !provider.enabled,
                });
                setProviders((items) =>
                  items.map((item) => (item.id === updated.id ? updated : item))
                );
              })
            }
            onDeleteProvider={(provider) => {
              if (!confirm(cp.messages.confirmDeleteProvider(provider.name))) return;
              void runAction(
                `provider-delete-${provider.id}`,
                async () => {
                  await deleteControlPlaneProvider(provider.id);
                  await loadData();
                },
                cp.messages.providerDeleted
              );
            }}
          />
        )}

        {activeTab === 'runs' && (
          <ControlPlaneRunsTab
            sessions={controlPlaneSessions}
            runs={agentRuns}
            projects={projects}
          />
        )}

        {activeTab === 'metrics' && (
          <ControlPlaneMetricsTab
            summary={summary}
            projectMetrics={projectMetrics}
            agentMetrics={agentMetrics}
            modelMetrics={modelMetrics}
            failureReasons={failureReasons}
          />
        )}

        {activeTab === 'rag' && (
          <ControlPlaneRagTab
            enabledProjects={enabledProjects}
            ragForm={ragForm}
            ragIndexByProject={ragIndexByProject}
            ragResult={ragResult}
            ragHits={ragHits}
            busy={busy}
            onRagFormChange={setRagForm}
            onIndex={() =>
              void runAction(
                'rag-index',
                async () => {
                  await indexRagRepo(ragForm.projectId);
                  await loadData();
                },
                cp.messages.ragIndexUpdated
              )
            }
            onDelete={() =>
              void runAction(
                'rag-delete',
                async () => {
                  await deleteRagIndex(ragForm.projectId);
                  setRagResult(undefined);
                  await loadData();
                },
                cp.messages.ragIndexDeleted
              )
            }
            onQuery={(event) => {
              event.preventDefault();
              void runAction(
                'rag-query',
                async () => {
                  setRagResult(
                    await queryRag({
                      projectId: ragForm.projectId,
                      query: ragForm.query.trim(),
                      topK: Number(ragForm.topK) || 6,
                    })
                  );
                  setRagHits(await getRagHits({ projectId: ragForm.projectId, limit: 30 }));
                },
                cp.messages.ragQueryCompleted
              );
            }}
          />
        )}

        {activeTab === 'evals' && (
          <ControlPlaneEvalsTab
            enabledProjects={enabledProjects}
            evalTasks={evalTasks}
            evalRuns={evalRuns}
            evalTaskForm={evalTaskForm}
            evalRunForm={evalRunForm}
            evalMatrixForm={evalMatrixForm}
            busy={busy}
            onEvalTaskFormChange={setEvalTaskForm}
            onEvalRunFormChange={setEvalRunForm}
            onEvalMatrixFormChange={setEvalMatrixForm}
            onEvalTaskSubmit={(event) => void handleEvalTaskSubmit(event)}
            onEvalRunSubmit={(event) => void handleEvalRunSubmit(event)}
            onEvalMatrixSubmit={(event) => void handleEvalMatrixSubmit(event)}
          />
        )}

        {activeTab === 'mcp' && (
          <ControlPlaneMcpTab
            projects={projects}
            mcpTools={mcpTools}
            mcpForm={mcpForm}
            mcpResult={mcpResult}
            busy={busy}
            onMcpFormChange={setMcpForm}
            onSubmit={(event) => void handleMcpSubmit(event)}
          />
        )}

        {activeTab === 'analysis' && (
          <ControlPlaneAnalysisTab
            failureForm={failureForm}
            failureResult={failureResult}
            operations={operations}
            busy={busy}
            onFailureFormChange={setFailureForm}
            onSubmit={(event) => void handleFailureSubmit(event)}
            onLoadOperations={() => void handleLoadOperations()}
          />
        )}
      </div>
    </div>
  );
}
