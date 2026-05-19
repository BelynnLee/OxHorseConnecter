import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { Activity, AlertCircle, Loader2 } from 'lucide-react';
import type { AgentOperation } from '../../types.ts';
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
  statusTone,
} from './ControlPlaneCommon.tsx';

type FailureForm = {
  sessionId: string;
  error: string;
  logs: string;
};

export function ControlPlaneAnalysisTab({
  failureForm,
  failureResult,
  operations,
  busy,
  onFailureFormChange,
  onSubmit,
  onLoadOperations,
}: {
  failureForm: FailureForm;
  failureResult?: Record<string, unknown>;
  operations: AgentOperation[];
  busy: string;
  onFailureFormChange: Dispatch<SetStateAction<FailureForm>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLoadOperations: () => void;
}) {
  const { t } = useT();
  const cp = t.controlPlane;

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <ControlPlaneSection title={cp.sections.failureAnalysis} icon={AlertCircle}>
        <form onSubmit={onSubmit} className="space-y-3">
          <ControlPlaneField label={cp.fields.sessionId}>
            <Input
              value={failureForm.sessionId}
              onChange={(event) =>
                onFailureFormChange({ ...failureForm, sessionId: event.target.value })
              }
            />
          </ControlPlaneField>
          <ControlPlaneField label={cp.fields.error}>
            <Input
              value={failureForm.error}
              onChange={(event) =>
                onFailureFormChange({ ...failureForm, error: event.target.value })
              }
            />
          </ControlPlaneField>
          <ControlPlaneField label={cp.fields.logs}>
            <textarea
              className="input-base min-h-56 resize-y font-mono text-xs"
              value={failureForm.logs}
              onChange={(event) =>
                onFailureFormChange({ ...failureForm, logs: event.target.value })
              }
            />
          </ControlPlaneField>
          <Button
            type="submit"
            variant="primary"
            disabled={
              busy === 'failure-analyze' ||
              (!failureForm.sessionId.trim() &&
                !failureForm.error.trim() &&
                !failureForm.logs.trim())
            }
          >
            {busy === 'failure-analyze' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {cp.actions.analyze}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!failureForm.sessionId.trim() || busy === 'operations-load'}
            onClick={onLoadOperations}
          >
            {busy === 'operations-load' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )}
            {cp.actions.operations}
          </Button>
        </form>
      </ControlPlaneSection>

      <ControlPlaneSection title={cp.sections.result} icon={Activity}>
        {failureResult ? (
          <pre className="max-h-[680px] overflow-auto whitespace-pre-wrap rounded-sm border border-border-soft bg-bg-app p-3 text-xs text-text-secondary">
            {JSON.stringify(failureResult, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-text-tertiary">{cp.empty.noResult}</p>
        )}
        {operations.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">
              {cp.sections.agentOperations}
            </p>
            {operations.map((operation) => (
              <SurfaceItem key={operation.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge tone={statusTone(operation.status)}>
                      {mappedLabel(cp.statusLabels, operation.status)}
                    </Badge>
                    <span className="truncate text-sm text-text-primary">{operation.title}</span>
                  </div>
                  <span className="text-xs text-text-tertiary">
                    {cp.operations.events(operation.eventCount)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-tertiary">
                  {operation.type} / {formatDateTime(operation.startedAt)}
                </p>
              </SurfaceItem>
            ))}
          </div>
        )}
      </ControlPlaneSection>
    </div>
  );
}
