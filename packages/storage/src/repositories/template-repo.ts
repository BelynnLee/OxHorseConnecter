import type Database from 'better-sqlite3';
import type { TaskTemplate } from '@rac/shared';

interface TaskTemplateRow {
  id: string;
  name: string;
  description: string | null;
  executorType: string;
  prompt: string;
  workDir: string | null;
  autoApprove: number;
  createdAt: string;
  updatedAt: string;
}

function rowToTemplate(row: TaskTemplateRow): TaskTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    executorType: row.executorType as TaskTemplate['executorType'],
    prompt: row.prompt,
    workDir: row.workDir ?? undefined,
    autoApprove: row.autoApprove === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class TemplateRepository {
  private findAllStmt: Database.Statement;
  private findByIdStmt: Database.Statement;
  private createStmt: Database.Statement;
  private deleteStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.findAllStmt = db.prepare(
      'SELECT * FROM task_templates ORDER BY updatedAt DESC, createdAt DESC',
    );
    this.findByIdStmt = db.prepare('SELECT * FROM task_templates WHERE id = ?');
    this.createStmt = db.prepare(
      `INSERT INTO task_templates (id, name, description, executorType, prompt, workDir, autoApprove, createdAt, updatedAt)
       VALUES (@id, @name, @description, @executorType, @prompt, @workDir, @autoApprove, @createdAt, @updatedAt)`,
    );
    this.deleteStmt = db.prepare('DELETE FROM task_templates WHERE id = ?');
  }

  findAll(): TaskTemplate[] {
    const rows = this.findAllStmt.all() as TaskTemplateRow[];
    return rows.map(rowToTemplate);
  }

  findById(id: string): TaskTemplate | undefined {
    const row = this.findByIdStmt.get(id) as TaskTemplateRow | undefined;
    return row ? rowToTemplate(row) : undefined;
  }

  create(template: TaskTemplate): void {
    this.createStmt.run({
      id: template.id,
      name: template.name,
      description: template.description ?? null,
      executorType: template.executorType,
      prompt: template.prompt,
      workDir: template.workDir ?? null,
      autoApprove: template.autoApprove ? 1 : 0,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    });
  }

  update(
    id: string,
    updates: Partial<
      Pick<TaskTemplate, 'name' | 'executorType' | 'prompt' | 'autoApprove' | 'updatedAt'>
    > & {
      description?: string | null;
      workDir?: string | null;
    },
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      params.push(updates.name);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
      sets.push('description = ?');
      params.push(updates.description ?? null);
    }
    if (updates.executorType !== undefined) {
      sets.push('executorType = ?');
      params.push(updates.executorType);
    }
    if (updates.prompt !== undefined) {
      sets.push('prompt = ?');
      params.push(updates.prompt);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'workDir')) {
      sets.push('workDir = ?');
      params.push(updates.workDir ?? null);
    }
    if (updates.autoApprove !== undefined) {
      sets.push('autoApprove = ?');
      params.push(updates.autoApprove ? 1 : 0);
    }
    if (updates.updatedAt !== undefined) {
      sets.push('updatedAt = ?');
      params.push(updates.updatedAt);
    }

    if (sets.length === 0) {
      return;
    }

    params.push(id);
    this.db.prepare(`UPDATE task_templates SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  delete(id: string): void {
    this.deleteStmt.run(id);
  }
}
