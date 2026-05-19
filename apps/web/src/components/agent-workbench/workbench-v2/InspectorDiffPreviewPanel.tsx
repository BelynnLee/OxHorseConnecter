import { useT } from '../../../i18n/index.ts';
import type { TimelineItem, WorkbenchDiffFile, WorkbenchFileContent } from './types.ts';
import type { DiffView } from './InspectorPanelTypes.ts';
import { EmptyState } from './InspectorTabPanels.tsx';
import { timelineDiffToFile } from './inspectorPanelUtils.ts';
import { classNames, compactPath } from './utils.tsx';

type InspectorDiffPreviewPanelProps = {
  selectedItem?: TimelineItem;
  selectedDiff?: WorkbenchDiffFile;
  diffFiles: WorkbenchDiffFile[];
  patchText: string;
  diffView: DiffView;
  fileContent?: WorkbenchFileContent;
  fileContentLoading: boolean;
  fileContentError?: string;
  onDiffViewChange: (view: DiffView) => void;
  onSelectDiffFile: (filePath: string) => void;
};

function CurrentFileContent({
  currentDiff,
  fileContent,
  fileContentLoading,
  fileContentError,
}: {
  currentDiff?: WorkbenchDiffFile;
  fileContent?: WorkbenchFileContent;
  fileContentLoading: boolean;
  fileContentError?: string;
}) {
  const { t } = useT();
  if (!currentDiff) {
    return <EmptyState>{t.workbench.v2.filesRecordedEmpty}</EmptyState>;
  }

  if (fileContentLoading) {
    return (
      <div
        className="rounded-sm border border-border-soft bg-bg-surface-2 px-3 py-3 text-xs text-text-tertiary"
        data-testid="file-content-loading"
      >
        {t.workbench.v2.loadingCurrentContent}
      </div>
    );
  }

  if (fileContentError) {
    return (
      <div
        className="rounded-sm border border-warning/30 bg-warning-soft px-3 py-3 text-xs text-warning"
        data-testid="file-content-error"
      >
        {fileContentError}
      </div>
    );
  }

  if (!fileContent) {
    return <EmptyState>{t.workbench.v2.currentContentUnavailable}</EmptyState>;
  }

  if (!fileContent.exists) {
    return <EmptyState>{t.workbench.v2.fileNoLongerExists}</EmptyState>;
  }

  if (fileContent.binary) {
    return <EmptyState>{t.workbench.v2.binaryPreviewUnavailable}</EmptyState>;
  }

  if (fileContent.truncated) {
    return (
      <EmptyState>
        {t.workbench.v2.fileTooLargeForPreview(fileContent.sizeBytes.toLocaleString())}
      </EmptyState>
    );
  }

  return (
    <pre
      className="max-h-72 overflow-auto rounded-sm border border-border-soft bg-bg-app p-3 font-mono text-xs leading-5 text-text-secondary"
      data-testid="file-current-content"
    >
      {fileContent.content || t.workbench.v2.emptyFile}
    </pre>
  );
}

export function InspectorDiffPreviewPanel({
  selectedItem,
  selectedDiff,
  diffFiles,
  patchText,
  diffView,
  fileContent,
  fileContentLoading,
  fileContentError,
  onDiffViewChange,
  onSelectDiffFile,
}: InspectorDiffPreviewPanelProps) {
  const { t } = useT();
  const selectedItemDiff =
    selectedItem?.type === 'file_diff'
      ? timelineDiffToFile(selectedItem)
      : diffFiles.find(
          (file) =>
            selectedItem?.type === 'patch_applied' &&
            selectedItem.event.filePaths.includes(file.filePath)
        );
  const effectiveDiff = selectedItemDiff ?? selectedDiff;
  const selectedPatch = effectiveDiff?.patch || patchText;
  const lineCount = selectedPatch ? selectedPatch.split('\n').length : 0;

  if (!selectedPatch && !effectiveDiff) {
    return <EmptyState>{t.workbench.v2.diffRecordedEmpty}</EmptyState>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs text-text-primary">
            {effectiveDiff ? compactPath(effectiveDiff.filePath) : t.workbench.v2.sessionDiff}
          </div>
          <div className="mt-0.5 text-[11px] text-text-tertiary">
            {t.workbench.v2.diffLines(lineCount)}
          </div>
        </div>
        <div className="flex rounded-sm border border-border-default bg-bg-surface-2 p-0.5">
          {(['unified', 'split'] as DiffView[]).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => onDiffViewChange(view)}
              className={classNames(
                'h-7 rounded-xs px-2 text-xs',
                diffView === view
                  ? 'bg-accent text-primary-foreground'
                  : 'text-text-tertiary hover:bg-bg-surface-3'
              )}
            >
              {view === 'unified' ? t.diff.unified : t.diff.split}
            </button>
          ))}
        </div>
      </div>

      {diffFiles.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1" data-testid="diff-file-selector">
          {diffFiles.map((file) => (
            <button
              key={file.filePath}
              type="button"
              className={classNames(
                'h-7 flex-shrink-0 rounded-xs border px-2 font-mono text-[11px]',
                file.filePath === effectiveDiff?.filePath
                  ? 'border-accent bg-accent text-primary-foreground'
                  : 'border-border-soft bg-bg-surface-2 text-text-secondary hover:bg-bg-surface-3'
              )}
              onClick={() => onSelectDiffFile(file.filePath)}
            >
              {compactPath(file.filePath)}
            </button>
          ))}
        </div>
      )}

      <section className="space-y-2" data-testid="file-content-panel">
        <div className="text-[11px] font-semibold uppercase text-text-tertiary">
          {t.workbench.v2.currentContent}
        </div>
        <CurrentFileContent
          currentDiff={effectiveDiff}
          fileContent={fileContent}
          fileContentLoading={fileContentLoading}
          fileContentError={fileContentError}
        />
      </section>

      {lineCount > 500 && (
        <div className="rounded-sm border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          {t.workbench.v2.largeDiff}
        </div>
      )}

      <div className="text-[11px] font-semibold uppercase text-text-tertiary">{t.workbench.v2.diff}</div>
      {selectedPatch && diffView === 'split' ? (
        <div className="grid gap-2 lg:grid-cols-2">
          <pre className="max-h-[calc(100vh-330px)] overflow-auto rounded-sm border border-border-soft bg-bg-app p-3 font-mono text-xs leading-5 text-text-secondary">
            {selectedPatch
              .split('\n')
              .filter((line) => !line.startsWith('+') || line.startsWith('+++'))
              .join('\n')}
          </pre>
          <pre className="max-h-[calc(100vh-330px)] overflow-auto rounded-sm border border-border-soft bg-bg-app p-3 font-mono text-xs leading-5 text-text-secondary">
            {selectedPatch
              .split('\n')
              .filter((line) => !line.startsWith('-') || line.startsWith('---'))
              .join('\n')}
          </pre>
        </div>
      ) : selectedPatch ? (
        <pre className="max-h-[calc(100vh-300px)] overflow-auto rounded-sm border border-border-soft bg-bg-app p-3 font-mono text-xs leading-5 text-text-secondary">
          {selectedPatch}
        </pre>
      ) : (
        <EmptyState>{t.diff.noPatch}</EmptyState>
      )}
    </div>
  );
}
