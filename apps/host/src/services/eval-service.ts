import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { EvalRepository } from '@rac/storage';
import type { EvalRun, EvalTask, ExecutorType, SessionPermissionMode } from '@rac/shared';
import type { SessionService } from './session-service.js';
import type { RagService } from './rag-service.js';
import type { RemoteEvalPrepareResult, RemoteWorkspaceClient } from './remote-workspace-client.js';
import { NotFoundError } from './errors.js';

interface SessionTextRow {
  content: string;
}

interface CountRow {
  count: number;
}

interface SessionDurationRow {
  startedAt: string | null;
  finishedAt: string | null;
}

interface DiffRow {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: string | null;
}

const EVAL_REPO_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.venv', 'venv', '__pycache__']);

interface ProjectPathRow {
  path: string;
}

interface EvalRunInput {
  taskId: string;
  agentType: string;
  model?: string;
  prompt?: string;
  useRag?: boolean;
  sessionId?: string;
  deviceId?: string;
  projectId?: string;
  workingDirectory?: string;
  permissionMode?: SessionPermissionMode;
}

interface EvalMatrixRunInput {
  taskIds: string[];
  agentTypes: string[];
  models?: string[];
  promptVariants?: string[];
  useRagValues?: boolean[];
  deviceId?: string;
  projectId?: string;
  workingDirectory?: string;
  permissionMode?: SessionPermissionMode;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function groupRuns(runs: EvalRun[], keyForRun: (run: EvalRun) => string): Array<{
  key: string;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  averageScore: number;
}> {
  const groups = new Map<string, EvalRun[]>();
  for (const run of runs) {
    const key = keyForRun(run);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return Array.from(groups.entries())
    .map(([key, group]) => {
      const scores = group
        .map((run) => typeof run.metrics.score === 'number' ? run.metrics.score : undefined)
        .filter((score): score is number => score !== undefined);
      return {
        key,
        totalRuns: group.length,
        completedRuns: group.filter((run) => run.status === 'completed').length,
        failedRuns: group.filter((run) => run.status === 'failed').length,
        averageScore: average(scores),
      };
    })
    .sort((a, b) => b.averageScore - a.averageScore || b.completedRuns - a.completedRuns || a.key.localeCompare(b.key));
}

function count(db: Database.Database, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as CountRow | undefined;
  return row?.count ?? 0;
}

function msBetween(start: string | null | undefined, end: string | null | undefined): number {
  const started = Date.parse(start ?? '');
  const finished = Date.parse(end ?? '');
  return Number.isFinite(started) && Number.isFinite(finished) && finished >= started ? finished - started : 0;
}

function classifyFailure(text: string): string {
  const lowered = text.toLowerCase();
  if (lowered.includes('permission') || lowered.includes('denied')) return 'permission_denied';
  if (lowered.includes('timeout') || lowered.includes('timed out')) return 'timeout';
  if (lowered.includes('not found') || lowered.includes('enoent')) return 'missing_file_or_command';
  if (lowered.includes('approval')) return 'approval_rejected';
  if (lowered.includes('model') || lowered.includes('provider')) return 'model_error';
  if (lowered.includes('network') || lowered.includes('fetch') || lowered.includes('econn')) return 'network_error';
  if (lowered.includes('exit') || lowered.includes('command')) return 'command_failed';
  return 'unknown';
}

function executorType(value: string): ExecutorType {
  if (value === 'mock' || value === 'codex' || value === 'claude' || value === 'claude-code') {
    return value;
  }
  throw new Error(`Unsupported eval agent type: ${value}`);
}

function localDirectory(value: string): string | undefined {
  const resolved = path.resolve(value);
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? resolved : undefined;
}

function copyLocalRepo(source: string, runId: string): string | undefined {
  const sourceDir = localDirectory(source);
  if (!sourceDir) {
    return undefined;
  }
  const target = path.resolve('data', 'evals', runId, 'repo');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(sourceDir, target, {
    recursive: true,
    filter: (src) => !EVAL_REPO_IGNORES.has(path.basename(src)),
  });
  return target;
}

export class EvalService {
  private repo: EvalRepository;

  constructor(
    private db: Database.Database,
    private sessionService?: SessionService,
    private ragService?: RagService,
    private hostDeviceId?: string,
    private remoteWorkspace?: RemoteWorkspaceClient,
  ) {
    this.repo = new EvalRepository(db);
  }

  listTasks(): EvalTask[] {
    return this.repo.listTasks();
  }

  createTask(input: Pick<EvalTask, 'name' | 'repo' | 'prompt' | 'expected'>): EvalTask {
    const now = new Date().toISOString();
    const task: EvalTask = {
      id: `eval-task-${randomUUID()}`,
      name: input.name,
      repo: input.repo,
      prompt: input.prompt,
      expected: input.expected,
      createdAt: now,
      updatedAt: now,
    };
    this.repo.createTask(task);
    return task;
  }

  listRuns(taskId?: string): EvalRun[] {
    return this.repo.listRuns(taskId);
  }

  findRun(id: string): EvalRun | undefined {
    return this.repo.findRun(id);
  }

  async createRun(input: EvalRunInput, createdBy = 'eval-harness'): Promise<EvalRun> {
    const task = this.repo.findTask(input.taskId);
    if (!task) {
      throw new NotFoundError('Eval task not found.');
    }

    const now = new Date().toISOString();
    const evalPrompt = input.prompt?.trim() || task.prompt;
    const run: EvalRun = {
      id: `eval-run-${randomUUID()}`,
      taskId: task.id,
      sessionId: input.sessionId,
      agentType: input.agentType,
      model: input.model,
      useRag: input.useRag ?? false,
      status: input.sessionId ? 'completed' : 'queued',
      metrics: input.sessionId ? this.scoreSession(input.sessionId, task) : {},
      report: input.sessionId
        ? 'Evaluated against an existing AgentSession transcript.'
        : input.prompt?.trim()
          ? 'Queued with a prompt variant for execution by an external harness worker.'
          : 'Queued for execution by an external harness worker.',
      createdAt: now,
      finishedAt: input.sessionId ? now : undefined,
    };
    this.repo.createRun(run);

    if (input.sessionId || !input.deviceId) {
      return run;
    }
    if (!this.sessionService) {
      return run;
    }

    const projectPath = input.projectId
      ? (this.db.prepare('SELECT path FROM projects WHERE id = ?').get(input.projectId) as ProjectPathRow | undefined)?.path
      : undefined;
    const remote = Boolean(input.deviceId && this.hostDeviceId && input.deviceId !== this.hostDeviceId);
    let preparedWorkDir: string | undefined;
    if (remote) {
      if (!this.remoteWorkspace) {
        return this.repo.updateRun(run.id, {
          status: 'failed',
          metrics: { score: 0, failureReason: 'tool_unavailable' },
          report: 'Remote workspace bridge is not configured.',
          finishedAt: new Date().toISOString(),
        }) ?? run;
      }
      try {
        const prepared = await this.remoteWorkspace.request<RemoteEvalPrepareResult>(
          input.deviceId,
          'eval_prepare_repo',
          { runId: run.id, source: input.workingDirectory || projectPath || task.repo },
          { timeoutMs: 60_000 }
        );
        preparedWorkDir = prepared.workDir;
      } catch (err) {
        return this.repo.updateRun(run.id, {
          status: 'failed',
          metrics: {
            score: 0,
            failureReason: classifyFailure(err instanceof Error ? err.message : 'Remote eval preparation failed.'),
          },
          report: err instanceof Error ? err.message : 'Remote eval preparation failed.',
          finishedAt: new Date().toISOString(),
        }) ?? run;
      }
    } else {
      preparedWorkDir = copyLocalRepo(input.workingDirectory || task.repo, run.id);
    }
    const workingDirectory = preparedWorkDir || input.workingDirectory || projectPath || task.repo;

    try {
      const session = this.sessionService.create({
        deviceId: input.deviceId,
        title: `Eval: ${task.name}`,
        executorType: executorType(input.agentType),
        modelId: input.model,
        mode: 'agent',
        permissionMode: input.permissionMode ?? 'default',
        workingDirectory,
      }, createdBy);

      const updated = this.repo.updateRun(run.id, {
        sessionId: session.id,
        status: 'running',
        report: preparedWorkDir
          ? `Prepared local repo copy at ${preparedWorkDir} and started AgentSession ${session.id}${input.prompt?.trim() ? ' with a prompt variant' : ''}.`
          : `Started AgentSession ${session.id}${input.prompt?.trim() ? ' with a prompt variant' : ''}. Repository preparation was skipped because the repo is not a local directory.`,
      }) ?? run;

      let promptContent: string | undefined;
      if (input.useRag && this.ragService) {
        const context = await this.ragService.buildPromptContext({
          sessionId: session.id,
          projectId: input.projectId,
          workingDirectory,
          deviceId: input.deviceId,
          query: evalPrompt,
          topK: 6,
        });
        if (context) {
          promptContent = `${context}\n\nEval task:\n${evalPrompt.trim()}`;
        }
      }

      await this.sessionService.postMessage(
        session.id,
        evalPrompt,
        createdBy,
        'agent',
        { promptContent },
      );
      return updated;
    } catch (err) {
      return this.repo.updateRun(run.id, {
        status: 'failed',
        metrics: {
          score: 0,
          failureReason: classifyFailure(err instanceof Error ? err.message : 'Eval run launch failed.'),
        },
        report: err instanceof Error ? err.message : 'Eval run launch failed.',
        finishedAt: new Date().toISOString(),
      }) ?? run;
    }
  }

  async createMatrixRuns(input: EvalMatrixRunInput, createdBy = 'eval-harness'): Promise<EvalRun[]> {
    const taskIds = uniqueStrings(input.taskIds);
    const agentTypes = uniqueStrings(input.agentTypes);
    if (taskIds.length === 0) {
      throw new Error('At least one eval task is required.');
    }
    if (agentTypes.length === 0) {
      throw new Error('At least one agent type is required.');
    }

    const models = input.models?.length ? uniqueStrings(input.models) : [undefined];
    const promptVariants = input.promptVariants?.length ? uniqueStrings(input.promptVariants) : [undefined];
    const useRagValues = input.useRagValues?.length
      ? Array.from(new Set(input.useRagValues))
      : [false];
    const runs: EvalRun[] = [];

    for (const taskId of taskIds) {
      for (const agentType of agentTypes) {
        for (const model of models) {
          for (const prompt of promptVariants) {
            for (const useRag of useRagValues) {
              runs.push(await this.createRun({
                taskId,
                agentType,
                model,
                prompt,
                useRag,
                deviceId: input.deviceId,
                projectId: input.projectId,
                workingDirectory: input.workingDirectory,
                permissionMode: input.permissionMode,
              }, createdBy));
            }
          }
        }
      }
    }

    return runs;
  }

  completeRun(id: string, input: { sessionId?: string; metrics?: Record<string, unknown>; report?: string }): EvalRun | undefined {
    const run = this.repo.findRun(id);
    if (!run) {
      return undefined;
    }
    const task = this.repo.findTask(run.taskId);
    const metrics = input.metrics ?? (input.sessionId && task ? this.scoreSession(input.sessionId, task) : {});
    return this.repo.updateRun(id, {
      sessionId: input.sessionId ?? run.sessionId,
      status: 'completed',
      metrics,
      report: input.report ?? 'Eval run completed.',
      finishedAt: new Date().toISOString(),
    });
  }

  buildReport(taskId?: string): Record<string, unknown> {
    const runs = this.repo.listRuns(taskId);
    const tasks = new Map(this.repo.listTasks().map((task) => [task.id, task]));
    const completedRuns = runs.filter((run) => run.status === 'completed');
    const scores = completedRuns
      .map((run) => typeof run.metrics.score === 'number' ? run.metrics.score : undefined)
      .filter((score): score is number => score !== undefined);

    return {
      generatedAt: new Date().toISOString(),
      taskId,
      totalRuns: runs.length,
      completedRuns: completedRuns.length,
      failedRuns: runs.filter((run) => run.status === 'failed').length,
      runningRuns: runs.filter((run) => run.status === 'running').length,
      queuedRuns: runs.filter((run) => run.status === 'queued').length,
      averageScore: average(scores),
      byTask: groupRuns(runs, (run) => tasks.get(run.taskId)?.name ?? run.taskId),
      byAgent: groupRuns(runs, (run) => run.agentType),
      byModel: groupRuns(runs, (run) => run.model ?? 'default'),
      byRag: groupRuns(runs, (run) => run.useRag ? 'rag' : 'no-rag'),
      runs,
    };
  }

  private scoreSession(sessionId: string, task: EvalTask): Record<string, unknown> {
    const text = (this.db
      .prepare("SELECT content FROM session_messages WHERE sessionId = ? AND role IN ('assistant', 'tool') ORDER BY sequence ASC")
      .all(sessionId) as SessionTextRow[])
      .map((row) => row.content)
      .join('\n');

    const mustContain = stringList(task.expected.mustContain);
    const matched = mustContain.filter((needle) => text.toLowerCase().includes(needle.toLowerCase()));
    const durationRows = this.db
      .prepare('SELECT startedAt, finishedAt FROM agent_runs WHERE sessionId = ?')
      .all(sessionId) as SessionDurationRow[];
    const durationMs = durationRows.reduce((sum, row) => sum + msBetween(row.startedAt, row.finishedAt), 0);
    const commandCount = count(this.db, 'SELECT COUNT(*) AS count FROM agent_commands WHERE sessionId = ?', sessionId);
    const failedCommandCount = count(
      this.db,
      'SELECT COUNT(*) AS count FROM agent_commands WHERE sessionId = ? AND exitCode IS NOT NULL AND exitCode <> 0',
      sessionId,
    );
    const approvalCount = count(this.db, 'SELECT COUNT(*) AS count FROM agent_approvals WHERE sessionId = ?', sessionId);
    const rejectedApprovalCount = count(
      this.db,
      "SELECT COUNT(*) AS count FROM agent_approvals WHERE sessionId = ? AND status = 'rejected'",
      sessionId,
    );
    const diffRows = this.db
      .prepare('SELECT filesChanged, insertions, deletions, files FROM session_diffs WHERE sessionId = ?')
      .all(sessionId) as DiffRow[];
    const changedFileCount = diffRows.reduce((sum, row) => sum + row.filesChanged, 0);
    const additions = diffRows.reduce((sum, row) => sum + row.insertions, 0);
    const deletions = diffRows.reduce((sum, row) => sum + row.deletions, 0);
    const changedFiles = Array.from(new Set(
      diffRows.flatMap((row) => {
        try {
          const parsed = JSON.parse(row.files ?? '[]') as Array<{ path?: string }>;
          return parsed.map((file) => file.path).filter((filePath): filePath is string => Boolean(filePath));
        } catch {
          return [];
        }
      }),
    ));
    const filesShouldChange = stringList(task.expected.filesShouldChange);
    const filesShouldNotChange = stringList(task.expected.filesShouldNotChange);
    const expectedChangedMatched = filesShouldChange.filter((expectedFile) =>
      changedFiles.some((filePath) => filePath.endsWith(expectedFile) || filePath === expectedFile),
    );
    const unexpectedChanged = filesShouldNotChange.filter((expectedFile) =>
      changedFiles.some((filePath) => filePath.endsWith(expectedFile) || filePath === expectedFile),
    );
    const assertionParts = [
      mustContain.length > 0 ? matched.length / mustContain.length : undefined,
      filesShouldChange.length > 0 ? expectedChangedMatched.length / filesShouldChange.length : undefined,
      filesShouldNotChange.length > 0 ? (filesShouldNotChange.length - unexpectedChanged.length) / filesShouldNotChange.length : undefined,
    ].filter((value): value is number => value !== undefined);
    const assertionsScore = assertionParts.length > 0
      ? assertionParts.reduce((sum, value) => sum + value, 0) / assertionParts.length
      : 1;
    const rollbackRequired = count(
      this.db,
      "SELECT COUNT(*) AS count FROM agent_events WHERE sessionId = ? AND (type LIKE '%discard%' OR type LIKE '%rollback%')",
      sessionId,
    ) > 0;
    const failed = count(this.db, "SELECT COUNT(*) AS count FROM agent_sessions WHERE id = ? AND status = 'failed'", sessionId) > 0;
    const commandPenalty = commandCount > 0 ? failedCommandCount / commandCount : 0;
    const approvalPenalty = approvalCount > 0 ? rejectedApprovalCount / approvalCount : 0;
    const score = Math.max(0, Number((assertionsScore - commandPenalty * 0.25 - approvalPenalty * 0.25).toFixed(4)));
    const failureReason = failed ? classifyFailure(text) : undefined;
    return {
      score,
      matched,
      missing: mustContain.filter((needle) => !matched.includes(needle)),
      assertions: mustContain.length,
      taskCompleted: !failed,
      durationMs,
      commandCount,
      failedCommandCount,
      approvalCount,
      changedFileCount,
      additions,
      deletions,
      changedFiles,
      expectedChangedMatched,
      unexpectedChanged,
      rollbackRequired,
      failureReason,
    };
  }
}
