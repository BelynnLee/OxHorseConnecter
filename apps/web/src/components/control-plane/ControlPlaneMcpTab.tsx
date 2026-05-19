import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Loader2, Network } from 'lucide-react';
import type { Project } from '../../types.ts';
import { useT } from '../../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { SurfaceItem } from '../ui/SurfaceItem.tsx';
import { ControlPlaneField, ControlPlaneSection } from './ControlPlaneCommon.tsx';

type McpTool = {
  name: string;
  description: string;
  mutating: boolean;
  inputSchema: Record<string, unknown>;
};

type McpForm = {
  name: string;
  projectId: string;
  sessionId: string;
  argumentsJson: string;
};

export function ControlPlaneMcpTab({
  projects,
  mcpTools,
  mcpForm,
  mcpResult,
  busy,
  onMcpFormChange,
  onSubmit,
}: {
  projects: Project[];
  mcpTools: McpTool[];
  mcpForm: McpForm;
  mcpResult?: Record<string, unknown>;
  busy: string;
  onMcpFormChange: Dispatch<SetStateAction<McpForm>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useT();
  const cp = t.controlPlane;

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <ControlPlaneSection title={cp.sections.toolCall} icon={Network}>
        <form onSubmit={onSubmit} className="space-y-3">
          <ControlPlaneField label={cp.fields.tool}>
            <select
              className="input-base"
              value={mcpForm.name}
              onChange={(event) => onMcpFormChange({ ...mcpForm, name: event.target.value })}
            >
              {mcpTools.map((tool) => (
                <option key={tool.name} value={tool.name}>
                  {tool.name}
                </option>
              ))}
            </select>
          </ControlPlaneField>
          <ControlPlaneField label={cp.fields.project}>
            <select
              className="input-base"
              value={mcpForm.projectId}
              onChange={(event) => onMcpFormChange({ ...mcpForm, projectId: event.target.value })}
            >
              <option value="">{cp.options.none}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </ControlPlaneField>
          <ControlPlaneField label={cp.fields.sessionId}>
            <Input
              value={mcpForm.sessionId}
              onChange={(event) => onMcpFormChange({ ...mcpForm, sessionId: event.target.value })}
            />
          </ControlPlaneField>
          <ControlPlaneField label={cp.fields.argumentsJson}>
            <textarea
              className="input-base min-h-48 resize-y font-mono text-xs"
              value={mcpForm.argumentsJson}
              onChange={(event) =>
                onMcpFormChange({ ...mcpForm, argumentsJson: event.target.value })
              }
            />
          </ControlPlaneField>
          <Button type="submit" variant="primary" disabled={!mcpForm.name || busy === 'mcp-call'}>
            {busy === 'mcp-call' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Network className="h-4 w-4" />
            )}
            {cp.actions.call}
          </Button>
        </form>
      </ControlPlaneSection>

      <ControlPlaneSection title={cp.sections.tools} icon={Network}>
        <div className="mb-4 space-y-2">
          {mcpTools.map((tool) => (
            <SurfaceItem key={tool.name}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-xs text-text-primary">{tool.name}</p>
                <Badge tone={tool.mutating ? 'warning' : 'info'}>
                  {tool.mutating ? cp.decisions.ask : cp.statusLabels.read}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-text-tertiary">{tool.description}</p>
            </SurfaceItem>
          ))}
        </div>
        {mcpResult ? (
          <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-sm border border-border-soft bg-bg-app p-3 text-xs text-text-secondary">
            {JSON.stringify(mcpResult, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-text-tertiary">{cp.empty.noMcpResult}</p>
        )}
      </ControlPlaneSection>
    </div>
  );
}
