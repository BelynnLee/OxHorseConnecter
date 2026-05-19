import { useT } from '../../../i18n/index.ts';
import type { OperationItemView } from './processTimelineViewModel.ts';
import { CopyTextButton, formatDuration } from './utils.tsx';

type OperationItemDetailProps = {
  item: OperationItemView;
  onViewFullLogs: () => void;
  processingApprovalId?: string;
  onApprovalDecision?: (approvalId: string, decision: 'approved' | 'rejected') => void;
};

function OutputPreview({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null;
  const preview = value.trim().split(/\r?\n/u).slice(0, 8).join('\n');
  return (
    <div>
      <div className="agent-operation-detail-label">{label}</div>
      <pre className="agent-operation-output-preview">{preview}</pre>
    </div>
  );
}

function detailLabel(label: string, t: ReturnType<typeof useT>['t']): string {
  if (label === 'File') return t.workbench.conversation.labels.file;
  if (label === 'Command') return t.workbench.v2.command;
  if (label === 'Working directory') return t.workbench.v2.workingDirectory;
  return label;
}

export function OperationItemDetail({ item, onViewFullLogs, processingApprovalId, onApprovalDecision }: OperationItemDetailProps) {
  const { t } = useT();
  const approval = item.source.type === 'approval' ? item.source : undefined;
  const approvalPending = approval?.required && !approval.resolved;

  return (
    <div className="agent-operation-detail">
      <div className="grid gap-1.5 text-[11px] leading-[18px] sm:grid-cols-2">
        <div>
          <div className="agent-operation-detail-label">{t.workbench.v2.status}</div>
          <div className="text-text-secondary">{item.status}</div>
        </div>
        <div>
          <div className="agent-operation-detail-label">{t.workbench.v2.durationLabel}</div>
          <div className="text-text-secondary">{formatDuration(item.durationMs, t.workbench.statusLabels.running)}</div>
        </div>
        {typeof item.exitCode === 'number' && (
          <div>
            <div className="agent-operation-detail-label">{t.workbench.v2.exitCode}</div>
            <div className="text-text-secondary">{item.exitCode}</div>
          </div>
        )}
        {item.cwd && (
          <div>
            <div className="agent-operation-detail-label">{t.workbench.v2.workingDirectory}</div>
            <div className="truncate font-mono text-text-secondary" title={item.cwd}>{item.cwd}</div>
          </div>
        )}
      </div>

      {item.rawCommand && (
        <div>
          <div className="agent-operation-detail-label">{t.workbench.v2.command}</div>
          <code className="agent-operation-raw-command">{item.rawCommand}</code>
        </div>
      )}

      {item.details?.filter((detail) => detail.label !== t.workbench.v2.operationLabels.command && detail.label !== t.workbench.v2.operationLabels.workingDirectory).map((detail) => (
        <div key={`${item.id}-${detail.label}`}>
          <div className="agent-operation-detail-label">{detailLabel(detail.label, t)}</div>
          <div className="break-words text-[11px] leading-[18px] text-text-secondary">{detail.value}</div>
        </div>
      ))}

      <OutputPreview label={t.workbench.v2.stdoutPreview} value={item.stdout} />
      <OutputPreview label={t.workbench.v2.stderrPreview} value={item.stderr} />

      <div className="flex flex-wrap gap-2">
        {approvalPending && onApprovalDecision && (
          <>
            <button
              type="button"
              data-testid="approval-reject"
              className="btn-ghost h-7 px-2 text-xs"
              disabled={processingApprovalId === approval.approvalId}
              onClick={() => onApprovalDecision(approval.approvalId, 'rejected')}
            >
              {t.workbench.reject}
            </button>
            <button
              type="button"
              data-testid="approval-approve"
              className="btn-primary h-7 px-2 text-xs"
              disabled={processingApprovalId === approval.approvalId}
              onClick={() => onApprovalDecision(approval.approvalId, 'approved')}
            >
              {t.workbench.approve}
            </button>
          </>
        )}
        <CopyTextButton
          text={item.rawCommand ?? item.displayName}
          label={t.workbench.review.copyCommand}
          dataTestId="operation-copy-command"
        />
        <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={onViewFullLogs}>
          {t.workbench.v2.viewFullLogs}
        </button>
      </div>
    </div>
  );
}
