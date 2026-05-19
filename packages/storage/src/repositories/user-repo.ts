import type Database from 'better-sqlite3';
import type { User } from '@rac/shared';

interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt,
  };
}

export class UserRepository {
  private findByUsernameStmt: Database.Statement;
  private findByIdStmt: Database.Statement;
  private getPasswordHashStmt: Database.Statement;
  private upsertStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByUsernameStmt = db.prepare(
      'SELECT id, username, passwordHash, createdAt FROM users WHERE username = ?',
    );
    this.findByIdStmt = db.prepare(
      'SELECT id, username, passwordHash, createdAt FROM users WHERE id = ?',
    );
    this.getPasswordHashStmt = db.prepare(
      'SELECT passwordHash FROM users WHERE username = ?',
    );
    this.upsertStmt = db.prepare(
      `INSERT INTO users (id, username, passwordHash, createdAt)
       VALUES (@id, @username, @passwordHash, @createdAt)
       ON CONFLICT(username) DO UPDATE SET passwordHash = excluded.passwordHash`,
    );
  }

  findByUsername(username: string): User | undefined {
    const row = this.findByUsernameStmt.get(username) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  findById(id: string): User | undefined {
    const row = this.findByIdStmt.get(id) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  getPasswordHash(username: string): string | undefined {
    const row = this.getPasswordHashStmt.get(username) as
      | Pick<UserRow, 'passwordHash'>
      | undefined;
    return row?.passwordHash;
  }

  upsert(user: User & { passwordHash: string }): void {
    this.upsertStmt.run({
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      createdAt: user.createdAt,
    });
  }
}
