import type Database from 'better-sqlite3';
import type { AgentCommand } from '@rac/shared';

interface AgentCommandRow {
  id: string;
  sessionId: string;
  provider: string;
  toolRunId: string | null;
  command: string;
  cwd: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  stdoutPreview: string | null;
  stderrPreview: string | null;
  riskLevel: string;
  riskReason: string | null;
  approvalId: string | null;
  rawEventId: string | null;
}

function rowToCommand(row: AgentCommandRow): AgentCommand {
  return {
    id: row.id,
    sessionId: row.sessionId,
    provider: row.provider as AgentCommand['provider'],
    toolRunId: row.toolRunId ?? undefined,
    command: row.command,
    cwd: row.cwd ?? undefined,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? undefined,
    exitCode: row.exitCode ?? undefined,
    stdoutPreview: row.stdoutPreview ?? undefined,
    stderrPreview: row.stderrPreview ?? undefined,
    riskLevel: row.riskLevel as AgentCommand['riskLevel'],
    riskReason: row.riskReason ?? undefined,
    approvalId: row.approvalId ?? undefined,
    rawEventId: row.rawEventId ?? undefined,
  };
}

export class AgentCommandRepository {
  private findByIdStmt: Database.Statement;
  private findBySessionStmt: Database.Statement;
  private findBySessionPagedStmt: Database.Statement;
  private findByToolRunStmt: Database.Statement;
  private upsertStmt: Database.Statement;
  private appendOutputStmt: Database.Statement;
  private finishStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByIdStmt = db.prepare('SELECT * FROM agent_commands WHERE id = ?');
    this.findBySessionStmt = db.prepare('SELECT * FROM agent_commands WHERE sessionId = ? ORDER BY startedAt ASC');
    this.findBySessionPagedStmt = db.prepare(
      'SELECT * FROM agent_commands WHERE sessionId = ? ORDER BY startedAt ASC LIMIT ? OFFSET ?',
    );
    this.findByToolRunStmt = db.prepare('SELECT * FROM agent_commands WHERE sessionId = ? AND toolRunId = ? ORDER BY startedAt DESC LIMIT 1');
    this.upsertStmt = db.prepare(
      `INSERT INTO agent_commands (id, sessionId, provider, toolRunId, command, cwd, startedAt, finishedAt, exitCode, stdoutPreview, stderrPreview, riskLevel, riskReason, approvalId, rawEventId)
       VALUES (@id, @sessionId, @provider, @toolRunId, @command, @cwd, @startedAt, @finishedAt, @exitCode, @stdoutPreview, @stderrPreview, @riskLevel, @riskReason, @approvalId, @rawEventId)
       ON CONFLICT(id) DO UPDATE SET
         command = excluded.command,
         cwd = COALESCE(excluded.cwd, agent_commands.cwd),
         riskLevel = excluded.riskLevel,
         riskReason = excluded.riskReason,
         rawEventId = excluded.rawEventId`,
    );
    this.appendOutputStmt = db.prepare(
      `UPDATE agent_commands
       SET stdoutPreview = @stdoutPreview,
           stderrPreview = @stderrPreview
       WHERE id = @id`,
    );
    this.finishStmt = db.prepare(
      `UPDATE agent_commands
       SET finishedAt = @finishedAt,
           exitCode = @exitCode,
           approvalId = COALESCE(@approvalId, approvalId),
           rawEventId = COALESCE(@rawEventId, rawEventId)
       WHERE id = @id`,
    );
  }

  findById(id: string): AgentCommand | undefined {
    const row = this.findByIdStmt.get(id) as AgentCommandRow | undefined;
    return row ? rowToCommand(row) : undefined;
  }

  findBySession(sessionId: string, options?: { limit?: number; offset?: number }): AgentCommand[] {
    if (options?.limit !== undefined || options?.offset !== undefined) {
      const limit = options.limit ?? 100;
      const offset = options.offset ?? 0;
      return (this.findBySessionPagedStmt.all(sessionId, limit, offset) as AgentCommandRow[])
        .map(rowToCommand);
    }
    return (this.findBySessionStmt.all(sessionId) as AgentCommandRow[]).map(rowToCommand);
  }

  findByToolRunId(sessionId: string, toolRunId: string): AgentCommand | undefined {
    const row = this.findByToolRunStmt.get(sessionId, toolRunId) as AgentCommandRow | undefined;
    return row ? rowToCommand(row) : undefined;
  }

  upsert(command: AgentCommand): void {
    this.upsertStmt.run({
      id: command.id,
      sessionId: command.sessionId,
      provider: command.provider,
      toolRunId: command.toolRunId ?? null,
      command: command.command,
      cwd: command.cwd ?? null,
      startedAt: command.startedAt,
      finishedAt: command.finishedAt ?? null,
      exitCode: command.exitCode ?? null,
      stdoutPreview: command.stdoutPreview ?? null,
      stderrPreview: command.stderrPreview ?? null,
      riskLevel: command.riskLevel,
      riskReason: command.riskReason ?? null,
      approvalId: command.approvalId ?? null,
      rawEventId: command.rawEventId ?? null,
    });
  }

  appendOutput(id: string, stdoutPreview?: string, stderrPreview?: string): void {
    this.appendOutputStmt.run({
      id,
      stdoutPreview: stdoutPreview ?? null,
      stderrPreview: stderrPreview ?? null,
    });
  }

  finish(id: string, finishedAt: string, exitCode?: number, approvalId?: string, rawEventId?: string): void {
    this.finishStmt.run({
      id,
      finishedAt,
      exitCode: exitCode ?? null,
      approvalId: approvalId ?? null,
      rawEventId: rawEventId ?? null,
    });
  }
}
