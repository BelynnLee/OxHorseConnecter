import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, ClipboardCheck, Loader2, Play, Plus } from 'lucide-react';
import type { EvalRun, EvalTask, Project } from '../../types.ts';
import { useT } from '../../i18n/index.ts';
import { formatDateTime } from '../../lib/format.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { SurfaceItem } from '../ui/SurfaceItem.tsx';
import {
  ControlPlaneField,
  ControlPlaneSection,
  mappedLabel,
  percent,
  statusTone,
} from './ControlPlaneCommon.tsx';

type EvalTaskForm = {
  name: string;
  repo: string;
  prompt: string;
  mustContain: string;
};

type EvalRunForm = {
  taskId: string;
  agentType: string;
  model: string;
  sessionId: string;
  deviceId: string;
  projectId: string;
  workingDirectory: string;
  permissionMode: string;
  useRag: boolean;
};

type EvalMatrixForm = {
  taskIds: string;
  agentTypes: string;
  models: string;
  promptVariants: string;
  ragVariants: string;
};

export function ControlPlaneEvalsTab({
  enabledProjects,
  evalTasks,
  evalRuns,
  evalTaskForm,
  evalRunForm,
  evalMatrixForm,
  busy,
  onEvalTaskFormChange,
  onEvalRunFormChange,
  onEvalMatrixFormChange,
  onEvalTaskSubmit,
  onEvalRunSubmit,
  onEvalMatrixSubmit,
}: {
  enabledProjects: Project[];
  evalTasks: EvalTask[];
  evalRuns: EvalRun[];
  evalTaskForm: EvalTaskForm;
  evalRunForm: EvalRunForm;
  evalMatrixForm: EvalMatrixForm;
  busy: string;
  onEvalTaskFormChange: Dispatch<SetStateAction<EvalTaskForm>>;
  onEvalRunFormChange: Dispatch<SetStateAction<EvalRunForm>>;
  onEvalMatrixFormChange: Dispatch<SetStateAction<EvalMatrixForm>>;
  onEvalTaskSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEvalRunSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEvalMatrixSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useT();
  const cp = t.controlPlane;

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="space-y-4">
        <ControlPlaneSection title={cp.sections.evalTask} icon={ClipboardCheck}>
          <form onSubmit={onEvalTaskSubmit} className="space-y-3">
            <ControlPlaneField label={cp.fields.name}>
              <Input
                value={evalTaskForm.name}
                onChange={(event) =>
                  onEvalTaskFormChange({ ...evalTaskForm, name: event.target.value })
                }
                required
              />
            </ControlPlaneField>
            <ControlPlaneField label={cp.fields.repo}>
              <Input
                value={evalTaskForm.repo}
                onChange={(event) =>
                  onEvalTaskFormChange({ ...evalTaskForm, repo: event.target.value })
                }
                required
              />
            </ControlPlaneField>
            <ControlPlaneField label={cp.fields.prompt}>
              <textarea
                className="input-base min-h-28 resize-y"
                value={evalTaskForm.prompt}
                onChange={(event) =>
                  onEvalTaskFormChange({ ...evalTaskForm, prompt: event.target.value })
                }
                required
              />
            </ControlPlaneField>
            <ControlPlaneField label={cp.fields.mustContain}>
              <Input
                value={evalTaskForm.mustContain}
                onChange={(event) =>
                  onEvalTaskFormChange({ ...evalTaskForm, mustContain: event.target.value })
                }
              />
            </ControlPlaneField>
            <Button type="submit" variant="primary" disabled={busy === 'eval-task-create'}>
              {busy === 'eval-task-create' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {cp.actions.create}
            </Button>
          </form>
        </ControlPlaneSection>

        <ControlPlaneSection title={cp.sections.evalRun} icon={Play}>
          <form onSubmit={onEvalRunSubmit} className="space-y-3">
            <ControlPlaneField label={cp.fields.task}>
              <select
                className="input-base"
                value={evalRunForm.taskId}
                onChange={(event) =>
                  onEvalRunFormChange({ ...evalRunForm, taskId: event.target.value })
                }
              >
                <option value="">{cp.options.selectTask}</option>
                {evalTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name}
                  </option>
                ))}
              </select>
            </ControlPlaneField>
            <div className="grid gap-3 sm:grid-cols-2">
              <ControlPlaneField label={cp.fields.agent}>
                <Input
                  value={evalRunForm.agentType}
                  onChange={(event) =>
                    onEvalRunFormChange({ ...evalRunForm, agentType: event.target.value })
                  }
                />
              </ControlPlaneField>
              <ControlPlaneField label={cp.fields.model}>
                <Input
                  value={evalRunForm.model}
                  onChange={(event) =>
                    onEvalRunFormChange({ ...evalRunForm, model: event.target.value })
                  }
                />
              </ControlPlaneField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ControlPlaneField label={cp.fields.deviceId}>
                <Input
                  value={evalRunForm.deviceId}
                  onChange={(event) =>
                    onEvalRunFormChange({ ...evalRunForm, deviceId: event.target.value })
                  }
                />
              </ControlPlaneField>
              <ControlPlaneField label={cp.fields.project}>
                <select
                  className="input-base"
                  value={evalRunForm.projectId}
                  onChange={(event) =>
                    onEvalRunFormChange({ ...evalRunForm, projectId: event.target.value })
                  }
                >
                  <option value="">{cp.options.none}</option>
                  {enabledProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </ControlPlaneField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ControlPlaneField label={cp.fields.workingDirectory}>
                <Input
                  value={evalRunForm.workingDirectory}
                  onChange={(event) =>
                    onEvalRunFormChange({
                      ...evalRunForm,
                      workingDirectory: event.target.value,
                    })
                  }
                />
              </ControlPlaneField>
              <ControlPlaneField label={cp.fields.permission}>
                <select
                  className="input-base"
                  value={evalRunForm.permissionMode}
                  onChange={(event) =>
                    onEvalRunFormChange({ ...evalRunForm, permissionMode: event.target.value })
                  }
                >
                  <option value="read-only">{cp.permissionModes.readOnly}</option>
                  <option value="default">{cp.permissionModes.default}</option>
                  <option value="auto-review">{cp.permissionModes.autoReview}</option>
                  <option value="full-access">{cp.permissionModes.fullAccess}</option>
                </select>
              </ControlPlaneField>
            </div>
            <ControlPlaneField label={cp.fields.sessionId}>
              <Input
                value={evalRunForm.sessionId}
                onChange={(event) =>
                  onEvalRunFormChange({ ...evalRunForm, sessionId: event.target.value })
                }
              />
            </ControlPlaneField>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={evalRunForm.useRag}
                onChange={(event) =>
                  onEvalRunFormChange({ ...evalRunForm, useRag: event.target.checked })
                }
              />
              {cp.fields.useRag}
            </label>
            <Button
              type="submit"
              variant="primary"
              disabled={!evalRunForm.taskId || busy === 'eval-run-create'}
            >
              {busy === 'eval-run-create' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {cp.actions.run}
            </Button>
          </form>
        </ControlPlaneSection>

        <ControlPlaneSection title={cp.sections.evalMatrix} icon={ClipboardCheck}>
          <form onSubmit={onEvalMatrixSubmit} className="space-y-3">
            <ControlPlaneField label={cp.fields.taskIds}>
              <Input
                value={evalMatrixForm.taskIds}
                onChange={(event) =>
                  onEvalMatrixFormChange({ ...evalMatrixForm, taskIds: event.target.value })
                }
              />
            </ControlPlaneField>
            <div className="grid gap-3 sm:grid-cols-2">
              <ControlPlaneField label={cp.fields.agents}>
                <Input
                  value={evalMatrixForm.agentTypes}
                  onChange={(event) =>
                    onEvalMatrixFormChange({
                      ...evalMatrixForm,
                      agentTypes: event.target.value,
                    })
                  }
                />
              </ControlPlaneField>
              <ControlPlaneField label={cp.fields.models}>
                <Input
                  value={evalMatrixForm.models}
                  onChange={(event) =>
                    onEvalMatrixFormChange({ ...evalMatrixForm, models: event.target.value })
                  }
                />
              </ControlPlaneField>
            </div>
            <ControlPlaneField label={cp.fields.promptVariants}>
              <Input
                value={evalMatrixForm.promptVariants}
                onChange={(event) =>
                  onEvalMatrixFormChange({
                    ...evalMatrixForm,
                    promptVariants: event.target.value,
                  })
                }
              />
            </ControlPlaneField>
            <ControlPlaneField label={cp.fields.ragVariants}>
              <select
                className="input-base"
                value={evalMatrixForm.ragVariants}
                onChange={(event) =>
                  onEvalMatrixFormChange({ ...evalMatrixForm, ragVariants: event.target.value })
                }
              >
                <option value="off">{cp.options.off}</option>
                <option value="on">{cp.options.on}</option>
                <option value="both">{cp.options.both}</option>
              </select>
            </ControlPlaneField>
            <Button
              type="submit"
              variant="secondary"
              disabled={
                (!evalRunForm.taskId && !evalMatrixForm.taskIds.trim()) ||
                busy === 'eval-matrix-create'
              }
            >
              {busy === 'eval-matrix-create' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {cp.actions.runMatrix}
            </Button>
          </form>
        </ControlPlaneSection>
      </div>

      <ControlPlaneSection title={cp.sections.runs} icon={ClipboardCheck}>
        <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
          <Link
            className="inline-flex h-8 items-center gap-2 rounded-xs border border-border-default bg-bg-surface-2 px-3 text-xs font-semibold text-text-primary transition-colors duration-140 hover:border-border-strong hover:bg-bg-surface-3"
            to="/evals"
          >
            <BarChart3 className="h-4 w-4" />
            {cp.actions.openEvalDashboard}
          </Link>
          <a
            className="text-sm text-accent hover:underline"
            href="/api/evals/report"
            target="_blank"
            rel="noreferrer"
          >
            {cp.actions.exportSummaryJson}
          </a>
        </div>
        <div className="mb-4 space-y-2">
          {evalTasks.map((task) => (
            <SurfaceItem key={task.id}>
              <p className="text-sm font-medium text-text-primary">{task.name}</p>
              <p className="mt-1 break-all text-xs text-text-tertiary">{task.repo}</p>
            </SurfaceItem>
          ))}
          {evalTasks.length === 0 && (
            <p className="text-sm text-text-tertiary">{cp.empty.noEvalTasks}</p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.08em] text-text-tertiary">
              <tr className="border-b border-border-soft">
                <th className="py-2 pr-3 font-semibold">{cp.tables.evals.run}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.evals.agent}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.evals.status}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.evals.score}</th>
                <th className="py-2 pr-3 font-semibold">{cp.tables.evals.created}</th>
                <th className="py-2 font-semibold">{cp.tables.evals.report}</th>
              </tr>
            </thead>
            <tbody>
              {evalRuns.map((run) => (
                <tr key={run.id} className="border-b border-border-soft last:border-0">
                  <td className="py-2 pr-3 font-mono text-xs text-text-primary">{run.id}</td>
                  <td className="py-2 pr-3 text-text-secondary">
                    {run.agentType}
                    {run.model ? ` / ${run.model}` : ''}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={statusTone(run.status)}>
                      {mappedLabel(cp.statusLabels, run.status)}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-text-secondary">
                    {typeof run.metrics.score === 'number' ? percent(run.metrics.score) : '-'}
                  </td>
                  <td className="py-2 pr-3 text-text-tertiary">{formatDateTime(run.createdAt)}</td>
                  <td className="py-2">
                    <a
                      className="text-accent hover:underline"
                      href={`/api/evals/runs/${encodeURIComponent(run.id)}/report`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      JSON
                    </a>
                  </td>
                </tr>
              ))}
              {evalRuns.length === 0 && (
                <tr>
                  <td className="py-4 text-text-tertiary" colSpan={6}>
                    {cp.empty.noEvalRuns}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ControlPlaneSection>
    </div>
  );
}
