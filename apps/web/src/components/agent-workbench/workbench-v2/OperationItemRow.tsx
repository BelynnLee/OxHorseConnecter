import { useState } from 'react';
import { useT } from '../../../i18n/index.ts';
import { OperationItemDetail } from './OperationItemDetail.tsx';
import type { OperationItemView } from './processTimelineViewModel.ts';
import type { TimelineItem } from './types.ts';
import { classNames, formatDuration } from './utils.tsx';

type OperationItemRowProps = {
  item: OperationItemView;
  selected?: boolean;
  processingApprovalId?: string;
  onSelectItem: (item: TimelineItem) => void;
  onApprovalDecision?: (approvalId: string, decision: 'approved' | 'rejected') => void;
};

function statusTestId(kind: OperationItemView['kind']): string {
  if (kind === 'command') return 'timeline-item-command';
  if (kind === 'tool') return 'timeline-item-tool_call';
  if (kind === 'file') return 'timeline-item-file_diff';
  if (kind === 'approval') return 'timeline-item-approval';
  if (kind === 'error') return 'timeline-item-error';
  if (kind === 'activity') return 'timeline-item-reasoning';
  return 'timeline-item-checkpoint';
}

function StatusMark({ status }: { status: OperationItemView['status'] }) {
  if (status === 'running') return <span className="agent-mini-spinner" aria-hidden="true" />;
  return (
    <span
      className={classNames(
        'agent-status-dot',
        status === 'failed' ? 'agent-status-dot-failed' : 'agent-status-dot-success',
      )}
      aria-hidden="true"
    />
  );
}

export function OperationItemRow({ item, selected = false, processingApprovalId, onSelectItem, onApprovalDecision }: OperationItemRowProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const isPatchApplied = item.kind === 'file' && item.source.type === 'patch_applied';

  return (
    <div>
      <button
        type="button"
        className={classNames(
          'agent-operation-item-row',
          selected && 'agent-operation-item-selected',
          item.status === 'failed' && 'agent-operation-item-failed',
        )}
        data-testid={isPatchApplied ? 'timeline-item-patch_applied' : statusTestId(item.kind)}
        onClick={() => {
          setOpen((current) => !current);
          onSelectItem(item.source);
        }}
      >
        <span className="w-4 text-center"><StatusMark status={item.status} /></span>
        <span className="agent-operation-activity-label">{t.workbench.v2.activity}</span>
        <span className="min-w-0 flex-1 truncate">
          {item.kind === 'command' ? (
            <code className="font-mono" data-testid="command-summary-command" title={item.rawCommand ?? item.displayName}>{item.displayName}</code>
          ) : (
            <span title={item.subtitle ?? item.displayName}>{item.displayName}</span>
          )}
        </span>
        {item.exitCode !== undefined && item.status === 'failed' && (
          <span className="flex-shrink-0 text-danger">{t.workbench.v2.exit(item.exitCode)}</span>
        )}
        <span className="w-16 flex-shrink-0 text-right text-text-tertiary">{formatDuration(item.durationMs, t.workbench.statusLabels.running)}</span>
      </button>

      {open && (
        <OperationItemDetail
          item={item}
          processingApprovalId={processingApprovalId}
          onApprovalDecision={onApprovalDecision}
          onViewFullLogs={() => onSelectItem(item.source)}
        />
      )}
    </div>
  );
}
