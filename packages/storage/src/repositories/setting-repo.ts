import type Database from 'better-sqlite3';

export class SettingRepository {
  private getStmt: Database.Statement;
  private setStmt: Database.Statement;
  private deleteStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    this.setStmt = db.prepare(
      `INSERT INTO settings (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    this.deleteStmt = db.prepare('DELETE FROM settings WHERE key = ?');
  }

  get(key: string): string | undefined {
    const row = this.getStmt.get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.setStmt.run(key, value);
  }

  delete(key: string): void {
    this.deleteStmt.run(key);
  }
}
