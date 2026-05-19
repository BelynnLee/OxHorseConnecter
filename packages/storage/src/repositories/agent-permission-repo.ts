import type Database from 'better-sqlite3';
import type { AgentPermissionHit, AgentPermissionRule } from '@rac/shared';

interface RuleRow {
  id: string;
  provider: string;
  deviceId: string | null;
  projectPath: string | null;
  scope: string;
  ruleType: string;
  pattern: string;
  decision: string;
  riskLevel: string | null;
  enabled: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HitRow {
  id: string;
  sessionId: string | null;
  ruleId: string | null;
  provider: string;
  inputType: string;
  inputValue: string;
  decision: string;
  reason: string;
  createdAt: string;
}

function rowToRule(row: RuleRow): AgentPermissionRule {
  return {
    id: row.id,
    provider: row.provider as AgentPermissionRule['provider'],
    deviceId: row.deviceId ?? undefined,
    projectPath: row.projectPath ?? undefined,
    scope: row.scope as AgentPermissionRule['scope'],
    ruleType: row.ruleType as AgentPermissionRule['ruleType'],
    pattern: row.pattern,
    decision: row.decision as AgentPermissionRule['decision'],
    riskLevel: (row.riskLevel ?? undefined) as AgentPermissionRule['riskLevel'],
    enabled: row.enabled === 1,
    description: row.description ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToHit(row: HitRow): AgentPermissionHit {
  return {
    id: row.id,
    sessionId: row.sessionId ?? undefined,
    ruleId: row.ruleId ?? undefined,
    provider: row.provider as AgentPermissionHit['provider'],
    inputType: row.inputType as AgentPermissionHit['inputType'],
    inputValue: row.inputValue,
    decision: row.decision as AgentPermissionHit['decision'],
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export class AgentPermissionRuleRepository {
  private findAllStmt: Database.Statement;
  private findByIdStmt: Database.Statement;
  private createStmt: Database.Statement;
  private updateStmt: Database.Statement;
  private deleteStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findAllStmt = db.prepare('SELECT * FROM agent_permission_rules ORDER BY updatedAt DESC');
    this.findByIdStmt = db.prepare('SELECT * FROM agent_permission_rules WHERE id = ?');
    this.createStmt = db.prepare(
      `INSERT INTO agent_permission_rules (id, provider, deviceId, projectPath, scope, ruleType, pattern, decision, riskLevel, enabled, description, createdAt, updatedAt)
       VALUES (@id, @provider, @deviceId, @projectPath, @scope, @ruleType, @pattern, @decision, @riskLevel, @enabled, @description, @createdAt, @updatedAt)`,
    );
    this.updateStmt = db.prepare(
      `UPDATE agent_permission_rules
       SET provider = @provider,
           deviceId = @deviceId,
           projectPath = @projectPath,
           scope = @scope,
           ruleType = @ruleType,
           pattern = @pattern,
           decision = @decision,
           riskLevel = @riskLevel,
           enabled = @enabled,
           description = @description,
           updatedAt = @updatedAt
       WHERE id = @id`,
    );
    this.deleteStmt = db.prepare('DELETE FROM agent_permission_rules WHERE id = ?');
  }

  findAll(): AgentPermissionRule[] {
    return (this.findAllStmt.all() as RuleRow[]).map(rowToRule);
  }

  findById(id: string): AgentPermissionRule | undefined {
    const row = this.findByIdStmt.get(id) as RuleRow | undefined;
    return row ? rowToRule(row) : undefined;
  }

  create(rule: AgentPermissionRule): void {
    this.createStmt.run({
      id: rule.id,
      provider: rule.provider,
      deviceId: rule.deviceId ?? null,
      projectPath: rule.projectPath ?? null,
      scope: rule.scope,
      ruleType: rule.ruleType,
      pattern: rule.pattern,
      decision: rule.decision,
      riskLevel: rule.riskLevel ?? null,
      enabled: rule.enabled ? 1 : 0,
      description: rule.description ?? null,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    });
  }

  update(rule: AgentPermissionRule): void {
    this.updateStmt.run({
      id: rule.id,
      provider: rule.provider,
      deviceId: rule.deviceId ?? null,
      projectPath: rule.projectPath ?? null,
      scope: rule.scope,
      ruleType: rule.ruleType,
      pattern: rule.pattern,
      decision: rule.decision,
      riskLevel: rule.riskLevel ?? null,
      enabled: rule.enabled ? 1 : 0,
      description: rule.description ?? null,
      updatedAt: rule.updatedAt,
    });
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }
}

export class AgentPermissionHitRepository {
  private findAllStmt: Database.Statement;
  private createStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findAllStmt = db.prepare(
      `SELECT * FROM agent_permission_hits
       ORDER BY createdAt DESC
       LIMIT ?`,
    );
    this.createStmt = db.prepare(
      `INSERT INTO agent_permission_hits (id, sessionId, ruleId, provider, inputType, inputValue, decision, reason, createdAt)
       VALUES (@id, @sessionId, @ruleId, @provider, @inputType, @inputValue, @decision, @reason, @createdAt)`,
    );
  }

  findRecent(limit = 200): AgentPermissionHit[] {
    return (this.findAllStmt.all(limit) as HitRow[]).map(rowToHit);
  }

  create(hit: AgentPermissionHit): void {
    this.createStmt.run({
      id: hit.id,
      sessionId: hit.sessionId ?? null,
      ruleId: hit.ruleId ?? null,
      provider: hit.provider,
      inputType: hit.inputType,
      inputValue: hit.inputValue,
      decision: hit.decision,
      reason: hit.reason,
      createdAt: hit.createdAt,
    });
  }
}
