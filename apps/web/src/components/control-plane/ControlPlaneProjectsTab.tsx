import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { FolderGit2, Loader2, Plus, Power, Search, ShieldCheck, Trash2 } from 'lucide-react';
import type { AgentPermissionRule, Device, Project } from '../../types.ts';
import { useT } from '../../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { SurfaceItem } from '../ui/SurfaceItem.tsx';
import {
  ControlPlaneField,
  ControlPlaneSection,
  mappedLabel,
  statusTone,
} from './ControlPlaneCommon.tsx';

type ProjectForm = {
  deviceId: string;
  name: string;
  path: string;
  description: string;
};

type PermissionForm = {
  projectId: string;
  provider: string;
  ruleType: string;
  pattern: string;
  decision: string;
  riskLevel: string;
  description: string;
};

export function ControlPlaneProjectsTab({
  projects,
  devices,
  permissionRules,
  projectForm,
  permissionForm,
  gitStatus,
  busy,
  onProjectFormChange,
  onPermissionFormChange,
  onProjectSubmit,
  onPermissionSubmit,
  onTogglePermissionRule,
  onDeletePermissionRule,
  onLoadGitStatus,
  onToggleProject,
}: {
  projects: Project[];
  devices: Device[];
  permissionRules: AgentPermissionRule[];
  projectForm: ProjectForm;
  permissionForm: PermissionForm;
  gitStatus: Record<string, string>;
  busy: string;
  onProjectFormChange: Dispatch<SetStateAction<ProjectForm>>;
  onPermissionFormChange: Dispatch<SetStateAction<PermissionForm>>;
  onProjectSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPermissionSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTogglePermissionRule: (rule: AgentPermissionRule) => void;
  onDeletePermissionRule: (rule: AgentPermissionRule) => void;
  onLoadGitStatus: (project: Project) => void;
  onToggleProject: (project: Project) => void;
}) {
  const { t } = useT();
  const cp = t.controlPlane;
  const selectedDevice = devices.find((device) => device.id === projectForm.deviceId);
  const selectedDeviceReady = Boolean(
    selectedDevice?.trusted &&
      selectedDevice.status === 'online' &&
      selectedDevice.workRoot &&
      selectedDevice.workRootExists !== false
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
      <div className="space-y-4">
        <ControlPlaneSection title={cp.sections.registerProject} icon={Plus}>
          <form onSubmit={onProjectSubmit} className="space-y-3">
            <ControlPlaneField label={cp.fields.device}>
              <select
                className="input-base"
                value={projectForm.deviceId}
                onChange={(event) =>
                  onProjectFormChange({ ...projectForm, deviceId: event.target.value })
                }
                required
              >
                <option value="">{cp.options.selectDevice}</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name} {device.workRootExists === false ? '(workspace unavailable)' : ''}
                  </option>
                ))}
              </select>
            </ControlPlaneField>
            <ControlPlaneField label={cp.fields.path}>
              <Input
                value={projectForm.path}
                onChange={(event) =>
                  onProjectFormChange({ ...projectForm, path: event.target.value })
                }
                required
              />
            </ControlPlaneField>
            <ControlPlaneField label={cp.fields.name}>
              <Input
                value={projectForm.name}
                onChange={(event) =>
                  onProjectFormChange({ ...projectForm, name: event.target.value })
                }
              />
            </ControlPlaneField>
            <ControlPlaneField label={cp.fields.description}>
              <Input
                value={projectForm.description}
                onChange={(event) =>
                  onProjectFormChange({ ...projectForm, description: event.target.value })
                }
              />
            </ControlPlaneField>
            <Button
              type="submit"
              variant="primary"
              disabled={
                busy === 'project-create' ||
                !projectForm.path.trim() ||
                !projectForm.deviceId ||
                !selectedDeviceReady
              }
            >
              {busy === 'project-create' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {cp.actions.register}
            </Button>
          </form>
        </ControlPlaneSection>

        <ControlPlaneSection title={cp.sections.projectPolicy} icon={ShieldCheck}>
          <form onSubmit={onPermissionSubmit} className="space-y-3">
            <ControlPlaneField label={cp.fields.project}>
              <select
                className="input-base"
                value={permissionForm.projectId}
                onChange={(event) =>
                  onPermissionFormChange({ ...permissionForm, projectId: event.target.value })
                }
              >
                <option value="">{cp.options.selectProject}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </ControlPlaneField>
            <div className="grid gap-3 sm:grid-cols-2">
              <ControlPlaneField label={cp.fields.ruleType}>
                <select
                  className="input-base"
                  value={permissionForm.ruleType}
                  onChange={(event) =>
                    onPermissionFormChange({ ...permissionForm, ruleType: event.target.value })
                  }
                >
                  <option value="command">{cp.ruleTypes.command}</option>
                  <option value="file">{cp.ruleTypes.file}</option>
                  <option value="tool">{cp.ruleTypes.tool}</option>
                  <option value="prompt">{cp.ruleTypes.prompt}</option>
                  <option value="risk">{cp.ruleTypes.risk}</option>
                </select>
              </ControlPlaneField>
              <ControlPlaneField label={cp.fields.decision}>
                <select
                  className="input-base"
                  value={permissionForm.decision}
                  onChange={(event) =>
                    onPermissionFormChange({ ...permissionForm, decision: event.target.value })
                  }
                >
                  <option value="ask">{cp.decisions.ask}</option>
                  <option value="deny">{cp.decisions.deny}</option>
                  <option value="allow">{cp.decisions.allow}</option>
                </select>
              </ControlPlaneField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ControlPlaneField label={cp.fields.provider}>
                <select
                  className="input-base"
                  value={permissionForm.provider}
                  onChange={(event) =>
                    onPermissionFormChange({ ...permissionForm, provider: event.target.value })
                  }
                >
                  <option value="all">{cp.options.all}</option>
                  <option value="shell">shell</option>
                  <option value="codex">codex</option>
                  <option value="claude-code">claude-code</option>
                  <option value="mock">mock</option>
                </select>
              </ControlPlaneField>
              <ControlPlaneField label={cp.fields.risk}>
                <select
                  className="input-base"
                  value={permissionForm.riskLevel}
                  onChange={(event) =>
                    onPermissionFormChange({ ...permissionForm, riskLevel: event.target.value })
                  }
                >
                  <option value="low">{cp.riskLevels.low}</option>
                  <option value="medium">{cp.riskLevels.medium}</option>
                  <option value="high">{cp.riskLevels.high}</option>
                  <option value="critical">{cp.riskLevels.critical}</option>
                </select>
              </ControlPlaneField>
            </div>
            <ControlPlaneField label={cp.fields.pattern}>
              <Input
                value={permissionForm.pattern}
                onChange={(event) =>
                  onPermissionFormChange({ ...permissionForm, pattern: event.target.value })
                }
                required
              />
            </ControlPlaneField>
            <ControlPlaneField label={cp.fields.description}>
              <Input
                value={permissionForm.description}
                onChange={(event) =>
                  onPermissionFormChange({ ...permissionForm, description: event.target.value })
                }
              />
            </ControlPlaneField>
            <Button
              type="submit"
              variant="primary"
              disabled={
                !permissionForm.projectId ||
                !permissionForm.pattern.trim() ||
                busy === 'permission-create'
              }
            >
              {busy === 'permission-create' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {cp.actions.addRule}
            </Button>
          </form>

          <div className="mt-4 space-y-2">
            {permissionRules.map((rule) => (
              <SurfaceItem key={rule.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(rule.decision)}>
                        {mappedLabel(cp.decisions, rule.decision)}
                      </Badge>
                      <Badge tone="outline">{mappedLabel(cp.ruleTypes, rule.ruleType)}</Badge>
                      <Badge tone={rule.enabled ? 'success' : 'muted'}>
                        {rule.enabled ? cp.statusLabels.enabled : cp.statusLabels.disabled}
                      </Badge>
                    </div>
                    <p className="mt-1 break-all font-mono text-xs text-text-primary">
                      {rule.pattern}
                    </p>
                    {rule.description && (
                      <p className="mt-1 text-xs text-text-tertiary">{rule.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onTogglePermissionRule(rule)}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => onDeletePermissionRule(rule)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </SurfaceItem>
            ))}
            {permissionForm.projectId && permissionRules.length === 0 && (
              <p className="text-sm text-text-tertiary">{cp.empty.noProjectRules}</p>
            )}
          </div>
        </ControlPlaneSection>
      </div>

      <ControlPlaneSection title={cp.sections.projects} icon={FolderGit2}>
        <div className="space-y-3">
          {projects.map((project) => (
            <div key={project.id} className="rounded-sm border border-border-soft bg-bg-app p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-text-primary">
                      {project.name}
                    </p>
                    <Badge tone={project.enabled ? 'success' : 'danger'}>
                      {project.enabled ? cp.statusLabels.enabled : cp.statusLabels.disabled}
                    </Badge>
                    {project.defaultBranch && <Badge tone="outline">{project.defaultBranch}</Badge>}
                    <Badge tone="outline">
                      {devices.find((device) => device.id === project.deviceId)?.name ?? project.deviceId.slice(0, 8)}
                    </Badge>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-text-tertiary">
                    {project.path}
                  </p>
                  {project.gitRemote && (
                    <p className="mt-1 break-all text-xs text-text-tertiary">{project.gitRemote}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => onLoadGitStatus(project)}
                  >
                    {busy === `git-${project.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    {cp.actions.git}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={project.enabled ? 'outline' : 'primary'}
                    onClick={() => onToggleProject(project)}
                  >
                    <Power className="h-4 w-4" />
                    {project.enabled ? cp.actions.disable : cp.actions.enable}
                  </Button>
                </div>
              </div>
              {gitStatus[project.id] && (
                <pre className="mt-3 max-h-44 overflow-auto rounded-xs border border-border-soft bg-bg-surface-1 p-3 text-xs text-text-secondary">
                  {gitStatus[project.id]}
                </pre>
              )}
            </div>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-text-tertiary">{cp.empty.noProjects}</p>
          )}
        </div>
      </ControlPlaneSection>
    </div>
  );
}
