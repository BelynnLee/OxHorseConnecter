import type Database from 'better-sqlite3';
import type { DiffSummary } from '@rac/shared';

interface DiffSummaryRow {
  id: string;
  taskId: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  patchText: string;
  createdAt: string;
  files: string | null;
}

function rowToDiff(row: DiffSummaryRow): DiffSummary {
  return {
    id: row.id,
    taskId: row.taskId,
    filesChanged: row.filesChanged,
    insertions: row.insertions,
    deletions: row.deletions,
    patchText: row.patchText,
    createdAt: row.createdAt,
    files: row.files ? (JSON.parse(row.files) as DiffSummary['files']) : undefined,
  };
}

export class DiffRepository {
  private findByTaskIdStmt: Database.Statement;
  private createStmt: Database.Statement;
  private createSessionDiffStmt: Database.Statement;
  private upsertStmt: Database.Statement;
  private upsertSessionDiffStmt: Database.Statement;
  private deleteByTaskIdStmt: Database.Statement;
  private deleteSessionDiffByTaskIdStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByTaskIdStmt = db.prepare(
      'SELECT * FROM diff_summaries WHERE taskId = ?',
    );
    this.createStmt = db.prepare(
      `INSERT INTO diff_summaries (id, taskId, filesChanged, insertions, deletions, patchText, createdAt, files)
       VALUES (@id, @taskId, @filesChanged, @insertions, @deletions, @patchText, @createdAt, @files)`,
    );
    this.createSessionDiffStmt = db.prepare(
      `INSERT OR IGNORE INTO session_diffs (id, sessionId, runId, filesChanged, insertions, deletions, patchText, files, createdAt)
       SELECT
         @id,
         COALESCE(t.parentGroupId, t.resumeSessionId, @taskId),
         @taskId,
         @filesChanged,
         @insertions,
         @deletions,
         @patchText,
         @files,
         @createdAt
       FROM (SELECT 1) seed
       LEFT JOIN tasks t ON t.id = @taskId`,
    );
    this.upsertStmt = db.prepare(
      `INSERT INTO diff_summaries (id, taskId, filesChanged, insertions, deletions, patchText, createdAt, files)
       VALUES (@id, @taskId, @filesChanged, @insertions, @deletions, @patchText, @createdAt, @files)
       ON CONFLICT(taskId) DO UPDATE SET
         filesChanged = excluded.filesChanged,
         insertions = excluded.insertions,
         deletions = excluded.deletions,
         patchText = excluded.patchText,
         createdAt = excluded.createdAt,
         files = excluded.files`,
    );
    this.upsertSessionDiffStmt = db.prepare(
      `INSERT INTO session_diffs (id, sessionId, runId, filesChanged, insertions, deletions, patchText, files, createdAt)
       SELECT
         @id,
         COALESCE(t.parentGroupId, t.resumeSessionId, @taskId),
         @taskId,
         @filesChanged,
         @insertions,
         @deletions,
         @patchText,
         @files,
         @createdAt
       FROM (SELECT 1) seed
       LEFT JOIN tasks t ON t.id = @taskId
       WHERE true
       ON CONFLICT(id) DO UPDATE SET
         sessionId = excluded.sessionId,
         runId = excluded.runId,
         filesChanged = excluded.filesChanged,
         insertions = excluded.insertions,
         deletions = excluded.deletions,
         patchText = excluded.patchText,
         files = excluded.files,
         createdAt = excluded.createdAt`,
    );
    this.deleteByTaskIdStmt = db.prepare('DELETE FROM diff_summaries WHERE taskId = ?');
    this.deleteSessionDiffByTaskIdStmt = db.prepare('DELETE FROM session_diffs WHERE runId = ?');
  }

  findByTaskId(taskId: string): DiffSummary | undefined {
    const row = this.findByTaskIdStmt.get(taskId) as
      | DiffSummaryRow
      | undefined;
    return row ? rowToDiff(row) : undefined;
  }

  create(diff: DiffSummary): void {
    const row = {
      id: diff.id,
      taskId: diff.taskId,
      filesChanged: diff.filesChanged,
      insertions: diff.insertions,
      deletions: diff.deletions,
      patchText: diff.patchText,
      createdAt: diff.createdAt,
      files: diff.files ? JSON.stringify(diff.files) : null,
    };
    this.createStmt.run(row);
    this.createSessionDiffStmt.run(row);
  }

  upsert(diff: DiffSummary): void {
    const row = {
      id: diff.id,
      taskId: diff.taskId,
      filesChanged: diff.filesChanged,
      insertions: diff.insertions,
      deletions: diff.deletions,
      patchText: diff.patchText,
      createdAt: diff.createdAt,
      files: diff.files ? JSON.stringify(diff.files) : null,
    };
    this.upsertStmt.run(row);
    this.upsertSessionDiffStmt.run(row);
  }

  deleteByTaskId(taskId: string): void {
    this.deleteByTaskIdStmt.run(taskId);
    this.deleteSessionDiffByTaskIdStmt.run(taskId);
  }
}
