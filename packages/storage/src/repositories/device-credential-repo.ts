import type Database from 'better-sqlite3';
import type { DeviceCredential, DeviceCredentialScope } from '@rac/shared';

interface DeviceCredentialRow {
  id: string;
  deviceId: string;
  tokenHash: string;
  tokenPrefix: string;
  name: string | null;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export type DeviceCredentialRecord = DeviceCredential & {
  tokenHash: string;
};

function parseScopes(value: string): DeviceCredentialScope[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((scope): scope is DeviceCredentialScope =>
        scope === 'heartbeat' ||
        scope === 'claim' ||
        scope === 'report' ||
        scope === 'approval' ||
        scope === 'terminal',
      );
    }
  } catch {
    // fall through
  }
  return [];
}

function rowToCredential(row: DeviceCredentialRow): DeviceCredentialRecord {
  return {
    id: row.id,
    deviceId: row.deviceId,
    tokenHash: row.tokenHash,
    tokenPrefix: row.tokenPrefix,
    name: row.name ?? undefined,
    scopes: parseScopes(row.scopes),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    revokedAt: row.revokedAt ?? undefined,
  };
}

function publicCredential(record: DeviceCredentialRecord): DeviceCredential {
  const { tokenHash: _tokenHash, ...credential } = record;
  return credential;
}

export class DeviceCredentialRepository {
  private findByIdStmt: Database.Statement;
  private findByDeviceIdStmt: Database.Statement;
  private createStmt: Database.Statement;
  private touchStmt: Database.Statement;
  private revokeStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByIdStmt = db.prepare('SELECT * FROM device_credentials WHERE id = ?');
    this.findByDeviceIdStmt = db.prepare(
      'SELECT * FROM device_credentials WHERE deviceId = ? ORDER BY createdAt DESC',
    );
    this.createStmt = db.prepare(
      `INSERT INTO device_credentials (
         id, deviceId, tokenHash, tokenPrefix, name, scopes, createdAt, lastUsedAt, expiresAt, revokedAt
       )
       VALUES (
         @id, @deviceId, @tokenHash, @tokenPrefix, @name, @scopes, @createdAt, @lastUsedAt, @expiresAt, @revokedAt
       )`,
    );
    this.touchStmt = db.prepare(
      'UPDATE device_credentials SET lastUsedAt = ? WHERE id = ?',
    );
    this.revokeStmt = db.prepare(
      'UPDATE device_credentials SET revokedAt = COALESCE(revokedAt, ?) WHERE id = ?',
    );
  }

  findById(id: string): DeviceCredentialRecord | undefined {
    const row = this.findByIdStmt.get(id) as DeviceCredentialRow | undefined;
    return row ? rowToCredential(row) : undefined;
  }

  findPublicByDeviceId(deviceId: string): DeviceCredential[] {
    return (this.findByDeviceIdStmt.all(deviceId) as DeviceCredentialRow[])
      .map(rowToCredential)
      .map(publicCredential);
  }

  create(record: DeviceCredentialRecord): void {
    this.createStmt.run({
      id: record.id,
      deviceId: record.deviceId,
      tokenHash: record.tokenHash,
      tokenPrefix: record.tokenPrefix,
      name: record.name ?? null,
      scopes: JSON.stringify(record.scopes),
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt ?? null,
      expiresAt: record.expiresAt ?? null,
      revokedAt: record.revokedAt ?? null,
    });
  }

  touchLastUsed(id: string, at = new Date().toISOString()): void {
    this.touchStmt.run(at, id);
  }

  revoke(id: string, at = new Date().toISOString()): void {
    this.revokeStmt.run(at, id);
  }
}
