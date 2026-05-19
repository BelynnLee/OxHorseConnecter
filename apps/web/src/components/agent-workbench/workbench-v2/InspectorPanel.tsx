import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../../i18n/index.ts';
import type {
  ApprovalTimelineItem,
  ExportOptions,
  FileDiffTimelineItem,
  PatchAppliedTimelineItem,
  TimelineItem,
  WorkbenchContextSummary,
  WorkbenchDiff,
  WorkbenchFileContent,
  WorkbenchInitPlan,
  WorkbenchLog,
  WorkbenchPermissionRule,
  WorkbenchPermissionRuleInput,
  WorkbenchPermissionHit,
  WorkbenchSession,
  WorkbenchUsage,
} from './types.ts';
import type { DiffView, ExportDelivery, InspectorTab } from './InspectorPanelTypes.ts';
import {
  InspectorActionsTab,
  InspectorApprovalsTab,
  InspectorFilesTab,
  InspectorLogsTab,
} from './InspectorTabPanels.tsx';
import { InspectorDiffPreviewPanel } from './InspectorDiffPreviewPanel.tsx';
import { classNames } from './utils.tsx';
import { timelineDiffToFile } from './inspectorPanelUtils.ts';
import { useInspectorDiffPreview } from './useInspectorDiffPreview.ts';

export type { InspectorTab } from './InspectorPanelTypes.ts';

type InspectorPanelProps = {
  session?: WorkbenchSession;
  selectedItem?: TimelineItem;
  items: TimelineItem[];
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  activeTab?: InspectorTab;
  logs?: WorkbenchLog[];
  diff?: WorkbenchDiff | null;
  permissionRules?: WorkbenchPermissionRule[];
  permissionHits?: WorkbenchPermissionHit[];
  summaries?: WorkbenchContextSummary[];
  usage?: WorkbenchUsage | null;
  initPlan?: WorkbenchInitPlan | null;
  busyAction?: string;
  onTabChange?: (tab: InspectorTab) => void;
  onRefreshDiff?: () => void;
  onOpenFile?: (filePath: string) => void;
  onDiscardFile?: (filePath: string) => void;
  onDiscardAll?: () => void;
  onCreatePermissionRule?: (input: WorkbenchPermissionRuleInput) => void;
  onTogglePermissionRule?: (rule: WorkbenchPermissionRule) => void;
  onDeletePermissionRule?: (id: string) => void;
  onCompact?: () => void;
  onExport?: (options: ExportOptions, delivery: ExportDelivery) => void;
  onPlanInitClaude?: () => void;
  onApplyInitClaude?: () => void;
  onReadFileContent?: (filePath: string) => Promise<WorkbenchFileContent>;
};

const tabs: InspectorTab[] = ['files', 'diff', 'approvals', 'logs', 'actions'];

