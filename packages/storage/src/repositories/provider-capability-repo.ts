import type Database from 'better-sqlite3';

export interface ProviderCapabilityRecord {
  provider: string;
  version?: string;
  capabilities: Record<string, unknown>;
  detectedAt: string;
}

interface ProviderCapabilityRow {
  provider: string;
  version: string | null;
  capabilities: string;
  detectedAt: string;
}

function rowToRecord(row: ProviderCapabilityRow): ProviderCapabilityRecord {
  let capabilities: Record<string, unknown> = {};
  try {
    capabilities = JSON.parse(row.capabilities) as Record<string, unknown>;
  } catch {
    capabilities = {};
  }
  return {
    provider: row.provider,
    version: row.version ?? undefined,
    capabilities,
    detectedAt: row.detectedAt,
  };
}

export class ProviderCapabilityRepository {
  private upsertStmt: Database.Statement;
  private findStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.upsertStmt = db.prepare(
      `INSERT INTO provider_capabilities (provider, version, capabilities, detectedAt)
       VALUES (@provider, @version, @capabilities, @detectedAt)
       ON CONFLICT(provider) DO UPDATE SET
         version = excluded.version,
         capabilities = excluded.capabilities,
         detectedAt = excluded.detectedAt`,
    );
    this.findStmt = db.prepare('SELECT * FROM provider_capabilities WHERE provider = ?');
  }

  upsert(record: ProviderCapabilityRecord): void {
    this.upsertStmt.run({
      provider: record.provider,
      version: record.version ?? null,
      capabilities: JSON.stringify(record.capabilities),
      detectedAt: record.detectedAt,
    });
  }

  find(provider: string): ProviderCapabilityRecord | undefined {
    const row = this.findStmt.get(provider) as ProviderCapabilityRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }
}
