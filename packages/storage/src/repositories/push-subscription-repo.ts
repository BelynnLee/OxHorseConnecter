import type Database from 'better-sqlite3';
import type { PushSubscriptionInput, PushSubscriptionRecord } from '@rac/shared';

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  keys: string;
  createdAt: string;
}

function rowToPushSubscription(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    endpoint: row.endpoint,
    keys: JSON.parse(row.keys) as PushSubscriptionRecord['keys'],
    createdAt: row.createdAt,
  };
}

export class PushSubscriptionRepository {
  private findByEndpointStmt: Database.Statement;
  private createOrUpdateStmt: Database.Statement;
  private deleteByEndpointStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByEndpointStmt = db.prepare(
      'SELECT * FROM push_subscriptions WHERE endpoint = ?',
    );
    this.createOrUpdateStmt = db.prepare(
      `INSERT INTO push_subscriptions (id, endpoint, keys, createdAt)
       VALUES (@id, @endpoint, @keys, @createdAt)
       ON CONFLICT(endpoint) DO UPDATE SET keys = excluded.keys`,
    );
    this.deleteByEndpointStmt = db.prepare(
      'DELETE FROM push_subscriptions WHERE endpoint = ?',
    );
  }

  findAll(): PushSubscriptionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM push_subscriptions ORDER BY createdAt DESC')
      .all() as PushSubscriptionRow[];
    return rows.map(rowToPushSubscription);
  }

  createOrUpdate(
    input: PushSubscriptionInput & Pick<PushSubscriptionRecord, 'id' | 'createdAt'>,
  ): PushSubscriptionRecord {
    this.createOrUpdateStmt.run({
      id: input.id,
      endpoint: input.endpoint,
      keys: JSON.stringify(input.keys),
      createdAt: input.createdAt,
    });

    const row = this.findByEndpointStmt.get(input.endpoint) as
      | PushSubscriptionRow
      | undefined;
    if (!row) {
      throw new Error('Failed to persist push subscription.');
    }

    return rowToPushSubscription(row);
  }

  deleteByEndpoint(endpoint: string): void {
    this.deleteByEndpointStmt.run(endpoint);
  }
}
