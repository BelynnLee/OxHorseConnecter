import { useState } from 'react';
import { AnimatedCollapse } from './AnimatedCollapse.tsx';
import { OperationItemRow } from './OperationItemRow.tsx';
import type { OperationGroupView } from './processTimelineViewModel.ts';
import type { TimelineItem } from './types.ts';
import { classNames } from './utils.tsx';

type OperationGroupProps = {
  group: OperationGroupView;
  selectedItemId?: string;
  processingApprovalId?: string;
  onSelectItem: (item: TimelineItem) => void;
  onApprovalDecision?: (approvalId: string, decision: 'approved' | 'rejected') => void;
};

function GroupStatus({ status }: { status: OperationGroupView['status'] }) {
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

export function OperationGroup({ group, selectedItemId, processingApprovalId, onSelectItem, onApprovalDecision }: OperationGroupProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="agent-operation-group" data-testid="timeline-item-activity_group">
      <button
        type="button"
        className="agent-operation-group-header"
        data-testid="tool-activity-group-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={classNames('agent-chevron', open && 'agent-chevron-open')}>v</span>
        <GroupStatus status={group.status} />
        <span className="agent-operation-summary">
          <span className="agent-operation-title">{group.title}</span>
          <span className={classNames('agent-operation-meta', group.failedCount > 0 && 'agent-operation-meta-danger')}>{group.summary}</span>
        </span>
      </button>

      <AnimatedCollapse open={open}>
        <div className="agent-operation-items">
          {group.items.map((item, index) => (
            <div key={item.id} style={{ animationDelay: `${index * 22}ms` }}>
              <OperationItemRow
                item={item}
                selected={item.source.id === selectedItemId}
                processingApprovalId={processingApprovalId}
                onSelectItem={onSelectItem}
                onApprovalDecision={onApprovalDecision}
              />
            </div>
          ))}
        </div>
      </AnimatedCollapse>
    </section>
  );
}
