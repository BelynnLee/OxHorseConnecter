import type { SessionBaseline, SessionFileSnapshot } from '@rac/storage';
import { normalizeGitPath, type DiscardAction, type DiscardPlan } from './session-helpers.js';

export interface BuildDiscardPlanInput {
  baseline: Pick<SessionBaseline, 'trackedFiles' | 'untrackedFiles' | 'fileSnapshots'>;
  currentPaths: Iterable<string>;
  currentUntracked: Iterable<string>;
  keptPaths?: Set<string>;
  requestedPaths?: string[];
  fileMatchesSnapshot: (
    filePath: string,
    snapshot: SessionFileSnapshot | undefined
  ) => boolean | undefined;
}

export function buildDiscardPlan(input: BuildDiscardPlanInput): DiscardPlan {
  const baselineTracked = new Set(input.baseline.trackedFiles.map(normalizeGitPath));
  const baselineUntracked = new Set(input.baseline.untrackedFiles.map(normalizeGitPath));
  const currentPaths = new Set(Array.from(input.currentPaths, normalizeGitPath));
  const currentUntracked = new Set(Array.from(input.currentUntracked, normalizeGitPath));
  const paths = input.requestedPaths?.map(normalizeGitPath) ?? Array.from(currentPaths);
  const keptPaths = input.keptPaths ?? new Set<string>();
  const actions: DiscardAction[] = [];
  const manualReasons: string[] = [];

  for (const filePath of paths) {
    if (keptPaths.has(filePath)) {
      if (input.requestedPaths) {
        manualReasons.push(`${filePath}: file is marked keep for this session.`);
      }
      continue;
    }

    if (!currentPaths.has(filePath) && !currentUntracked.has(filePath)) {
      manualReasons.push(`${filePath}: no current git change was found.`);
      continue;
    }

    if (currentUntracked.has(filePath)) {
      if (baselineUntracked.has(filePath)) {
        const snapshot = input.baseline.fileSnapshots[filePath];
        const matches = input.fileMatchesSnapshot(filePath, snapshot);
        if (matches === true) {
          continue;
        }
        manualReasons.push(
          `${filePath}: file was untracked before this session${matches === false ? ' and changed afterward' : ''}; handle it manually.`
        );
        continue;
      }
      actions.push({ kind: 'delete-untracked', path: filePath });
      continue;
    }

    if (!baselineTracked.has(filePath)) {
      actions.push({ kind: 'restore-head', path: filePath });
      continue;
    }

    const snapshot = input.baseline.fileSnapshots[filePath];
    if (!snapshot?.captured) {
      manualReasons.push(
        `${filePath}: baseline file was already dirty and no safe snapshot is available.`
      );
      continue;
    }
    if (input.fileMatchesSnapshot(filePath, snapshot) === true) {
      continue;
    }
    actions.push({ kind: 'restore-snapshot', path: filePath, snapshot });
  }

  return { actions, manualReasons };
}
