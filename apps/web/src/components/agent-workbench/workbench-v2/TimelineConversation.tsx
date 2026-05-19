import { FileSearch, ListTree, Play, ScrollText } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useT } from '../../../i18n/index.ts';
import { FinalAnswerBlock } from './FinalAnswerBlock.tsx';
import { OperationGroup } from './OperationGroup.tsx';
import { TimelineMessage } from './TimelineMessage.tsx';
import { buildProcessTimeline } from './processTimelineViewModel.ts';
import type { TimelineNode } from './processTimelineViewModel.ts';
import type { TimelineItem } from './types.ts';

type TimelineConversationProps = {
  items: TimelineItem[];
  selectedItemId?: string;
  approvalProcessingId?: string;
  running?: boolean;
  onSelectItem: (item: TimelineItem) => void;
  onApprovalDecision?: (approvalId: string, decision: 'approved' | 'rejected') => void;
  onStartRun?: () => void;
  onInspectProject?: () => void;
  onReviewLogs?: () => void;
};

export function TimelineConversation({
  items,
  selectedItemId,
  approvalProcessingId,
  onSelectItem,
  onApprovalDecision,
  onStartRun,
  onInspectProject,
  onReviewLogs,
}: TimelineConversationProps) {
  const { t } = useT();
  const scrollRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const previousItemCountRef = useRef(0);
  const previousFirstItemIdRef = useRef<string | null>(null);
  const previousLastItemIdRef = useRef<string | null>(null);
  const nodes = useMemo(() => buildProcessTimeline(items, t.workbench.v2), [items, t]);
  const firstItemId = items[0]?.id ?? null;
  const lastItemId = items[items.length - 1]?.id ?? null;

  function isPinnedToBottom(element: HTMLElement | null) {
    if (!element) return true;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom < 80;
  }

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const previousItemCount = previousItemCountRef.current;
    const previousFirstItemId = previousFirstItemIdRef.current;
    const previousLastItemId = previousLastItemIdRef.current;
    const hasTimelineChanged =
      previousItemCount !== items.length || previousFirstItemId !== firstItemId || previousLastItemId !== lastItemId;
    const hasInitialItems = previousItemCount === 0 && items.length > 0;
    const hasSessionReset =
      previousItemCount > 0 && items.length > 0 && previousFirstItemId !== null && previousFirstItemId !== firstItemId;

    previousItemCountRef.current = items.length;
    previousFirstItemIdRef.current = firstItemId;
    previousLastItemIdRef.current = lastItemId;

    if (!hasTimelineChanged) return;
    if (!hasInitialItems && !hasSessionReset && !pinnedToBottomRef.current) return;

    endRef.current?.scrollIntoView({ block: 'end', behavior: hasInitialItems ? 'auto' : 'smooth' });

    const frame = window.requestAnimationFrame(() => {
      pinnedToBottomRef.current = isPinnedToBottom(element);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [items.length, firstItemId, lastItemId]);

  function handleScroll() {
    pinnedToBottomRef.current = isPinnedToBottom(scrollRef.current);
  }

  function renderNode(node: TimelineNode) {
    if (node.type === 'user_message') {
      return (
        <TimelineMessage
          key={node.id}
          item={node.item}
          selected={node.item.id === selectedItemId}
          onSelect={() => onSelectItem(node.item)}
        />
      );
    }

    if (node.type === 'assistant_message') {
      return (
        <TimelineMessage
          key={node.id}
          item={node.item}
          selected={node.item.id === selectedItemId}
          onSelect={() => onSelectItem(node.item)}
        />
      );
    }

    if (node.type === 'operation_group') {
      return (
        <OperationGroup
          key={node.id}
          group={node.group}
          selectedItemId={selectedItemId}
          processingApprovalId={approvalProcessingId}
          onSelectItem={onSelectItem}
          onApprovalDecision={onApprovalDecision}
        />
      );
    }

    return (
      <FinalAnswerBlock
        key={node.id}
        node={node}
        selected={(node.sessionCompleted?.id ?? node.message?.id) === selectedItemId}
        onSelectItem={onSelectItem}
      />
    );
  }

  function renderNodes() {
    const rendered = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.type !== 'operation_group') {
        rendered.push(renderNode(node));
        continue;
      }

      const operationNodes = [node];
      while (nodes[index + 1]?.type === 'operation_group') {
        index += 1;
        operationNodes.push(nodes[index] as Extract<TimelineNode, { type: 'operation_group' }>);
      }

      rendered.push(
        <div key={`operation-stack-${node.id}`} className="agent-operation-stack">
          {operationNodes.map(renderNode)}
        </div>,
      );
    }
    return rendered;
  }

  return (
    <section
      ref={scrollRef}
      data-testid="agent-timeline"
      className="h-full min-h-0 overflow-y-auto bg-bg-app px-4 py-6"
      onScroll={handleScroll}
    >
      {items.length ? (
        <div className="agent-conversation-list">
          {renderNodes()}
          <div ref={endRef} />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center px-3 py-8">
          <div className="mx-auto flex max-w-[34rem] flex-col items-center text-center">
            <div className="mb-5 grid h-20 w-20 place-items-center rounded-sm border border-accent/25 bg-accent/10 text-accent">
              <ListTree aria-hidden="true" className="h-9 w-9" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">{t.workbench.v2.timelineEmpty}</h2>
            <p className="mt-2 max-w-[30rem] text-sm leading-6 text-text-tertiary">
              Select a session on the left, or use New to create a session and start working.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-primary h-9 px-3 text-sm" onClick={onStartRun}>
                <Play aria-hidden="true" className="h-4 w-4" />
                Start Run
              </button>
              <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={onInspectProject}>
                <FileSearch aria-hidden="true" className="h-4 w-4" />
                Inspect Project
              </button>
              <button type="button" className="btn-secondary h-9 px-3 text-sm" onClick={onReviewLogs}>
                <ScrollText aria-hidden="true" className="h-4 w-4" />
                Review Logs
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
