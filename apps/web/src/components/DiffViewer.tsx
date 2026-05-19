import { useMemo, useState } from 'react';
import type { DiffFileChange } from '../types.ts';
import { useT } from '../i18n/index.ts';

interface DiffViewerProps {
  patchText: string;
  files?: DiffFileChange[];
}

interface ParsedFilePatch {
  path: string;
  lines: string[];
}

interface UnifiedRow {
  kind: 'hunk' | 'context' | 'add' | 'delete' | 'meta';
  oldLine?: number;
  newLine?: number;
  text: string;
}

interface SplitRow {
  kind: 'hunk' | 'context' | 'change' | 'meta';
  oldLine?: number;
  newLine?: number;
  oldText?: string;
  newText?: string;
}

type ViewMode = 'unified' | 'split';

function stripDiffPath(value: string): string | undefined {
  if (!value || value === '/dev/null') {
    return undefined;
  }

  return value.replace(/^"|"$/g, '').replace(/^[ab]\//, '');
}

function parseDiffGitPath(line: string): string | undefined {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return match?.[2] ?? match?.[1];
}

function parsePatchFiles(patchText: string): ParsedFilePatch[] {
  const lines = patchText.split('\n');
  const files: ParsedFilePatch[] = [];
  let current: ParsedFilePatch | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const path = parseDiffGitPath(line) ?? `Change ${files.length + 1}`;
      current = { path, lines: [line] };
      files.push(current);
      continue;
    }

    if (!current) {
      current = { path: 'Patch', lines: [] };
      files.push(current);
    }

    current.lines.push(line);

    if (line.startsWith('+++ ')) {
      const nextPath = stripDiffPath(line.slice(4).trim());
      if (nextPath) {
        current.path = nextPath;
      }
    }
  }

  return files.filter((file) => file.lines.some((line) => line.trim()));
}

function getDisplayFiles(
  patchText: string,
  files?: DiffFileChange[],
): Array<DiffFileChange & { patch?: ParsedFilePatch }> {
  const parsedFiles = parsePatchFiles(patchText);

  if (!files || files.length === 0) {
    return parsedFiles.map((patch) => ({
      path: patch.path,
      status: 'modified',
      insertions: 0,
      deletions: 0,
      patch,
    }));
  }

  return files.map((file) => ({
    ...file,
    patch:
      parsedFiles.find((patch) => patch.path === file.path) ??
      parsedFiles.find((patch) => patch.path.endsWith(file.path)),
  }));
}

function parseHunkHeader(line: string): { oldLine: number; newLine: number } | undefined {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) {
    return undefined;
  }

  return {
    oldLine: Number.parseInt(match[1], 10),
    newLine: Number.parseInt(match[2], 10),
  };
}

function lineKind(line: string): UnifiedRow['kind'] {
  if (line.startsWith('@@')) {
    return 'hunk';
  }
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'add';
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'delete';
  }
  if (line.startsWith(' ')) {
    return 'context';
  }
  return 'meta';
}

function stripPatchPrefix(line: string): string {
  if (
    line.startsWith('@@') ||
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from') ||
    line.startsWith('rename to')
  ) {
    return line;
  }

  return line.slice(1);
}

