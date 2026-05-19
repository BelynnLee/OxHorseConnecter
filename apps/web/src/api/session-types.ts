import type { TaskEvent } from '../types.ts';

export interface SessionLogsResult {
  taskId?: string;
  events: TaskEvent[];
  text: string;
  limit?: number;
  offset?: number;
  nextOffset?: number;
  truncated?: boolean;
}

export interface SessionGitInfo {
  branch?: string;
  cwd?: string;
  isGitRepository: boolean;
}
