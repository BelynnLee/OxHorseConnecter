import path from 'node:path';
import type { AgentSession, AgentWorktreeStatus } from '@rac/shared';
import type { SessionBaseline, SessionFileSnapshot } from '@rac/storage';
import { config } from '../config.js';
import {
  assertGitRepository,
  captureFileSnapshot,
  getGitBranch,
  getGitHead,
  normalizeWorkDir,
  readGitList,
  runGit,
} from './session-helpers.js';

export function inspectWorktreeState(workDir: string | undefined): AgentWorktreeStatus {
  const cwd = path.resolve(normalizeWorkDir(workDir) ?? config.allowedWorkDir ?? process.cwd());
  try {
    assertGitRepository(cwd);
    const trackedFiles = readGitList(cwd, ['diff', '--name-only', 'HEAD']);
    const untrackedFiles = readGitList(cwd, ['ls-files', '--others', '--exclude-standard']);
    const statusText = runGit(cwd, ['status', '--porcelain=v1']);
    const dirty = Boolean(
      statusText.trim() || trackedFiles.length > 0 || untrackedFiles.length > 0
    );
    return {
      cwd,
      isGitRepository: true,
      dirty,
      trackedFiles,
      untrackedFiles,
      statusText,
      warning: dirty
        ? 'This worktree already has uncommitted changes. Workbench will preserve the baseline and only discard changes it can attribute to this session.'
        : undefined,
    };
  } catch {
    return {
      cwd,
      isGitRepository: false,
      dirty: false,
      trackedFiles: [],
      untrackedFiles: [],
      statusText: '',
      warning: 'This directory is not a git repository. Diff discard is unavailable.',
    };
  }
}

export function readTrackedDiff(cwd: string): string {
  try {
    return runGit(cwd, ['diff', 'HEAD']);
  } catch {
    return '';
  }
}

export function buildSessionBaseline(
  session: AgentSession,
  status: AgentWorktreeStatus,
  createdAt: string,
): SessionBaseline {
  const fileSnapshots: Record<string, SessionFileSnapshot> = {};

  if (status.isGitRepository) {
    for (const filePath of [...status.trackedFiles, ...status.untrackedFiles]) {
      fileSnapshots[filePath] = captureFileSnapshot(status.cwd, filePath);
    }
  }

  return {
    sessionId: session.id,
    provider: session.executorType,
    cwd: status.cwd,
    isGitRepository: status.isGitRepository,
    gitHead: status.isGitRepository ? getGitHead(status.cwd) : undefined,
    branch: status.isGitRepository ? getGitBranch(status.cwd) : undefined,
    statusText: status.statusText,
    trackedDiff: status.isGitRepository ? readTrackedDiff(status.cwd) : '',
    trackedFiles: status.trackedFiles,
    untrackedFiles: status.untrackedFiles,
    fileSnapshots,
    createdAt,
  };
}
