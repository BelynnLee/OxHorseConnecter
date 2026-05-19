import type { AgentSession, DiffSummary } from '@rac/shared';
import type { SessionBaseline } from '@rac/storage';
import { getGitDiff } from '@rac/executors';
import { buildDiscardPlan } from './session-diff-discard-planner.js';
import {
  fileMatchesSnapshot,
  filterPatchByPaths,
  gitRestorePath,
  normalizeGitPath,
  readGitList,
  removeUntrackedFile,
  resolveSessionWorkDir,
  restoreFileSnapshot,
  type DiscardPlan,
} from './session-helpers.js';

export function getSessionScopedGitDiff(
  session: AgentSession,
  baseline: SessionBaseline | undefined,
): Omit<DiffSummary, 'id' | 'taskId' | 'createdAt'> | undefined {
  if (!baseline?.isGitRepository) {
    return getGitDiff(resolveSessionWorkDir(session));
  }

  const current = getGitDiff(baseline.cwd);
  if (!current) {
    return undefined;
  }

  const baselineTracked = new Set(baseline.trackedFiles);
  const baselineUntracked = new Set(baseline.untrackedFiles);
  const currentUntracked = new Set(
    readGitList(baseline.cwd, ['ls-files', '--others', '--exclude-standard'])
  );
  const sessionFiles = new Set<string>();

  for (const file of current.files ?? []) {
    const filePath = normalizeGitPath(file.path);
    if (currentUntracked.has(filePath)) {
      if (!baselineUntracked.has(filePath)) {
        sessionFiles.add(filePath);
      }
      continue;
    }

    if (!baselineTracked.has(filePath)) {
      sessionFiles.add(filePath);
      continue;
    }

    const snapshot = baseline.fileSnapshots[filePath];
    const matches = fileMatchesSnapshot(baseline.cwd, filePath, snapshot);
    if (matches === false) {
      sessionFiles.add(filePath);
    }
  }

  const files = (current.files ?? []).filter((file) =>
    sessionFiles.has(normalizeGitPath(file.path))
  );
  if (files.length === 0) {
    return undefined;
  }

  const patchText = filterPatchByPaths(current.patchText, sessionFiles);
  return {
    filesChanged: files.length,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files,
    patchText,
  };
}

export function planSessionDiscard(input: {
  baseline: SessionBaseline;
  keptPaths: Set<string>;
  requestedPaths?: string[];
}): DiscardPlan {
  const currentUntracked = new Set(
    readGitList(input.baseline.cwd, ['ls-files', '--others', '--exclude-standard'])
  );
  const current = getGitDiff(input.baseline.cwd);
  return buildDiscardPlan({
    baseline: input.baseline,
    currentPaths: (current?.files ?? []).map((file) => file.path),
    currentUntracked,
    keptPaths: input.keptPaths,
    requestedPaths: input.requestedPaths,
    fileMatchesSnapshot: (filePath, snapshot) =>
      fileMatchesSnapshot(input.baseline.cwd, filePath, snapshot),
  });
}

export function applySessionDiscardPlan(cwd: string, plan: DiscardPlan): void {
  for (const action of plan.actions) {
    if (action.kind === 'restore-head') {
      gitRestorePath(cwd, action.path);
    } else if (action.kind === 'restore-snapshot') {
      restoreFileSnapshot(cwd, action.path, action.snapshot);
    } else {
      removeUntrackedFile(cwd, action.path);
    }
  }
}
