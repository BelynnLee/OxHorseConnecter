import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TimelineItem, WorkbenchDiffFile, WorkbenchFileContent } from './types.ts';

export function useInspectorDiffPreview(input: {
  sessionId?: string;
  selectedItem?: TimelineItem;
  diffFiles: WorkbenchDiffFile[];
  latestDiffPath?: string;
  readFileContentFallback: string;
  onReadFileContent?: (filePath: string) => Promise<WorkbenchFileContent>;
}) {
  const { sessionId, selectedItem, diffFiles, latestDiffPath, readFileContentFallback, onReadFileContent } = input;
  const [selectedDiffPath, setSelectedDiffPath] = useState<string>();
  const [manualDiffSelection, setManualDiffSelection] = useState(false);
  const [fileContent, setFileContent] = useState<WorkbenchFileContent>();
  const [fileContentLoading, setFileContentLoading] = useState(false);
  const [fileContentError, setFileContentError] = useState('');

  const selectedDiff = useMemo(
    () => diffFiles.find((file) => file.filePath === selectedDiffPath) ?? diffFiles[0],
    [diffFiles, selectedDiffPath]
  );

  const selectDiffFile = useCallback((filePath: string) => {
    setSelectedDiffPath(filePath);
    setManualDiffSelection(true);
  }, []);

  useEffect(() => {
    setSelectedDiffPath(undefined);
    setManualDiffSelection(false);
    setFileContent(undefined);
    setFileContentError('');
  }, [sessionId]);

  useEffect(() => {
    if (!diffFiles.length) {
      setSelectedDiffPath(undefined);
      setManualDiffSelection(false);
      return;
    }

    if (selectedDiffPath && diffFiles.some((file) => file.filePath === selectedDiffPath)) {
      return;
    }

    setSelectedDiffPath(latestDiffPath ?? diffFiles[0]?.filePath);
    setManualDiffSelection(false);
  }, [diffFiles, latestDiffPath, selectedDiffPath]);

  useEffect(() => {
    if (!latestDiffPath || manualDiffSelection) {
      return;
    }
    setSelectedDiffPath(latestDiffPath);
  }, [latestDiffPath, manualDiffSelection]);

  useEffect(() => {
    if (selectedItem?.type === 'file_diff') {
      setSelectedDiffPath(selectedItem.event.filePath);
      setManualDiffSelection(true);
    } else if (selectedItem?.type === 'patch_applied' && selectedItem.event.filePaths[0]) {
      setSelectedDiffPath(selectedItem.event.filePaths[0]);
      setManualDiffSelection(true);
    }
  }, [selectedItem]);

  useEffect(() => {
    let cancelled = false;
    setFileContent(undefined);
    setFileContentError('');

    if (!selectedDiff?.filePath || !onReadFileContent) {
      setFileContentLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setFileContentLoading(true);
    void onReadFileContent(selectedDiff.filePath)
      .then((content) => {
        if (!cancelled) setFileContent(content);
      })
      .catch((error) => {
        if (!cancelled) {
          setFileContentError(
            error instanceof Error ? error.message : readFileContentFallback
          );
        }
      })
      .finally(() => {
        if (!cancelled) setFileContentLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onReadFileContent, readFileContentFallback, selectedDiff?.filePath]);

  return {
    selectedDiff,
    selectDiffFile,
    fileContent,
    fileContentLoading,
    fileContentError,
  };
}
