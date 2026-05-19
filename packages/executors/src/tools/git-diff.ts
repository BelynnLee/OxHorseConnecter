import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DiffFileChange, DiffSummary } from '@rac/shared';

interface NumstatEntry {
  insertions: number;
  deletions: number;
  path: string;
}

function safeParseCount(value: string | undefined): number {
  const parsed = parseInt(value ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumstat(output: string): NumstatEntry[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [insertions, deletions, ...pathParts] = line.split('\t');
      return {
        insertions: safeParseCount(insertions),
        deletions: safeParseCount(deletions),
        path: pathParts.join('\t'),
      };
    });
}

function parseNameStatus(output: string): Map<string, DiffFileChange['status']> {
  const statuses = new Map<string, DiffFileChange['status']>();

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const [rawStatus, ...pathParts] = line.split('\t');
    const path = pathParts[pathParts.length - 1];
    if (!path) {
      continue;
    }

    let status: DiffFileChange['status'] = 'modified';
    if (rawStatus.startsWith('A')) {
      status = 'added';
    } else if (rawStatus.startsWith('D')) {
      status = 'deleted';
    } else if (rawStatus.startsWith('R')) {
      status = 'renamed';
    }

    statuses.set(path, status);
  }

  return statuses;
}

function normalizePatchPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function listUntrackedFiles(workDir: string): string[] {
  try {
    return execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function createUntrackedPatch(workDir: string, filePath: string): { patch: string; insertions: number } {
  const normalizedPath = normalizePatchPath(filePath);
  const absolutePath = path.resolve(workDir, filePath);

  try {
    const stats = statSync(absolutePath);
    if (!stats.isFile() || stats.size > 200_000) {
      return {
        patch: [
          `diff --git a/${normalizedPath} b/${normalizedPath}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ b/${normalizedPath}`,
          '@@ -0,0 +1 @@',
          '+[new file omitted from preview]',
          '',
        ].join('\n'),
        insertions: 1,
      };
    }

    const content = readFileSync(absolutePath);
    if (content.includes(0)) {
      return {
        patch: [
          `diff --git a/${normalizedPath} b/${normalizedPath}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ b/${normalizedPath}`,
          '@@ -0,0 +1 @@',
          '+[binary file omitted from preview]',
          '',
        ].join('\n'),
        insertions: 1,
      };
    }

    const text = content.toString('utf8');
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
    const body = lines.map((line) => `+${line}`).join('\n');
    const insertions = Math.max(lines.length, 1);

    return {
      patch: [
        `diff --git a/${normalizedPath} b/${normalizedPath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${normalizedPath}`,
        `@@ -0,0 +1,${insertions} @@`,
        body || '+',
        '',
      ].join('\n'),
      insertions,
    };
  } catch {
    return {
      patch: [
        `diff --git a/${normalizedPath} b/${normalizedPath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${normalizedPath}`,
        '@@ -0,0 +1 @@',
        '+[new file could not be read]',
        '',
      ].join('\n'),
      insertions: 1,
    };
  }
}

export function getGitDiff(
  workDir: string,
): Omit<DiffSummary, 'id' | 'taskId' | 'createdAt'> | undefined {
  try {
    let patchText = execFileSync('git', ['diff', 'HEAD'], {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const numstat = execFileSync('git', ['diff', '--numstat', 'HEAD'], {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const nameStatus = execFileSync('git', ['diff', '--name-status', 'HEAD'], {
      cwd: workDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const fileStats = parseNumstat(numstat);
    const statusMap = parseNameStatus(nameStatus);
    for (const filePath of listUntrackedFiles(workDir)) {
      const untracked = createUntrackedPatch(workDir, filePath);
      patchText = `${patchText}${patchText.endsWith('\n') || !patchText ? '' : '\n'}${untracked.patch}`;
      fileStats.push({
        path: filePath,
        insertions: untracked.insertions,
        deletions: 0,
      });
      statusMap.set(filePath, 'added');
    }

    if (!patchText.trim()) {
      return undefined;
    }

    const insertions = fileStats.reduce((sum, item) => sum + item.insertions, 0);
    const deletions = fileStats.reduce((sum, item) => sum + item.deletions, 0);

    return {
      filesChanged: fileStats.length,
      insertions,
      deletions,
      patchText,
      files: fileStats.map((item) => ({
        path: item.path,
        status: statusMap.get(item.path) ?? 'modified',
        insertions: item.insertions,
        deletions: item.deletions,
      })),
    };
  } catch {
    return undefined;
  }
}
