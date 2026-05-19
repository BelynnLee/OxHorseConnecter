import type Database from 'better-sqlite3';
import type { AgentSessionSummary, AgentUsage } from '@rac/shared';

interface SummaryRow {
  id: string;
  sessionId: string;
  provider: string;
  summary: string;
  sourceEventFrom: string | null;
  sourceEventTo: string | null;
  injectedIntoProvider: number;
  usedInResume: number;
  createdAt: string;
}

interface UsageRow {
  id: string;
  sessionId: string;
  provider: string;
  model: string | null;
  uncachedInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreation5mInputTokens: number | null;
  cacheCreation1hInputTokens: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: number;
  costEstimated: number;
  uncachedInputCost: number | null;
  cacheCreationCost: number | null;
  cacheReadCost: number | null;
  inputCost: number | null;
  outputCost: number | null;
  totalCost: number | null;
  currency: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToSummary(row: SummaryRow): AgentSessionSummary {
  return {
    id: row.id,
    sessionId: row.sessionId,
    provider: row.provider as AgentSessionSummary['provider'],
    summary: row.summary,
    sourceEventFrom: row.sourceEventFrom ?? undefined,
    sourceEventTo: row.sourceEventTo ?? undefined,
    injectedIntoProvider: row.injectedIntoProvider === 1,
    usedInResume: row.usedInResume === 1,
    createdAt: row.createdAt,
  };
}

function rowToUsage(row: UsageRow): AgentUsage {
  const cacheCreationInputTokens = row.cacheCreationInputTokens ?? 0;
  const cacheReadInputTokens = row.cacheReadInputTokens ?? 0;
  const storedUncachedInputTokens = row.uncachedInputTokens ?? 0;
  const hasInputBreakdown = storedUncachedInputTokens > 0 || cacheCreationInputTokens > 0 || cacheReadInputTokens > 0 || row.inputTokens === 0;
  return {
    id: row.id,
    sessionId: row.sessionId,
    provider: row.provider as AgentUsage['provider'],
    model: row.model ?? undefined,
    uncachedInputTokens: hasInputBreakdown ? storedUncachedInputTokens : row.inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    cacheCreation5mInputTokens: row.cacheCreation5mInputTokens ?? 0,
    cacheCreation1hInputTokens: row.cacheCreation1hInputTokens ?? 0,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    estimated: row.estimated === 1,
    costEstimated: row.costEstimated === 1,
    uncachedInputCost: row.uncachedInputCost ?? undefined,
    cacheCreationCost: row.cacheCreationCost ?? undefined,
    cacheReadCost: row.cacheReadCost ?? undefined,
    inputCost: row.inputCost ?? undefined,
    outputCost: row.outputCost ?? undefined,
    totalCost: row.totalCost ?? undefined,
    currency: row.currency ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class AgentSessionSummaryRepository {
  private createStmt: Database.Statement;
  private latestStmt: Database.Statement;
  private findBySessionStmt: Database.Statement;
  private markUsedStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.createStmt = db.prepare(
      `INSERT INTO agent_session_summaries (id, sessionId, provider, summary, sourceEventFrom, sourceEventTo, injectedIntoProvider, usedInResume, createdAt)
       VALUES (@id, @sessionId, @provider, @summary, @sourceEventFrom, @sourceEventTo, @injectedIntoProvider, @usedInResume, @createdAt)`,
    );
    this.latestStmt = db.prepare('SELECT * FROM agent_session_summaries WHERE sessionId = ? ORDER BY createdAt DESC LIMIT 1');
    this.findBySessionStmt = db.prepare('SELECT * FROM agent_session_summaries WHERE sessionId = ? ORDER BY createdAt DESC');
    this.markUsedStmt = db.prepare('UPDATE agent_session_summaries SET usedInResume = 1 WHERE id = ?');
  }

  create(summary: AgentSessionSummary): void {
    this.createStmt.run({
      id: summary.id,
      sessionId: summary.sessionId,
      provider: summary.provider,
      summary: summary.summary,
      sourceEventFrom: summary.sourceEventFrom ?? null,
      sourceEventTo: summary.sourceEventTo ?? null,
      injectedIntoProvider: summary.injectedIntoProvider ? 1 : 0,
      usedInResume: summary.usedInResume ? 1 : 0,
      createdAt: summary.createdAt,
    });
  }

  findLatest(sessionId: string): AgentSessionSummary | undefined {
    const row = this.latestStmt.get(sessionId) as SummaryRow | undefined;
    return row ? rowToSummary(row) : undefined;
  }

  findBySession(sessionId: string): AgentSessionSummary[] {
    return (this.findBySessionStmt.all(sessionId) as SummaryRow[]).map(rowToSummary);
  }

  markUsed(id: string): void {
    this.markUsedStmt.run(id);
  }
}

export class AgentUsageRepository {
  private findStmt: Database.Statement;
  private upsertStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findStmt = db.prepare('SELECT * FROM agent_usage WHERE sessionId = ?');
    this.upsertStmt = db.prepare(
      `INSERT INTO agent_usage (id, sessionId, provider, model, uncachedInputTokens, cacheCreationInputTokens, cacheReadInputTokens, cacheCreation5mInputTokens, cacheCreation1hInputTokens, inputTokens, outputTokens, totalTokens, estimated, costEstimated, uncachedInputCost, cacheCreationCost, cacheReadCost, inputCost, outputCost, totalCost, currency, createdAt, updatedAt)
       VALUES (@id, @sessionId, @provider, @model, @uncachedInputTokens, @cacheCreationInputTokens, @cacheReadInputTokens, @cacheCreation5mInputTokens, @cacheCreation1hInputTokens, @inputTokens, @outputTokens, @totalTokens, @estimated, @costEstimated, @uncachedInputCost, @cacheCreationCost, @cacheReadCost, @inputCost, @outputCost, @totalCost, @currency, @createdAt, @updatedAt)
       ON CONFLICT(sessionId) DO UPDATE SET
         provider = excluded.provider,
         model = excluded.model,
         uncachedInputTokens = excluded.uncachedInputTokens,
         cacheCreationInputTokens = excluded.cacheCreationInputTokens,
         cacheReadInputTokens = excluded.cacheReadInputTokens,
         cacheCreation5mInputTokens = excluded.cacheCreation5mInputTokens,
         cacheCreation1hInputTokens = excluded.cacheCreation1hInputTokens,
         inputTokens = excluded.inputTokens,
         outputTokens = excluded.outputTokens,
         totalTokens = excluded.totalTokens,
         estimated = excluded.estimated,
         costEstimated = excluded.costEstimated,
         uncachedInputCost = excluded.uncachedInputCost,
         cacheCreationCost = excluded.cacheCreationCost,
         cacheReadCost = excluded.cacheReadCost,
         inputCost = excluded.inputCost,
         outputCost = excluded.outputCost,
         totalCost = excluded.totalCost,
         currency = excluded.currency,
         updatedAt = excluded.updatedAt`,
    );
  }

  findBySession(sessionId: string): AgentUsage | undefined {
    const row = this.findStmt.get(sessionId) as UsageRow | undefined;
    return row ? rowToUsage(row) : undefined;
  }

  upsert(usage: AgentUsage): void {
    this.upsertStmt.run({
      id: usage.id,
      sessionId: usage.sessionId,
      provider: usage.provider,
      model: usage.model ?? null,
      uncachedInputTokens: usage.uncachedInputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      cacheCreation5mInputTokens: usage.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: usage.cacheCreation1hInputTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      estimated: usage.estimated ? 1 : 0,
      costEstimated: usage.costEstimated ? 1 : 0,
      uncachedInputCost: usage.uncachedInputCost ?? null,
      cacheCreationCost: usage.cacheCreationCost ?? null,
      cacheReadCost: usage.cacheReadCost ?? null,
      inputCost: usage.inputCost ?? null,
      outputCost: usage.outputCost ?? null,
      totalCost: usage.totalCost ?? null,
      currency: usage.currency ?? null,
      createdAt: usage.createdAt,
      updatedAt: usage.updatedAt,
    });
  }
}
