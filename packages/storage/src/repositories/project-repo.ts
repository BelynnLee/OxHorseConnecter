import type Database from 'better-sqlite3';
import type { Project } from '@rac/shared';

interface ProjectRow {
  id: string;
  deviceId: string;
  name: string;
  path: string;
  gitRemote: string | null;
  defaultBranch: string | null;
  description: string | null;
  enabled: number;
  createdAt: string;
  updatedAt: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    deviceId: row.deviceId,
    name: row.name,
    path: row.path,
    gitRemote: row.gitRemote ?? undefined,
    defaultBranch: row.defaultBranch ?? undefined,
    description: row.description ?? undefined,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ProjectRepository {
  private findByIdStmt: Database.Statement;
  private findByDevicePathStmt: Database.Statement;
  private createStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findByIdStmt = db.prepare('SELECT * FROM projects WHERE id = ?');
    this.findByDevicePathStmt = db.prepare(
      'SELECT * FROM projects WHERE deviceId = ? AND path = ?',
    );
    this.createStmt = db.prepare(
      `INSERT INTO projects (id, deviceId, name, path, gitRemote, defaultBranch, description, enabled, createdAt, updatedAt)
       VALUES (@id, @deviceId, @name, @path, @gitRemote, @defaultBranch, @description, @enabled, @createdAt, @updatedAt)`,
    );
  }

  findAll(filter?: { enabled?: boolean; search?: string; deviceId?: string }): Project[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.deviceId) {
      conditions.push('deviceId = ?');
      params.push(filter.deviceId);
    }
    if (filter?.enabled !== undefined) {
      conditions.push('enabled = ?');
      params.push(filter.enabled ? 1 : 0);
    }
    if (filter?.search?.trim()) {
      conditions.push('(name LIKE ? OR path LIKE ?)');
      const value = `%${filter.search.trim()}%`;
      params.push(value, value);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM projects ${where} ORDER BY enabled DESC, updatedAt DESC`)
      .all(...params) as ProjectRow[];
    return rows.map(rowToProject);
  }

  findById(id: string): Project | undefined {
    const row = this.findByIdStmt.get(id) as ProjectRow | undefined;
    return row ? rowToProject(row) : undefined;
  }

  findByPath(path: string, deviceId = ''): Project | undefined {
    const row = this.findByDevicePathStmt.get(deviceId, path) as ProjectRow | undefined;
    return row ? rowToProject(row) : undefined;
  }

  findByDevicePath(deviceId: string, path: string): Project | undefined {
    return this.findByPath(path, deviceId);
  }

  create(project: Project): void {
    this.createStmt.run({
      id: project.id,
      deviceId: project.deviceId,
      name: project.name,
      path: project.path,
      gitRemote: project.gitRemote ?? null,
      defaultBranch: project.defaultBranch ?? null,
      description: project.description ?? null,
      enabled: project.enabled ? 1 : 0,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  }

  update(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'gitRemote' | 'defaultBranch' | 'description' | 'enabled'>>,
  ): Project | undefined {
    const sets: string[] = ['updatedAt = ?'];
    const params: unknown[] = [new Date().toISOString()];

    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = ?`);
      params.push(key === 'enabled' ? (value ? 1 : 0) : value ?? null);
    }

    params.push(id);
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
