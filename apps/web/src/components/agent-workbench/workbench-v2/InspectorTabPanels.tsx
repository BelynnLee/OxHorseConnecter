import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useT } from '../../../i18n/index.ts';
import type { Translations } from '../../../i18n/locales/en.ts';
import type {
  ApprovalTimelineItem,
  ExportOptions,
  PatchAppliedTimelineItem,
  WorkbenchContextSummary,
  WorkbenchDiff,
  WorkbenchDiffFile,
  WorkbenchInitPlan,
  WorkbenchLog,
  WorkbenchPermissionHit,
  WorkbenchPermissionRule,
  WorkbenchPermissionRuleInput,
  WorkbenchSession,
  WorkbenchUsage,
} from './types.ts';
import type { ExportDelivery, InspectorTab } from './InspectorPanelTypes.ts';
import { InspectorFileActionToolbar } from './InspectorFileActionToolbar.tsx';
import { compactPath, formatTime, JsonBlock, RiskBadge, riskForApproval } from './utils.tsx';

function changeTypeLabel(changeType: WorkbenchDiffFile['changeType'], t: Translations): string {
  if (changeType === 'added') return t.workbench.review.changeTypes.created;
  if (changeType === 'deleted') return t.workbench.review.changeTypes.deleted;
  return t.workbench.review.changeTypes.modified;
}

function ApprovalDetail({ item }: { item: ApprovalTimelineItem }) {
  const { t } = useT();
  const risk = riskForApproval(item.required?.actionType ?? 'run_command');
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <RiskBadge risk={risk} />
        <span className="rounded-pill border border-border-soft bg-bg-app px-2 py-1 text-xs text-text-secondary">
          {item.resolved?.decision ?? t.workbench.statusLabels.waiting_approval}
        </span>
      </div>
      <div className="text-sm text-text-secondary">
        {item.required?.description ?? item.resolved?.reason}
      </div>
      <JsonBlock
        value={item.required?.payload ?? item.resolved ?? { approvalId: item.approvalId }}
      />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-border-soft bg-bg-surface-2 px-3 py-4 text-sm text-text-tertiary">
      {children}
    </div>
  );
}

