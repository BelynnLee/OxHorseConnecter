import type Database from 'better-sqlite3';

export interface SessionFileSnapshot {
  state: 'present' | 'deleted';
  captured: boolean;
  size?: number;
  contentBase64?: string;
  reason?: string;
}

export interface SessionBaseline {
  sessionId: string;
  provider?: string;
  cwd: string;
  isGitRepository: boolean;
  gitHead?: string;
  branch?: string;
  statusText: string;
  trackedDiff: string;
  trackedFiles: string[];
  untrackedFiles: string[];
  fileSnapshots: Record<string, SessionFileSnapshot>;
  createdAt: string;
}

interface SessionBaselineRow {
  sessionId: string;
  provider: string | null;
  cwd: string;
  isGitRepository: number;
  gitHead: string | null;
  branch: string | null;
  statusText: string;
  trackedDiff: string;
  trackedFiles: string;
  untrackedFiles: string;
  fileSnapshots: string;
  createdAt: string;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToBaseline(row: SessionBaselineRow): SessionBaseline {
  return {
    sessionId: row.sessionId,
    provider: row.provider ?? undefined,
    cwd: row.cwd,
    isGitRepository: row.isGitRepository === 1,
    gitHead: row.gitHead ?? undefined,
    branch: row.branch ?? undefined,
    statusText: row.statusText,
    trackedDiff: row.trackedDiff,
    trackedFiles: parseJson<string[]>(row.trackedFiles, []),
    untrackedFiles: parseJson<string[]>(row.untrackedFiles, []),
    fileSnapshots: parseJson<Record<string, SessionFileSnapshot>>(row.fileSnapshots, {}),
    createdAt: row.createdAt,
  };
}

export class SessionBaselineRepository {
  private findBySessionIdStmt: Database.Statement;
  private createStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findBySessionIdStmt = db.prepare('SELECT * FROM session_baselines WHERE sessionId = ?');
    this.createStmt = db.prepare(
      `INSERT INTO session_baselines (sessionId, provider, cwd, isGitRepository, gitHead, branch, statusText, trackedDiff, trackedFiles, untrackedFiles, fileSnapshots, createdAt)
       VALUES (@sessionId, @provider, @cwd, @isGitRepository, @gitHead, @branch, @statusText, @trackedDiff, @trackedFiles, @untrackedFiles, @fileSnapshots, @createdAt)`,
    );
  }

  findBySessionId(sessionId: string): SessionBaseline | undefined {
    const row = this.findBySessionIdStmt.get(sessionId) as SessionBaselineRow | undefined;
    return row ? rowToBaseline(row) : undefined;
  }

  create(baseline: SessionBaseline): void {
    this.createStmt.run({
      sessionId: baseline.sessionId,
      provider: baseline.provider ?? null,
      cwd: baseline.cwd,
      isGitRepository: baseline.isGitRepository ? 1 : 0,
      gitHead: baseline.gitHead ?? null,
      branch: baseline.branch ?? null,
      statusText: baseline.statusText,
      trackedDiff: baseline.trackedDiff,
      trackedFiles: JSON.stringify(baseline.trackedFiles),
      untrackedFiles: JSON.stringify(baseline.untrackedFiles),
      fileSnapshots: JSON.stringify(baseline.fileSnapshots),
      createdAt: baseline.createdAt,
    });
  }
}
