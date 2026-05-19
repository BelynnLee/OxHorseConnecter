import { useT } from '../../../i18n/index.ts';

type InspectorFileActionToolbarProps = {
  filePath: string;
  onOpenFile?: (filePath: string) => void;
  onSelectDiffFile: (filePath: string) => void;
  onDiscardFile?: (filePath: string) => void;
};

export function InspectorFileActionToolbar({
  filePath,
  onOpenFile,
  onSelectDiffFile,
  onDiscardFile,
}: InspectorFileActionToolbarProps) {
  const { t } = useT();

  return (
    <div className="flex flex-shrink-0 gap-1">
      <button
        type="button"
        className="btn-ghost h-7 px-2 text-xs"
        onClick={() => onOpenFile?.(filePath)}
      >
        {t.workbench.review.open}
      </button>
      <button
        type="button"
        className="btn-ghost h-7 px-2 text-xs"
        onClick={() => onSelectDiffFile(filePath)}
      >
        {t.diff.unified}
      </button>
      <button
        type="button"
        className="btn-ghost h-7 px-2 text-xs"
        onClick={() => onDiscardFile?.(filePath)}
      >
        {t.workbench.review.discard}
      </button>
    </div>
  );
}