function parseUnifiedRows(lines: string[]): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const kind = lineKind(line);

    if (kind === 'hunk') {
      const parsed = parseHunkHeader(line);
      if (parsed) {
        oldLine = parsed.oldLine;
        newLine = parsed.newLine;
      }
      rows.push({ kind, text: line });
      continue;
    }

    if (kind === 'add') {
      rows.push({ kind, newLine, text: stripPatchPrefix(line) });
      newLine += 1;
      continue;
    }

    if (kind === 'delete') {
      rows.push({ kind, oldLine, text: stripPatchPrefix(line) });
      oldLine += 1;
      continue;
    }

    if (kind === 'context') {
      rows.push({
        kind,
        oldLine,
        newLine,
        text: stripPatchPrefix(line),
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    rows.push({ kind, text: line });
  }

  return rows;
}

function parseSplitRows(lines: string[]): SplitRow[] {
  const rows: SplitRow[] = [];
  const pendingDeletes: Array<{ oldLine: number; text: string }> = [];
  let oldLine = 0;
  let newLine = 0;

  function flushPendingDeletes() {
    while (pendingDeletes.length > 0) {
      const pending = pendingDeletes.shift()!;
      rows.push({
        kind: 'change',
        oldLine: pending.oldLine,
        oldText: pending.text,
      });
    }
  }

  for (const line of lines) {
    const kind = lineKind(line);

    if (kind === 'hunk') {
      flushPendingDeletes();
      const parsed = parseHunkHeader(line);
      if (parsed) {
        oldLine = parsed.oldLine;
        newLine = parsed.newLine;
      }
      rows.push({ kind: 'hunk', oldText: line, newText: line });
      continue;
    }

    if (kind === 'delete') {
      pendingDeletes.push({ oldLine, text: stripPatchPrefix(line) });
      oldLine += 1;
      continue;
    }

    if (kind === 'add') {
      const pending = pendingDeletes.shift();
      rows.push({
        kind: 'change',
        oldLine: pending?.oldLine,
        newLine,
        oldText: pending?.text,
        newText: stripPatchPrefix(line),
      });
      newLine += 1;
      continue;
    }

    flushPendingDeletes();

    if (kind === 'context') {
      const text = stripPatchPrefix(line);
      rows.push({
        kind: 'context',
        oldLine,
        newLine,
        oldText: text,
        newText: text,
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    rows.push({ kind: 'meta', oldText: line, newText: line });
  }

  flushPendingDeletes();
  return rows;
}

function statusClass(status: DiffFileChange['status']): string {
  switch (status) {
    case 'added':   return 'bg-success-soft border border-success/30 text-success';
    case 'deleted': return 'bg-danger-soft border border-danger/30 text-danger';
    case 'renamed': return 'bg-warning-soft border border-warning/30 text-warning';
    default:        return 'bg-bg-surface-3 border border-border-default text-text-tertiary';
  }
}

function rowClass(kind: UnifiedRow['kind'] | SplitRow['kind']): string {
  if (kind === 'add')    return 'bg-success/[0.08] text-success';
  if (kind === 'delete') return 'bg-danger/[0.08] text-danger';
  if (kind === 'change') return 'text-text-secondary';
  if (kind === 'hunk')   return 'bg-info/[0.08] text-info';
  if (kind === 'meta')   return 'bg-bg-surface-3 text-text-disabled';
  return 'text-text-secondary';
}

function ChangeCell({
  lineNumber,
  text,
  tone,
}: {
  lineNumber?: number;
  text?: string;
  tone: 'add' | 'delete' | 'context' | 'meta';
}) {
  const toneClass =
    tone === 'add'    ? 'bg-success/[0.08] text-success' :
    tone === 'delete' ? 'bg-danger/[0.08] text-danger' :
    tone === 'meta'   ? 'bg-bg-surface-3 text-text-disabled' :
                        'text-text-secondary';

  return (
    <div className={`grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] ${toneClass}`}>
      <div className="select-none border-r border-border-soft px-2 py-1 text-right text-xs text-text-disabled">
        {lineNumber ?? ''}
      </div>
      <pre className="overflow-x-auto px-2 py-1 text-xs leading-5 font-mono">{text ?? ''}</pre>
    </div>
  );
}

export function DiffViewer({ patchText, files }: DiffViewerProps) {
  const { t } = useT();
  const displayFiles = useMemo(() => getDisplayFiles(patchText, files), [patchText, files]);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const activeFile = displayFiles[Math.min(activeFileIndex, displayFiles.length - 1)];
  const activePatchLines = activeFile?.patch?.lines ?? patchText.split('\n');
  const unifiedRows = useMemo(() => parseUnifiedRows(activePatchLines), [activePatchLines]);
  const splitRows = useMemo(() => parseSplitRows(activePatchLines), [activePatchLines]);

  if (!patchText.trim()) {
    return <div className="p-5 text-sm text-text-tertiary">{t.diff.noPatch}</div>;
  }

  return (
    <div>
      <div className="border-b border-border-soft px-5 py-3 bg-bg-surface-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {displayFiles.map((file, index) => (
              <button
                key={`${file.path}-${index}`}
                type="button"
                onClick={() => setActiveFileIndex(index)}
                className={`rounded-xs border px-3 py-1 text-xs font-mono font-medium transition-colors ${
                  index === activeFileIndex
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border-default text-text-tertiary hover:border-border-strong hover:text-text-secondary'
                }`}
              >
                {file.path}
              </button>
            ))}
          </div>
          <div className="flex rounded-xs border border-border-default overflow-hidden">
            {(['unified', 'split'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-accent text-primary-foreground'
                    : 'text-text-tertiary hover:bg-bg-surface-2 hover:text-text-secondary'
                }`}
              >
                {mode === 'unified' ? t.diff.unified : t.diff.split}
              </button>
            ))}
          </div>
        </div>

        {activeFile && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-xs">
            <span className={`rounded-pill px-2 py-0.5 font-medium ${statusClass(activeFile.status)}`}>
              {activeFile.status}
            </span>
            <span className="font-medium text-success">+{activeFile.insertions}</span>
            <span className="font-medium text-danger">-{activeFile.deletions}</span>
          </div>
        )}
      </div>

      {viewMode === 'unified' ? (
        <div className="overflow-x-auto bg-bg-surface-1">
          {unifiedRows.map((row, index) => (
            <div
              key={`${index}-${row.oldLine ?? ''}-${row.newLine ?? ''}`}
              className={`grid min-w-[48rem] grid-cols-[4rem_4rem_minmax(0,1fr)] ${rowClass(row.kind)}`}
            >
              <div className="select-none border-r border-border-soft px-2 py-1 text-right text-xs text-text-disabled">
                {row.oldLine ?? ''}
              </div>
              <div className="select-none border-r border-border-soft px-2 py-1 text-right text-xs text-text-disabled">
                {row.newLine ?? ''}
              </div>
              <pre className="px-2 py-1 text-xs leading-5 font-mono">{row.text}</pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto bg-bg-surface-1">
          {splitRows.map((row, index) => {
            if (row.kind === 'hunk' || row.kind === 'meta') {
              return (
                <div
                  key={`${index}-${row.oldText ?? ''}`}
                  className={`min-w-[58rem] px-3 py-1 font-mono text-xs leading-5 ${rowClass(row.kind)}`}
                >
                  {row.oldText}
                </div>
              );
            }

            return (
              <div
                key={`${index}-${row.oldLine ?? ''}-${row.newLine ?? ''}`}
                className="grid min-w-[58rem] grid-cols-2 border-b border-border-soft last:border-b-0"
              >
                <ChangeCell
                  lineNumber={row.oldLine}
                  text={row.oldText}
                  tone={row.oldText && !row.newText ? 'delete' : row.kind === 'context' ? 'context' : 'delete'}
                />
                <ChangeCell
                  lineNumber={row.newLine}
                  text={row.newText}
                  tone={row.newText && !row.oldText ? 'add' : row.kind === 'context' ? 'context' : 'add'}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
