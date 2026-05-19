import { TimelineConversation } from './TimelineConversation.tsx';
import type { TimelineItem } from './types.ts';

type AgentTimelineProps = {
  items: TimelineItem[];
  selectedItemId?: string;
  approvalProcessingId?: string;
  running?: boolean;
  onSelectItem: (item: TimelineItem) => void;
  onApprovalDecision: (approvalId: string, decision: 'approved' | 'rejected') => void;
  onStartRun?: () => void;
  onInspectProject?: () => void;
  onReviewLogs?: () => void;
};

export function AgentTimeline({
  items,
  selectedItemId,
  approvalProcessingId,
  running = false,
  onSelectItem,
  onApprovalDecision,
  onStartRun,
  onInspectProject,
  onReviewLogs,
}: AgentTimelineProps) {
  return (
    <TimelineConversation
      items={items}
      selectedItemId={selectedItemId}
      approvalProcessingId={approvalProcessingId}
      running={running}
      onSelectItem={onSelectItem}
      onApprovalDecision={onApprovalDecision}
      onStartRun={onStartRun}
      onInspectProject={onInspectProject}
      onReviewLogs={onReviewLogs}
    />
  );
}
