import type {
  FileDiffTimelineItem,
  WorkbenchDiffFile,
} from './types.ts';

export function patchStats(patch: string): { insertions: number; deletions: number } {
  return patch.split('\n').reduce(
    (stats, line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) stats.insertions += 1;
      if (line.startsWith('-') && !line.startsWith('---')) stats.deletions += 1;
      return stats;
    },
    { insertions: 0, deletions: 0 }
  );
}

export function timelineDiffToFile(item: FileDiffTimelineItem): WorkbenchDiffFile {
  const patch = item.event.patch ?? '';
  return {
    filePath: item.event.filePath,
    changeType: item.event.changeType,
    patch,
    ...patchStats(patch),
  };
}
