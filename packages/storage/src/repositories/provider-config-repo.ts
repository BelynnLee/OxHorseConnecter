import type Database from 'better-sqlite3';
import type { ProviderConfig, ProviderUsagePurpose } from '@rac/shared';

interface ProviderConfigRow {
  id: string;
  name: string;
  type: string;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  models: string;
  timeoutMs: number | null;
  enabled: number;
  usagePurpose: string;
  readonly: number;
  createdAt: string;
  updatedAt: string;
}

function parseModels(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function rowToProviderConfig(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ProviderConfig['type'],
    baseUrl: row.baseUrl ?? undefined,
    apiKeyEncrypted: row.apiKeyEncrypted ?? undefined,
    models: parseModels(row.models),
    timeoutMs: row.timeoutMs ?? undefined,
    enabled: row.enabled === 1,
    usagePurpose: row.usagePurpose as ProviderUsagePurpose,
    readonly: row.readonly === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ProviderConfigRepository {
  private findByIdStmt: Database.Statement;
  private createStmt: Database.Statement;
  private deleteStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByIdStmt = db.prepare('SELECT * FROM provider_configs WHERE id = ?');
    this.createStmt = db.prepare(
      `INSERT INTO provider_configs (id, name, type, baseUrl, apiKeyEncrypted, models, timeoutMs, enabled, usagePurpose, readonly, createdAt, updatedAt)
       VALUES (@id, @name, @type, @baseUrl, @apiKeyEncrypted, @models, @timeoutMs, @enabled, @usagePurpose, @readonly, @createdAt, @updatedAt)`,
    );
    this.deleteStmt = db.prepare('DELETE FROM provider_configs WHERE id = ? AND readonly = 0');
  }

  findAll(filter?: { enabled?: boolean; usagePurpose?: ProviderUsagePurpose }): ProviderConfig[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.enabled !== undefined) {
      conditions.push('enabled = ?');
      params.push(filter.enabled ? 1 : 0);
    }
    if (filter?.usagePurpose) {
      conditions.push('usagePurpose = ?');
      params.push(filter.usagePurpose);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM provider_configs ${where} ORDER BY readonly DESC, enabled DESC, name ASC`)
      .all(...params) as ProviderConfigRow[];
    return rows.map(rowToProviderConfig);
  }

  findById(id: string): ProviderConfig | undefined {
    const row = this.findByIdStmt.get(id) as ProviderConfigRow | undefined;
    return row ? rowToProviderConfig(row) : undefined;
  }

  upsert(config: ProviderConfig): void {
    this.db
      .prepare(
        `INSERT INTO provider_configs (id, name, type, baseUrl, apiKeyEncrypted, models, timeoutMs, enabled, usagePurpose, readonly, createdAt, updatedAt)
         VALUES (@id, @name, @type, @baseUrl, @apiKeyEncrypted, @models, @timeoutMs, @enabled, @usagePurpose, @readonly, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           type = excluded.type,
           baseUrl = excluded.baseUrl,
           apiKeyEncrypted = COALESCE(excluded.apiKeyEncrypted, provider_configs.apiKeyEncrypted),
           models = excluded.models,
           timeoutMs = excluded.timeoutMs,
           enabled = excluded.enabled,
           usagePurpose = excluded.usagePurpose,
           readonly = excluded.readonly,
           updatedAt = excluded.updatedAt`,
      )
      .run({
        id: config.id,
        name: config.name,
        type: config.type,
        baseUrl: config.baseUrl ?? null,
        apiKeyEncrypted: config.apiKeyEncrypted ?? null,
        models: JSON.stringify(config.models),
        timeoutMs: config.timeoutMs ?? null,
        enabled: config.enabled ? 1 : 0,
        usagePurpose: config.usagePurpose,
        readonly: config.readonly ? 1 : 0,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      });
  }

  create(config: ProviderConfig): void {
    this.createStmt.run({
      id: config.id,
      name: config.name,
      type: config.type,
      baseUrl: config.baseUrl ?? null,
      apiKeyEncrypted: config.apiKeyEncrypted ?? null,
      models: JSON.stringify(config.models),
      timeoutMs: config.timeoutMs ?? null,
      enabled: config.enabled ? 1 : 0,
      usagePurpose: config.usagePurpose,
      readonly: config.readonly ? 1 : 0,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  }

  update(id: string, patch: Partial<Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>>): ProviderConfig | undefined {
    const existing = this.findById(id);
    if (!existing || existing.readonly) {
      return existing;
    }

    const sets: string[] = ['updatedAt = ?'];
    const params: unknown[] = [new Date().toISOString()];
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = ?`);
      if (key === 'enabled' || key === 'readonly') {
        params.push(value ? 1 : 0);
      } else if (key === 'models') {
        params.push(JSON.stringify(value ?? []));
      } else {
        params.push(value ?? null);
      }
    }

    params.push(id);
    this.db.prepare(`UPDATE provider_configs SET ${sets.join(', ')} WHERE id = ? AND readonly = 0`).run(...params);
    return this.findById(id);
  }

  delete(id: string): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes > 0;
  }
}