export function InspectorActionsTab({
  session,
  summaries,
  permissionRules,
  permissionHits,
  usage,
  initPlan,
  busyAction,
  exportOptions,
  onExportOptionsChange,
  onChangeTab,
  onCompact,
  onExport,
  onPlanInitClaude,
  onApplyInitClaude,
}: {
  session?: WorkbenchSession;
  summaries: WorkbenchContextSummary[];
  permissionRules: WorkbenchPermissionRule[];
  permissionHits: WorkbenchPermissionHit[];
  usage?: WorkbenchUsage | null;
  initPlan?: WorkbenchInitPlan | null;
  busyAction?: string;
  exportOptions: ExportOptions;
  onExportOptionsChange: Dispatch<SetStateAction<ExportOptions>>;
  onChangeTab: (tab: InspectorTab) => void;
  onCompact?: () => void;
  onExport?: (options: ExportOptions, delivery: ExportDelivery) => void;
  onPlanInitClaude?: () => void;
  onApplyInitClaude?: () => void;
}) {
  const { t } = useT();
  const usedSummaries = summaries.filter((summary) => summary.usedInResume).length;
  const injectedSummaries = summaries.filter((summary) => summary.injectedIntoProvider).length;

  return (
    <div className="space-y-4">
      <section className="rounded-sm border border-border-soft bg-bg-surface-2 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-text-primary">
              {t.workbench.review.permissionRules}
            </div>
            <div className="mt-0.5 text-[11px] text-text-tertiary">
              {permissionRules.length} {t.workbench.review.permissionRules.toLowerCase()} -{' '}
              {permissionHits.length} {t.workbench.v2.recentPermissionHits.toLowerCase()}
            </div>
          </div>
          <button
            data-testid="context-permissions-open"
            type="button"
            className="btn-secondary h-7 px-2 text-xs"
            onClick={() => onChangeTab('approvals')}
          >
            {t.workbench.v2.manage}
          </button>
        </div>
      </section>

      <section className="rounded-sm border border-border-soft bg-bg-surface-2 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-text-primary">
              {t.workbench.review.compactSummaries}
            </div>
            <div className="mt-0.5 text-[11px] text-text-tertiary">
              {t.workbench.v2.savedSummaries(summaries.length)}
            </div>
          </div>
          <button
            data-testid="compact-session"
            type="button"
            className="btn-secondary h-7 px-2 text-xs"
            disabled={!session || busyAction === 'compact'}
            onClick={onCompact}
          >
            {busyAction === 'compact'
              ? t.workbench.v2.compacting
              : t.workbench.composer.commands.compact}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-text-tertiary">{t.workbench.v2.saved}</div>
            <div className="font-semibold text-text-primary">{summaries.length}</div>
          </div>
          <div>
            <div className="text-text-tertiary">{t.workbench.v2.used}</div>
            <div className="font-semibold text-text-primary" data-testid="context-used-count">
              {usedSummaries}
            </div>
          </div>
          <div>
            <div className="text-text-tertiary">{t.workbench.v2.injected}</div>
            <div className="font-semibold text-text-primary">{injectedSummaries}</div>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {summaries.slice(0, 4).map((summary) => (
            <div
              key={summary.id}
              className="rounded-xs bg-bg-app px-2 py-2 ring-1 ring-border-soft"
            >
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-tertiary">
                <span>{formatTime(summary.createdAt)}</span>
                <span
                  data-testid="context-summary-used"
                  className="rounded-xs bg-bg-surface-2 px-1 py-0.5"
                >
                  {summary.usedInResume ? t.workbench.v2.usedInResume : t.workbench.v2.notUsed}
                </span>
                <span className="rounded-xs bg-bg-surface-2 px-1 py-0.5">
                  {summary.injectedIntoProvider
                    ? t.workbench.review.compactInjected
                    : t.workbench.review.compactLocal}
                </span>
              </div>
              <div className="mt-1 text-xs leading-5 text-text-secondary">{summary.summary}</div>
            </div>
          ))}
          {!summaries.length && (
            <div className="text-xs text-text-tertiary">{t.workbench.review.noCompactSummary}</div>
          )}
        </div>
      </section>

      <section className="rounded-sm border border-border-soft bg-bg-surface-2 px-3 py-3">
        <div className="text-xs font-semibold text-text-primary">{t.workbench.v2.tokenUsage}</div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="truncate text-[11px] text-text-tertiary">
            {usage?.model ?? t.workbench.common.providerDefault}
          </div>
          {usage?.estimated && (
            <span className="text-[11px] text-text-tertiary">{t.workbench.review.estimated}</span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-text-tertiary">{t.workbench.v2.input}</div>
            <div className="font-semibold text-text-primary">
              {(usage?.inputTokens ?? 0).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-text-tertiary">{t.workbench.v2.output}</div>
            <div className="font-semibold text-text-primary">
              {(usage?.outputTokens ?? 0).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-text-tertiary">{t.workbench.v2.total}</div>
            <div className="font-semibold text-text-primary">
              {(usage?.totalTokens ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
        {usage?.totalCost !== undefined && (
          <div className="mt-2 text-[11px] text-text-tertiary">
            {t.workbench.v2.cost(usage.currency ?? 'USD', usage.totalCost.toFixed(6))}
          </div>
        )}
      </section>

      <section className="rounded-sm border border-border-soft bg-bg-surface-2 px-3 py-3">
        <div className="text-xs font-semibold text-text-primary">
          {t.workbench.v2.exportSession}
        </div>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              data-testid="export-include-diff"
              type="checkbox"
              checked={exportOptions.includeDiff}
              onChange={(event) =>
                onExportOptionsChange((current) => ({
                  ...current,
                  includeDiff: event.target.checked,
                }))
              }
            />
            {t.workbench.review.includeFullDiff}
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              data-testid="export-include-raw-logs"
              type="checkbox"
              checked={exportOptions.includeRawLogs}
              onChange={(event) =>
                onExportOptionsChange((current) => ({
                  ...current,
                  includeRawLogs: event.target.checked,
                }))
              }
            />
            {t.workbench.review.includeSanitizedRawLogs}
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            data-testid="export-copy-markdown"
            type="button"
            className="btn-secondary h-7 px-2 text-xs"
            disabled={!session || busyAction === 'export'}
            onClick={() => onExport?.(exportOptions, 'copy')}
          >
            {t.workbench.review.copyMarkdown}
          </button>
          <button
            data-testid="export-download-markdown"
            type="button"
            className="btn-secondary h-7 px-2 text-xs"
            disabled={!session || busyAction === 'export'}
            onClick={() => onExport?.(exportOptions, 'download')}
          >
            {t.workbench.review.downloadMarkdown}
          </button>
        </div>
      </section>

      <section className="rounded-sm border border-border-soft bg-bg-surface-2 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-text-primary">
              {t.workbench.v2.claudeProjectInit}
            </div>
            <div className="mt-0.5 text-[11px] text-text-tertiary">
              {t.workbench.v2.claudeProjectInitHint}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              data-testid="init-claude-plan"
              type="button"
              className="btn-secondary h-7 px-2 text-xs"
              disabled={!session || busyAction === 'init-plan'}
              onClick={onPlanInitClaude}
            >
              {t.workbench.review.scan}
            </button>
            <button
              data-testid="init-claude-apply"
              type="button"
              className="btn-secondary h-7 px-2 text-xs"
              disabled={!session || !initPlan || busyAction === 'init-apply'}
              onClick={onApplyInitClaude}
            >
              {t.workbench.review.apply}
            </button>
          </div>
        </div>
        {initPlan && (
          <div className="mt-3 space-y-2">
            <div className="text-[11px] text-text-tertiary">
              {t.workbench.v2.statusPrefix(initPlan.status ?? t.workbench.review.planned)}
            </div>
            {initPlan.files.map((file) => (
              <div
                key={`${file.path}-${file.action}`}
                className="rounded-xs bg-bg-app px-2 py-2 ring-1 ring-border-soft"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-text-primary">
                    {compactPath(file.path)}
                  </span>
                  <span className="text-[11px] text-text-tertiary">{file.action}</span>
                </div>
                <div className="mt-1 text-xs text-text-secondary">{file.reason}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function InspectorFilesTab({
  session,
  diff,
  diffFiles,
  patchItems,
  busyAction,
  onRefreshDiff,
  onDiscardAll,
  onOpenFile,
  onDiscardFile,
  onSelectDiffFile,
}: {
  session?: WorkbenchSession;
  diff?: WorkbenchDiff | null;
  diffFiles: WorkbenchDiffFile[];
  patchItems: PatchAppliedTimelineItem[];
  busyAction?: string;
  onRefreshDiff?: () => void;
  onDiscardAll?: () => void;
  onOpenFile?: (filePath: string) => void;
  onDiscardFile?: (filePath: string) => void;
  onSelectDiffFile: (filePath: string) => void;
}) {
  const { t } = useT();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-text-tertiary">
          {t.workbench.v2.changedFilesCount(diffFiles.length)}
          {typeof diff?.insertions === 'number' || typeof diff?.deletions === 'number'
            ? ` - +${diff?.insertions ?? 0} -${diff?.deletions ?? 0}`
            : ''}
        </div>
        <div className="flex gap-2">
          <button
            data-testid="diff-refresh"
            type="button"
            className="btn-secondary h-7 px-2 text-xs"
            disabled={!session || busyAction === 'diff'}
            onClick={onRefreshDiff}
          >
            {t.refresh}
          </button>
          <button
            data-testid="diff-discard-all"
            type="button"
            className="btn-secondary h-7 px-2 text-xs"
            disabled={!session || !diffFiles.length || busyAction === 'discard'}
            onClick={onDiscardAll}
          >
            {t.workbench.review.discardAll}
          </button>
        </div>
      </div>

      {diffFiles.map((file) => (
        <div
          key={file.filePath}
          className="rounded-sm border border-border-soft bg-bg-surface-2 px-3 py-2"
          data-testid="changed-file-row"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-mono text-xs text-text-primary">
                {compactPath(file.filePath)}
              </div>
              <div className="mt-1 text-[11px] text-text-tertiary">
                {changeTypeLabel(file.changeType, t)} - +{file.insertions ?? 0} -
                {file.deletions ?? 0}
              </div>
            </div>
            <InspectorFileActionToolbar
              filePath={file.filePath}
              onOpenFile={onOpenFile}
              onSelectDiffFile={onSelectDiffFile}
              onDiscardFile={onDiscardFile}
            />
          </div>
        </div>
      ))}

      {patchItems.map((item) => (
        <div
          key={item.id}
          className="rounded-sm border border-success/30 bg-success-soft px-3 py-2"
        >
          <div className="text-xs font-semibold text-text-primary">
            {t.workbench.v2.patchApplied}
          </div>
          <div className="mt-1 space-y-1">
            {item.event.filePaths.map((filePath) => (
              <div key={filePath} className="font-mono text-xs text-text-secondary">
                {compactPath(filePath)}
              </div>
            ))}
          </div>
        </div>
      ))}

      {!diffFiles.length && !patchItems.length && (
        <EmptyState>{t.workbench.v2.filesRecordedEmpty}</EmptyState>
      )}
    </div>
  );
}

export function InspectorApprovalsTab({
  selectedApproval,
  newRule,
  permissionRules,
  permissionHits,
  onRuleChange,
  onCreateRule,
  onTogglePermissionRule,
  onDeletePermissionRule,
}: {
  selectedApproval?: ApprovalTimelineItem;
  newRule: WorkbenchPermissionRuleInput;
  permissionRules: WorkbenchPermissionRule[];
  permissionHits: WorkbenchPermissionHit[];
  onRuleChange: Dispatch<SetStateAction<WorkbenchPermissionRuleInput>>;
  onCreateRule: () => void;
  onTogglePermissionRule?: (rule: WorkbenchPermissionRule) => void;
  onDeletePermissionRule?: (id: string) => void;
}) {
  const { t } = useT();

  return (
    <div className="space-y-3">
      {selectedApproval ? (
        <ApprovalDetail item={selectedApproval} />
      ) : (
        <EmptyState>{t.workbench.review.noApprovals}</EmptyState>
      )}

      <div className="rounded-sm border border-border-soft bg-bg-surface-2 px-3 py-3">
        <div className="text-xs font-semibold text-text-primary">
          {t.workbench.review.permissionRules}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <select
            data-testid="permission-rule-type"
            className="input-base h-8 px-2 py-1 text-xs"
            value={newRule.ruleType}
            onChange={(event) =>
              onRuleChange((current) => ({
                ...current,
                ruleType: event.target.value as WorkbenchPermissionRuleInput['ruleType'],
              }))
            }
          >
            <option value="command">{t.workbench.review.ruleTypes.command}</option>
            <option value="file">{t.workbench.review.ruleTypes.file}</option>
            <option value="tool">{t.workbench.review.ruleTypes.tool}</option>
            <option value="prompt">{t.workbench.review.ruleTypes.prompt}</option>
            <option value="risk">{t.workbench.review.ruleTypes.risk}</option>
          </select>
          <select
            data-testid="permission-rule-decision"
            className="input-base h-8 px-2 py-1 text-xs"
            value={newRule.decision}
            onChange={(event) =>
              onRuleChange((current) => ({
                ...current,
                decision: event.target.value as WorkbenchPermissionRuleInput['decision'],
              }))
            }
          >
            <option value="allow">{t.workbench.review.ruleDecisions.allow}</option>
            <option value="ask">{t.workbench.review.ruleDecisions.ask}</option>
            <option value="deny">{t.workbench.review.ruleDecisions.deny}</option>
          </select>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            data-testid="permission-rule-pattern"
            className="input-base h-8 px-2 py-1 text-xs"
            value={newRule.pattern}
            onChange={(event) =>
              onRuleChange((current) => ({ ...current, pattern: event.target.value }))
            }
            placeholder={t.workbench.v2.permissionRulePattern}
            aria-label={t.workbench.v2.permissionRulePattern}
          />
          <button
            data-testid="permission-rule-add"
            type="button"
            className="btn-secondary h-8 px-2 text-xs"
            disabled={!newRule.pattern.trim()}
            onClick={onCreateRule}
          >
            {t.workbench.review.addRule}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {permissionRules.map((rule) => (
            <div key={rule.id} className="rounded-xs border border-border-soft bg-bg-app px-2 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-text-primary">{rule.pattern}</div>
                  <div className="mt-1 text-[11px] text-text-tertiary">
                    {rule.provider} - {t.workbench.review.ruleTypes[rule.ruleType]} -{' '}
                    {t.workbench.review.ruleDecisions[rule.decision]} -{' '}
                    {rule.enabled ? t.workbench.common.enabled : t.workbench.common.disabled}
                  </div>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button
                    type="button"
                    className="btn-ghost h-7 px-2 text-xs"
                    disabled={rule.builtIn}
                    onClick={() => onTogglePermissionRule?.(rule)}
                  >
                    {rule.enabled ? t.workbench.review.disable : t.workbench.review.enable}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost h-7 px-2 text-xs"
                    disabled={rule.builtIn}
                    onClick={() => onDeletePermissionRule?.(rule.id)}
                  >
                    {t.workbench.review.delete}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!permissionRules.length && (
            <div className="text-xs text-text-tertiary">{t.workbench.v2.noPermissionRules}</div>
          )}
        </div>
      </div>

      <div className="rounded-sm border border-border-soft bg-bg-surface-2 px-3 py-3">
        <div className="text-xs font-semibold text-text-primary">
          {t.workbench.v2.recentPermissionHits}
        </div>
        <div className="mt-3 space-y-2">
          {permissionHits.map((hit) => (
            <div key={hit.id} className="rounded-xs border border-border-soft bg-bg-app px-2 py-2">
              <div className="flex justify-between gap-2 text-[11px] text-text-tertiary">
                <span>
                  {hit.provider} - {hit.inputType}
                </span>
                <span>{formatTime(hit.createdAt)}</span>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-text-primary">
                {hit.inputValue}
              </div>
              <div className="mt-1 text-xs text-text-secondary">
                {hit.decision}: {hit.reason}
              </div>
            </div>
          ))}
          {!permissionHits.length && (
            <div className="text-xs text-text-tertiary">
              {t.workbench.v2.noRecentPermissionHits}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function InspectorLogsTab({
  logSearch,
  displayedLogs,
  onLogSearchChange,
}: {
  logSearch: string;
  displayedLogs: WorkbenchLog[];
  onLogSearchChange: Dispatch<SetStateAction<string>>;
}) {
  const { t } = useT();

  return (
    <div className="space-y-3">
      <input
        className="input-base h-8 px-2 py-1 text-xs"
        value={logSearch}
        onChange={(event) => onLogSearchChange(event.target.value)}
        placeholder={t.workbench.v2.filterLogs}
        aria-label={t.workbench.v2.filterLogs}
      />
      {displayedLogs.length ? (
        <div className="space-y-2">
          {displayedLogs.map((log) => (
            <div
              key={log.id}
              className="rounded-sm border border-border-soft bg-bg-surface-2 px-3 py-2"
            >
              <div className="flex justify-between gap-2 text-[11px] text-text-tertiary">
                <span>{log.level}</span>
                <span>{formatTime(log.timestamp)}</span>
              </div>
              <div className="mt-1 whitespace-pre-wrap font-mono text-xs text-text-secondary">
                {log.message}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>{t.workbench.review.noLogs}</EmptyState>
      )}
    </div>
  );
}
