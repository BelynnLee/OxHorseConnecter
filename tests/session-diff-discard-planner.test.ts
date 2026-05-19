import assert from 'node:assert/strict';
import type { SessionBaseline, SessionFileSnapshot } from '@rac/storage';
import { buildDiscardPlan } from '../apps/host/src/services/session-diff-discard-planner.ts';

const baseTime = '2026-05-11T04:00:00.000Z';
const cleanSnapshot: SessionFileSnapshot = {
  state: 'present',
  captured: true,
  contentBase64: Buffer.from('clean').toString('base64'),
};

function baseline(input: Partial<SessionBaseline> = {}): SessionBaseline {
  return {
    sessionId: 'session-1',
    cwd: 'E:\\work',
    isGitRepository: true,
    statusText: '',
    trackedDiff: '',
    trackedFiles: ['tracked.ts'],
    untrackedFiles: ['preexisting.txt'],
    fileSnapshots: {
      'tracked.ts': cleanSnapshot,
      'dirty.ts': { state: 'present', captured: false, reason: 'too large' },
      'preexisting.txt': { state: 'present', captured: true, contentBase64: 'old' },
    },
    createdAt: baseTime,
    ...input,
  };
}

function main(): void {
  const plan = buildDiscardPlan({
    baseline: baseline({ trackedFiles: ['tracked.ts', 'dirty.ts'] }),
    currentPaths: ['tracked.ts', 'new.ts', 'dirty.ts'],
    currentUntracked: ['new.ts'],
    fileMatchesSnapshot: (filePath) => (filePath === 'tracked.ts' ? false : undefined),
  });
  assert.deepEqual(plan, {
    actions: [
      { kind: 'restore-snapshot', path: 'tracked.ts', snapshot: cleanSnapshot },
      { kind: 'delete-untracked', path: 'new.ts' },
    ],
    manualReasons: ['dirty.ts: baseline file was already dirty and no safe snapshot is available.'],
  });

  const requestedKept = buildDiscardPlan({
    baseline: baseline(),
    currentPaths: ['tracked.ts'],
    currentUntracked: [],
    keptPaths: new Set(['tracked.ts']),
    requestedPaths: ['tracked.ts'],
    fileMatchesSnapshot: () => false,
  });
  assert.deepEqual(requestedKept, {
    actions: [],
    manualReasons: ['tracked.ts: file is marked keep for this session.'],
  });

  const preexistingUntracked = buildDiscardPlan({
    baseline: baseline(),
    currentPaths: ['preexisting.txt'],
    currentUntracked: ['preexisting.txt'],
    fileMatchesSnapshot: () => false,
  });
  assert.deepEqual(preexistingUntracked, {
    actions: [],
    manualReasons: [
      'preexisting.txt: file was untracked before this session and changed afterward; handle it manually.',
    ],
  });

  const unchangedPreexistingUntracked = buildDiscardPlan({
    baseline: baseline(),
    currentPaths: ['preexisting.txt'],
    currentUntracked: ['preexisting.txt'],
    fileMatchesSnapshot: () => true,
  });
  assert.deepEqual(unchangedPreexistingUntracked, {
    actions: [],
    manualReasons: [],
  });
}

main();
console.log('session-diff-discard-planner tests passed');