export function InspectorPanel({
  session,
  selectedItem,
  items,
  collapsed = false,
  onToggleCollapse,
  activeTab,
  logs,
  diff,
  permissionRules = [],
  permissionHits = [],
  summaries = [],
  usage,
  initPlan,
  busyAction,
  onTabChange,
  onRefreshDiff,
  onOpenFile,
  onDiscardFile,
  onDiscardAll,
  onCreatePermissionRule,
  onTogglePermissionRule,
  onDeletePermissionRule,
  onCompact,
  onExport,
  onPlanInitClaude,
  onApplyInitClaude,
  onReadFileContent,
}: InspectorPanelProps) {
  const { t } = useT();
  const [internalTab, setInternalTab] = useState<InspectorTab>('files');
  const [diffView, setDiffView] = useState<DiffView>('unified');
  const [logSearch, setLogSearch] = useState('');
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    includeDiff: true,
    includeRawLogs: false,
  });
  const [newRule, setNewRule] = useState<WorkbenchPermissionRuleInput>({
    provider: session?.provider ?? 'all',
    scope: 'project',
    projectPath: session?.projectPath,
    ruleType: 'command',
    pattern: '',
    decision: 'ask',
    enabled: true,
  });
  const resolvedTab = activeTab ?? internalTab;
  const approvals = useMemo(
    () => items.filter((item): item is ApprovalTimelineItem => item.type === 'approval'),
    [items]
  );
  const timelineDiffs = useMemo(
    () => items.filter((item): item is FileDiffTimelineItem => item.type === 'file_diff'),
    [items]
  );
  const patchItems = useMemo(
    () => items.filter((item): item is PatchAppliedTimelineItem => item.type === 'patch_applied'),
    [items]
  );
  const diffFiles = diff?.files.length ? diff.files : timelineDiffs.map(timelineDiffToFile);
  const patchText =
    diff?.patchText ||
    diffFiles
      .map((file) => file.patch)
      .filter(Boolean)
      .join('\n\n');
  const latestDiffPath = diffFiles.at(-1)?.filePath;
  const { selectedDiff, selectDiffFile, fileContent, fileContentLoading, fileContentError } =
    useInspectorDiffPreview({
      sessionId: session?.id,
      selectedItem,
      diffFiles,
      latestDiffPath,
      readFileContentFallback: t.workbench.v2.unableToReadFileContent,
      onReadFileContent,
    });

  useEffect(() => {
    setNewRule((current) => ({
      ...current,
      provider: current.provider === 'all' ? (session?.provider ?? 'all') : current.provider,
      projectPath: session?.projectPath,
    }));
  }, [session?.projectPath, session?.provider]);

  const timelineLogs = useMemo<WorkbenchLog[]>(() => {
    return items
      .filter((item) => item.type === 'error')
      .map((item) => ({
        id: item.id,
        sessionId: item.sessionId,
        timestamp: item.timestamp,
        level: 'error' as const,
        message: item.event.message,
      }));
  }, [items]);
  const displayedLogs = [
    ...(logs ?? []),
    ...timelineLogs.filter((log) => !(logs ?? []).some((item) => item.id === log.id)),
  ].filter((log) => {
    const query = logSearch.trim().toLowerCase();
    return !query || log.message.toLowerCase().includes(query) || log.level.includes(query);
  });

  function changeTab(tab: InspectorTab) {
    setInternalTab(tab);
    onTabChange?.(tab);
  }

  function createRule() {
    if (!newRule.pattern.trim()) return;
    onCreatePermissionRule?.({
      ...newRule,
      pattern: newRule.pattern.trim(),
      projectPath:
        newRule.scope === 'project' ? (session?.projectPath ?? newRule.projectPath) : undefined,
    });
    setNewRule((current) => ({ ...current, pattern: '' }));
  }

  function renderActionsTab() {
    return (
      <InspectorActionsTab
        session={session}
        summaries={summaries}
        permissionRules={permissionRules}
        permissionHits={permissionHits}
        usage={usage}
        initPlan={initPlan}
        busyAction={busyAction}
        exportOptions={exportOptions}
        onExportOptionsChange={setExportOptions}
        onChangeTab={changeTab}
        onCompact={onCompact}
        onExport={onExport}
        onPlanInitClaude={onPlanInitClaude}
        onApplyInitClaude={onApplyInitClaude}
      />
    );
  }

  function renderFilesTab() {
    return (
      <InspectorFilesTab
        session={session}
        diff={diff}
        diffFiles={diffFiles}
        patchItems={patchItems}
        busyAction={busyAction}
        onRefreshDiff={onRefreshDiff}
        onDiscardAll={onDiscardAll}
        onOpenFile={onOpenFile}
        onDiscardFile={onDiscardFile}
        onSelectDiffFile={(filePath) => {
          selectDiffFile(filePath);
          changeTab('diff');
        }}
      />
    );
  }

  function renderDiffTab() {
    return (
      <InspectorDiffPreviewPanel
        selectedItem={selectedItem}
        selectedDiff={selectedDiff}
        diffFiles={diffFiles}
        patchText={patchText}
        diffView={diffView}
        fileContent={fileContent}
        fileContentLoading={fileContentLoading}
        fileContentError={fileContentError}
        onDiffViewChange={setDiffView}
        onSelectDiffFile={selectDiffFile}
      />
    );
  }

  function renderApprovalsTab() {
    const selectedApproval = selectedItem?.type === 'approval' ? selectedItem : approvals[0];
    return (
      <InspectorApprovalsTab
        selectedApproval={selectedApproval}
        newRule={newRule}
        permissionRules={permissionRules}
        permissionHits={permissionHits}
        onRuleChange={setNewRule}
        onCreateRule={createRule}
        onTogglePermissionRule={onTogglePermissionRule}
        onDeletePermissionRule={onDeletePermissionRule}
      />
    );
  }

  function renderLogsTab() {
    return (
      <InspectorLogsTab
        logSearch={logSearch}
        displayedLogs={displayedLogs}
        onLogSearchChange={setLogSearch}
      />
    );
  }

  function renderTab() {
    if (resolvedTab === 'files') return renderFilesTab();
    if (resolvedTab === 'diff') return renderDiffTab();
    if (resolvedTab === 'approvals') return renderApprovalsTab();
    if (resolvedTab === 'logs') return renderLogsTab();
    return renderActionsTab();
  }

  if (collapsed) {
    return (
      <aside
        data-testid="inspector-panel"
        data-collapsed="true"
        className="agent-panel panel-swap-enter flex h-full max-h-full min-h-0 flex-col items-center gap-2 overflow-hidden py-2"
      >
        <button
          type="button"
          data-testid="inspector-panel-toggle"
          onClick={onToggleCollapse}
          aria-label={t.workbench.toolCallCard.expand}
          title={`${t.workbench.toolCallCard.expand} - ${t.workbench.v2.developerDetails}`}
          className="grid h-8 w-8 place-items-center rounded-xs text-text-tertiary hover:bg-bg-surface-2 hover:text-text-primary"
        >
          <span aria-hidden="true">{'«'}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      data-testid="inspector-panel"
      className="agent-panel panel-swap-enter flex h-full max-h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="border-b border-border-soft px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase text-text-tertiary">
              {t.workbench.v2.developerDetails}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-text-primary">
              {t.workbench.review.tabs[resolvedTab]}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-text-tertiary">
              {session?.id ?? t.workbench.noSession}
            </div>
          </div>
          {onToggleCollapse && (
            <button
              type="button"
              data-testid="inspector-panel-toggle"
              onClick={onToggleCollapse}
              aria-label={t.workbench.toolCallCard.collapse}
              title={t.workbench.toolCallCard.collapse}
              className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-xs text-text-tertiary hover:bg-bg-surface-2 hover:text-text-primary"
            >
              <span aria-hidden="true">{'»'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border-soft bg-bg-surface-1 px-2 py-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            data-testid={`inspector-tab-${tab}`}
            onClick={() => changeTab(tab)}
            className={classNames(
              'h-7 rounded-xs px-2 text-xs font-medium transition-colors',
              resolvedTab === tab
                ? 'bg-accent/15 text-text-primary ring-1 ring-accent/25'
                : 'text-text-tertiary hover:bg-bg-surface-3 hover:text-text-primary'
            )}
          >
            {t.workbench.review.tabs[tab]}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">{renderTab()}</div>
    </aside>
  );
}
