import path from 'node:path';
import { v4 as uuid } from 'uuid';
import type {
  Approval,
  DiffSummary,
  ExecutorApprovalRequest,
  ExecutorType,
  InteractiveExecutor,
  NativeCommandExecutor,
  NativeCommandInput,
  NativeCommandResult,
  RiskLevel,
  Task,
  TaskEvent,
  TaskEventType,
} from '@rac/shared';
import { ApprovalRepository, DiffRepository, EventRepository, TaskRepository } from '@rac/storage';
import type { ExecutorCallbacks } from '@rac/shared';
import type { ExecutorRegistry } from '@rac/executors';
import { assessCommandRisk, assessFilePathRisk, sanitizeLog } from '@rac/security';
import { sseManager } from './sse-manager.js';
import type { ModelRegistry } from './model-registry.js';
import type { ProviderControlService } from './provider-control-service.js';
import { config } from '../config.js';
import type { NotificationService } from './notification-service.js';
import { NotFoundError } from './errors.js';

const RISK_WEIGHTS: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeLog(value);
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeUnknown);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeUnknown(nestedValue)]),
    );
  }

  return value;
}

function isAssistantStdoutPayload(payload: Record<string, unknown>): boolean {
  return (
    payload.stream === 'stdout' &&
    payload.source !== 'tool' &&
    typeof payload.toolRunId !== 'string' &&
    payload.role !== 'user'
  );
}

function attachAssistantTurn(
  partial: Pick<TaskEvent, 'type' | 'level' | 'payload'>,
  assistantTurnId: string,
): Record<string, unknown> {
  const payload = sanitizeUnknown(partial.payload) as Record<string, unknown>;
  if (partial.type === 'task.log' && isAssistantStdoutPayload(payload)) {
    return {
      ...payload,
      role: payload.role ?? 'assistant',
      turnId: payload.turnId ?? assistantTurnId,
    };
  }
  return payload;
}

function getTaskBaseDir(task: Task): string {
  if (!task.workDir) {
    return config.allowedWorkDir ?? process.cwd();
  }

  if (path.isAbsolute(task.workDir)) {
    return path.resolve(task.workDir);
  }

  return path.resolve(config.allowedWorkDir ?? process.cwd(), task.workDir);
}

function pickHigherRisk(current: RiskLevel, candidate: RiskLevel): RiskLevel {
  return RISK_WEIGHTS[candidate] > RISK_WEIGHTS[current] ? candidate : current;
}

function isOutsideAllowedWorkDir(targetPath: string): boolean {
  if (!config.allowedWorkDir) return false;
  const allowedRoot = path.resolve(config.allowedWorkDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(allowedRoot, resolvedTarget);
  return Boolean(relative && (relative.startsWith('..') || path.isAbsolute(relative)));
}

function isNativeCommandExecutor(executor: unknown): executor is NativeCommandExecutor {
  return Boolean(
    executor &&
      typeof executor === 'object' &&
      'listNativeCommands' in executor &&
      'runNativeCommand' in executor &&
      typeof (executor as NativeCommandExecutor).listNativeCommands === 'function' &&
      typeof (executor as NativeCommandExecutor).runNativeCommand === 'function',
  );
}

function normalizeApprovalRequest(
  task: Task,
  request: ExecutorApprovalRequest,
): ExecutorApprovalRequest {
  let riskLevel = request.riskLevel;
  const reasons = [request.reason];
  const baseDir = getTaskBaseDir(task);
  const normalizedTargetPaths = request.targetPaths?.map((targetPath) =>
    path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(baseDir, targetPath),
  );

  if (request.commandPreview) {
    const commandRisk = assessCommandRisk(request.commandPreview);
    riskLevel = pickHigherRisk(riskLevel, commandRisk.level);
    if (commandRisk.requiresApproval && commandRisk.reason !== request.reason) {
      reasons.push(commandRisk.reason);
    }
  }

  for (const targetPath of normalizedTargetPaths ?? []) {
    if (!config.allowedWorkDir) continue;
    const pathRisk = assessFilePathRisk(targetPath, config.allowedWorkDir);
    riskLevel = pickHigherRisk(riskLevel, pathRisk.level);
    if (pathRisk.requiresApproval) {
      reasons.push(pathRisk.reason);
    }
  }

  return {
    ...request,
    riskLevel,
    reason: sanitizeLog(Array.from(new Set(reasons)).join(' | ')),
    commandPreview: request.commandPreview ? sanitizeLog(request.commandPreview) : undefined,
    targetPaths: normalizedTargetPaths,
  };
}

export class TaskService {
  private approvalResolvers = new Map<string, (approved: boolean) => void>();
  private approvalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private taskEventListeners = new Map<string, Set<(event: TaskEvent) => void>>();
  private partialTextListeners = new Map<string, Set<(text: string, isFinal: boolean, turnId?: string) => void>>();

  constructor(
    private taskRepo: TaskRepository,
    private eventRepo: EventRepository,
    private approvalRepo: ApprovalRepository,
    private diffRepo: DiffRepository,
    private executorRegistry: ExecutorRegistry,
    private notificationService?: NotificationService,
    private localDeviceId?: string,
    private modelRegistry?: ModelRegistry,
    private providerControlService?: ProviderControlService,
  ) {}

  private getApprovalTimeoutSeconds(): number {
    return this.notificationService?.getApprovalTimeoutSeconds() ?? config.approvalTimeoutSeconds;
  }

  recordTaskCreated(task: Task): void {
    const event: TaskEvent<'task.created'> = {
      id: uuid(),
      taskId: task.id,
      type: 'task.created',
      level: 'info',
      payload: {
        title: task.title,
        executorType: task.executorType,
        deviceId: task.deviceId,
      },
      createdAt: task.createdAt,
    };

    this.persistTaskEvent(event);
  }

  hasExecutor(type: Task['executorType']): boolean {
    return Boolean(this.executorRegistry.get(type));
  }

  listNativeCommands(type: ExecutorType): string[] {
    const executor = this.executorRegistry.get(type);
    if (!isNativeCommandExecutor(executor)) {
      return [];
    }
    return executor.listNativeCommands();
  }

  async runNativeCommand(
    type: ExecutorType,
    input: NativeCommandInput,
  ): Promise<NativeCommandResult> {
    const executor = this.executorRegistry.get(type);
    if (!executor) {
      throw new Error(`Executor "${type}" is not available on this host.`);
    }
    if (!isNativeCommandExecutor(executor)) {
      throw new Error(`Executor "${type}" does not support native command bridging.`);
    }
    const binding = this.resolveProviderBinding(type, input.modelId);
    return executor.runNativeCommand({
      ...input,
      modelId: binding.modelId,
      providerEnvironment: binding.providerEnvironment,
    });
  }

  async requestPreflightApproval(
    taskId: string,
    request: ExecutorApprovalRequest,
  ): Promise<boolean> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundError(`Agent run ${taskId} not found`);
    }
    return this.requestApprovalForTask(task, request);
  }

  failTask(taskId: string, errorMessage: string): void {
    this.markTaskFailed(taskId, errorMessage);
  }

  isLocalDevice(deviceId: string): boolean {
    return !this.localDeviceId || deviceId === this.localDeviceId;
  }

  async dispatchTask(taskId: string): Promise<void> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundError(`Agent run ${taskId} not found`);
    }

    if (this.isLocalDevice(task.deviceId)) {
      await this.executeTask(taskId);
      return;
    }

    this.persistTaskEvent({
      id: uuid(),
      taskId,
      type: 'task.log',
      level: 'info',
      payload: {
        message: `Agent run queued for remote device ${task.deviceId}. Waiting for its worker to claim it.`,
        stream: 'system',
      },
      createdAt: new Date().toISOString(),
    });

    await this.waitForTerminal(taskId);
  }

  subscribeTaskEvents(
    taskId: string,
    listener: (event: TaskEvent) => void,
  ): () => void {
    const listeners = this.taskEventListeners.get(taskId) ?? new Set<(event: TaskEvent) => void>();
    listeners.add(listener);
    this.taskEventListeners.set(taskId, listeners);

    return () => {
      const current = this.taskEventListeners.get(taskId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.taskEventListeners.delete(taskId);
      }
    };
  }

  subscribePartialText(
    taskId: string,
    listener: (text: string, isFinal: boolean, turnId?: string) => void,
  ): () => void {
    const listeners =
      this.partialTextListeners.get(taskId) ??
      new Set<(text: string, isFinal: boolean, turnId?: string) => void>();
    listeners.add(listener);
    this.partialTextListeners.set(taskId, listeners);

    return () => {
      const current = this.partialTextListeners.get(taskId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.partialTextListeners.delete(taskId);
      }
    };
  }

  async executeTask(taskId: string): Promise<void> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundError(`Agent run ${taskId} not found`);
    }

    const executor = this.executorRegistry.get(task.executorType);
    if (!executor) {
      this.markTaskFailed(taskId, `Executor "${task.executorType}" is not available on this host.`);
      return;
    }

    const startedAt = new Date().toISOString();
    this.taskRepo.updateStatus(taskId, 'running', { startedAt, errorMessage: undefined });
    this.persistTaskEvent({
      id: uuid(),
      taskId,
      type: 'task.started',
      level: 'info',
      payload: {
        executorType: task.executorType,
        workDir: task.workDir,
      },
      createdAt: startedAt,
    });

    const assistantTurnId = uuid();
    const callbacks: ExecutorCallbacks = {
      onEvent: async (partial) => {
        if (this.isTerminal(taskId)) {
          return;
        }

        const event: TaskEvent = {
          id: uuid(),
          taskId,
          type: partial.type,
          level: partial.level,
          payload: attachAssistantTurn(partial, assistantTurnId),
          createdAt: new Date().toISOString(),
        };

        this.persistTaskEvent(event);
      },

      onApprovalRequest: async (request) => {
        if (this.isTerminal(taskId)) {
          return false;
        }

        return this.requestApprovalForTask(task, request, () => {
          void executor.cancelTask(taskId).catch(() => undefined);
        });
      },

      onComplete: async (summary, diff) => {
        if (this.isTerminal(taskId)) {
          return;
        }

        const now = new Date().toISOString();
        this.taskRepo.updateStatus(taskId, 'completed', {
          finishedAt: now,
          summary,
          errorMessage: undefined,
        });

        if (diff) {
          const diffSummary: DiffSummary = {
            id: uuid(),
            taskId,
            filesChanged: diff.filesChanged,
            insertions: diff.insertions,
            deletions: diff.deletions,
            patchText: diff.patchText,
            createdAt: now,
            files: diff.files,
          };

          this.diffRepo.create(diffSummary);
          this.persistTaskEvent({
            id: uuid(),
            taskId,
            type: 'task.diff_ready',
            level: 'info',
            payload: {
              diffSummaryId: diffSummary.id,
              filesChanged: diffSummary.filesChanged,
              insertions: diffSummary.insertions,
              deletions: diffSummary.deletions,
            },
            createdAt: now,
          });
        }

        this.persistTaskEvent({
          id: uuid(),
          taskId,
          type: 'task.completed',
          level: 'info',
          payload: {
            summary,
            filesChanged: diff?.filesChanged ?? 0,
          },
          createdAt: now,
        });
        this.notificationService?.notifyTaskCompleted(task, summary);
      },

      onError: async (errorMessage) => {
        if (this.isTerminal(taskId)) {
          return;
        }

        this.markTaskFailed(taskId, errorMessage);
      },

      onPartialText: (partialTaskId, text, isFinal) => {
        sseManager.broadcastPartialText(partialTaskId, text, isFinal, assistantTurnId);
        this.notifyPartialText(partialTaskId, text, isFinal, assistantTurnId);
      },
    };

    const timeoutMessage = `Agent run exceeded maximum duration of ${config.taskMaxDurationSeconds}s.`;
    const timeoutTimer = setTimeout(() => {
      void executor.cancelTask(taskId).catch(() => undefined);
      this.markTaskFailed(taskId, timeoutMessage);
    }, config.taskMaxDurationSeconds * 1000);

    if (typeof timeoutTimer === 'object' && 'unref' in timeoutTimer) {
      timeoutTimer.unref();
    }

    try {
      const binding = this.resolveProviderBinding(task.executorType, task.modelId);
      await executor.startTask(
        {
          taskId,
          deviceId: task.deviceId,
          title: task.title,
          prompt: task.prompt,
          mode: task.mode,
          permissionMode: task.permissionMode,
          workDir: task.workDir,
          modelId: binding.modelId,
          reasoningEffort: task.reasoningEffort,
          runtimeOptions: task.runtimeOptions,
          providerEnvironment: binding.providerEnvironment,
          resumeSessionId: task.resumeSessionId,
          autoApprove: task.autoApprove,
          createdBy: task.createdBy,
          approvalTimeoutSeconds: this.getApprovalTimeoutSeconds(),
        },
        callbacks,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.markTaskFailed(taskId, message);
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  claimRemoteTask(
    deviceId: string,
    executorTypes?: ExecutorType[],
  ): Task | undefined {
    const task = this.taskRepo.findNextQueuedByDevice(deviceId, executorTypes);
    if (!task) {
      return undefined;
    }

    const startedAt = new Date().toISOString();
    this.taskRepo.updateStatus(task.id, 'running', { startedAt, errorMessage: undefined });
    const claimedTask: Task = {
      ...task,
      status: 'running',
      startedAt,
      errorMessage: undefined,
    };

    this.persistTaskEvent({
      id: uuid(),
      taskId: task.id,
      type: 'task.started',
      level: 'info',
      payload: {
        executorType: task.executorType,
        workDir: task.workDir,
        remoteDeviceId: deviceId,
      },
      createdAt: startedAt,
    });

    return claimedTask;
  }

  recordRemoteTaskEvent(
    taskId: string,
    deviceId: string,
    partial: Pick<TaskEvent, 'type' | 'level' | 'payload'>,
  ): TaskEvent | undefined {
    const task = this.requireTaskForDevice(taskId, deviceId);
    if (this.isTerminal(task.id)) {
      return undefined;
    }

    const event: TaskEvent = {
      id: uuid(),
      taskId,
      type: partial.type,
      level: partial.level,
      payload: sanitizeUnknown(partial.payload) as Record<string, unknown>,
      createdAt: new Date().toISOString(),
    };

    this.persistTaskEvent(event);
    return event;
  }

  async requestRemoteApproval(
    taskId: string,
    deviceId: string,
    request: ExecutorApprovalRequest,
  ): Promise<boolean> {
    const task = this.requireTaskForDevice(taskId, deviceId);
    if (this.isTerminal(taskId)) {
      return false;
    }

    return this.requestApprovalForTask(task, request);
  }

  completeRemoteTask(
    taskId: string,
    deviceId: string,
    summary: string,
    diff?: Omit<DiffSummary, 'id' | 'taskId' | 'createdAt'>,
  ): void {
    const task = this.requireTaskForDevice(taskId, deviceId);
    if (this.isTerminal(taskId)) {
      return;
    }

    const now = new Date().toISOString();
    this.taskRepo.updateStatus(taskId, 'completed', {
      finishedAt: now,
      summary,
      errorMessage: undefined,
    });

    if (diff && !this.diffRepo.findByTaskId(taskId)) {
      const diffSummary: DiffSummary = {
        id: uuid(),
        taskId,
        filesChanged: diff.filesChanged,
        insertions: diff.insertions,
        deletions: diff.deletions,
        patchText: diff.patchText,
        files: diff.files,
        createdAt: now,
      };
      this.diffRepo.create(diffSummary);
      this.persistTaskEvent({
        id: uuid(),
        taskId,
        type: 'task.diff_ready',
        level: 'info',
        payload: {
          diffSummaryId: diffSummary.id,
          filesChanged: diffSummary.filesChanged,
          insertions: diffSummary.insertions,
          deletions: diffSummary.deletions,
        },
        createdAt: now,
      });
    }

    this.persistTaskEvent({
      id: uuid(),
      taskId,
      type: 'task.completed',
      level: 'info',
      payload: {
        summary,
        filesChanged: diff?.filesChanged ?? 0,
      },
      createdAt: now,
    });
    this.notificationService?.notifyTaskCompleted(task, summary);
  }

  failRemoteTask(taskId: string, deviceId: string, errorMessage: string): void {
    this.requireTaskForDevice(taskId, deviceId);
    this.markTaskFailed(taskId, errorMessage);
  }

  getTaskStatusForDevice(taskId: string, deviceId: string): Pick<Task, 'id' | 'status' | 'finishedAt' | 'errorMessage'> {
    const task = this.requireTaskForDevice(taskId, deviceId);
    return {
      id: task.id,
      status: task.status,
      finishedAt: task.finishedAt,
      errorMessage: task.errorMessage,
    };
  }

  async sendMessage(taskId: string, message: string): Promise<void> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundError('Agent run not found');
    }

    const executor = this.executorRegistry.get(task.executorType);
    if (!executor) {
      throw new Error(`Executor "${task.executorType}" not available`);
    }

    const interactive = executor as unknown as InteractiveExecutor;
    if (!interactive.hasSession || !interactive.sendMessage) {
      throw new Error(`Executor "${task.executorType}" does not support interactive messaging`);
    }

    if (!interactive.hasSession(taskId)) {
      throw new Error('No active session for this run. The run must be completed first.');
    }

    this.persistTaskEvent({
      id: uuid(),
      taskId,
      type: 'task.log',
      level: 'info',
      payload: {
        message: sanitizeLog(message),
        stream: 'system',
        role: 'user',
        turnId: uuid(),
      },
      createdAt: new Date().toISOString(),
    });

    const assistantTurnId = uuid();
    const callbacks: ExecutorCallbacks = {
      onEvent: async (partial) => {
        const event: TaskEvent = {
          id: uuid(),
          taskId,
          type: partial.type,
          level: partial.level,
          payload: attachAssistantTurn(partial, assistantTurnId),
          createdAt: new Date().toISOString(),
        };
        this.persistTaskEvent(event);
      },
      onApprovalRequest: async () => false,
      onComplete: async () => undefined,
      onError: async (errorMessage) => {
        this.persistTaskEvent({
          id: uuid(),
          taskId,
          type: 'task.log',
          level: 'error',
          payload: { message: sanitizeLog(errorMessage), stream: 'stderr' },
          createdAt: new Date().toISOString(),
        });
      },
      onPartialText: (partialTaskId, text, isFinal) => {
        sseManager.broadcastPartialText(partialTaskId, text, isFinal, assistantTurnId);
        this.notifyPartialText(partialTaskId, text, isFinal, assistantTurnId);
      },
    };

    await interactive.sendMessage(taskId, message, task.workDir, callbacks);
  }

  resolveApproval(approvalId: string, approved: boolean, resolvedBy?: string): boolean {
    const approval = this.approvalRepo.findById(approvalId);
    const resolver = this.approvalResolvers.get(approvalId);
    if (!approval || !resolver || approval.status !== 'pending') {
      return false;
    }

    const nextStatus = approved ? 'approved' : 'rejected';
    this.approvalRepo.resolve(approvalId, nextStatus, resolvedBy);
    this.approvalResolvers.delete(approvalId);
    this.clearApprovalTimer(approvalId);

    const updatedApproval = this.approvalRepo.findById(approvalId);
    if (updatedApproval) {
      sseManager.broadcastApproval(updatedApproval);
    }

    this.taskRepo.updateStatus(approval.taskId, 'running');
    this.persistTaskEvent({
      id: uuid(),
      taskId: approval.taskId,
      type: 'task.approval_resolved',
      level: approved ? 'info' : 'warn',
      payload: {
        approvalId,
        status: nextStatus,
        resolvedBy,
      },
      createdAt: new Date().toISOString(),
    });

    resolver(approved);
    return true;
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.taskRepo.findById(taskId);
    if (!task || this.isTerminal(taskId)) {
      return false;
    }

    const pendingApproval = this.approvalRepo.findPendingByTaskId(taskId);
    if (pendingApproval) {
      const resolver = this.approvalResolvers.get(pendingApproval.id);
      if (resolver) {
        this.approvalResolvers.delete(pendingApproval.id);
        this.clearApprovalTimer(pendingApproval.id);
        this.approvalRepo.resolve(pendingApproval.id, 'rejected', 'system');
        const updatedApproval = this.approvalRepo.findById(pendingApproval.id);
        if (updatedApproval) {
          sseManager.broadcastApproval(updatedApproval);
        }
        this.persistTaskEvent({
          id: uuid(),
          taskId,
          type: 'task.approval_resolved',
          level: 'warn',
          payload: {
            approvalId: pendingApproval.id,
            status: 'rejected',
            resolvedBy: 'system',
          },
          createdAt: new Date().toISOString(),
        });
        resolver(false);
      }
    }

    const executor = this.executorRegistry.get(task.executorType);
    if (executor) {
      try {
        await executor.cancelTask(taskId);
      } catch {
        // best effort
      }
    }

    const now = new Date().toISOString();
    this.taskRepo.updateStatus(taskId, 'cancelled', { finishedAt: now });
    this.persistTaskEvent({
      id: uuid(),
      taskId,
      type: 'task.cancelled',
      level: 'warn',
      payload: { reason: 'Cancelled by user request.' },
      createdAt: now,
    });

    return true;
  }

  private requireTaskForDevice(taskId: string, deviceId: string): Task {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new NotFoundError('Agent run not found');
    }
    if (task.deviceId !== deviceId) {
      throw new Error('Agent run does not belong to this device');
    }
    return task;
  }

  private waitForTerminal(taskId: string): Promise<void> {
    if (this.isTerminal(taskId)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const unsubscribe = this.subscribeTaskEvents(taskId, (event) => {
        if (
          event.type === 'task.completed' ||
          event.type === 'task.failed' ||
          event.type === 'task.cancelled'
        ) {
          unsubscribe();
          resolve();
        }
      });
    });
  }

  private requestApprovalForTask(
    task: Task,
    request: ExecutorApprovalRequest,
    onTimeout?: () => void,
  ): Promise<boolean> {
    const taskId = task.id;
    const normalizedRequest = normalizeApprovalRequest(task, request);
    const createdAt = new Date().toISOString();
    const approvalTimeoutSeconds = this.getApprovalTimeoutSeconds();
    const timeoutAt = new Date(
      Date.now() + approvalTimeoutSeconds * 1000,
    ).toISOString();

    const approval: Approval = {
      id: uuid(),
      taskId,
      actionType: normalizedRequest.actionType,
      riskLevel: normalizedRequest.riskLevel,
      reason: normalizedRequest.reason,
      status: 'pending',
      createdAt,
      timeoutAt,
      commandPreview: normalizedRequest.commandPreview,
      targetPaths: normalizedRequest.targetPaths,
    };

    const blockedPath = normalizedRequest.targetPaths?.find(isOutsideAllowedWorkDir);
    if (blockedPath) {
      const resolvedAt = new Date().toISOString();
      const rejectedApproval: Approval = {
        ...approval,
        status: 'rejected',
        resolvedAt,
        resolvedBy: 'workbench-safety',
        reason: `${approval.reason} | Workbench blocked access outside allowedWorkDir: ${blockedPath}`,
      };
      this.approvalRepo.create(rejectedApproval);
      sseManager.broadcastApproval(rejectedApproval);
      this.persistTaskEvent({
        id: uuid(),
        taskId,
        type: 'task.approval_requested',
        level: 'warn',
        payload: {
          approvalId: rejectedApproval.id,
          actionType: rejectedApproval.actionType,
          riskLevel: rejectedApproval.riskLevel,
          reason: rejectedApproval.reason,
          timeoutAt: rejectedApproval.timeoutAt,
        },
        createdAt,
      });
      this.persistTaskEvent({
        id: uuid(),
        taskId,
        type: 'task.approval_resolved',
        level: 'warn',
        payload: {
          approvalId: rejectedApproval.id,
          status: 'rejected',
          reason: rejectedApproval.reason,
        },
        createdAt: resolvedAt,
      });
      return Promise.resolve(false);
    }

    this.approvalRepo.create(approval);
    this.taskRepo.updateStatus(taskId, 'waiting_approval');
    sseManager.broadcastApproval(approval);
    this.persistTaskEvent({
      id: uuid(),
      taskId,
      type: 'task.approval_requested',
      level: 'warn',
      payload: {
        approvalId: approval.id,
        actionType: approval.actionType,
        riskLevel: approval.riskLevel,
        reason: approval.reason,
        timeoutAt: approval.timeoutAt,
      },
      createdAt,
    });
    this.notificationService?.notifyApprovalRequested(task, approval);

    return new Promise<boolean>((resolve) => {
      this.approvalResolvers.set(approval.id, (approved: boolean) => {
        this.clearApprovalTimer(approval.id);
        resolve(approved);
      });

      const timer = setTimeout(() => {
        this.approvalResolvers.delete(approval.id);
        this.approvalRepo.resolve(approval.id, 'expired');

        const expiredApproval = this.approvalRepo.findById(approval.id);
        if (expiredApproval) {
          sseManager.broadcastApproval(expiredApproval);
        }

        this.persistTaskEvent({
          id: uuid(),
          taskId,
          type: 'task.approval_resolved',
          level: 'warn',
          payload: {
            approvalId: approval.id,
            status: 'expired',
          },
          createdAt: new Date().toISOString(),
        });

        onTimeout?.();
        this.markTaskFailed(
          taskId,
          `Approval timed out after ${approvalTimeoutSeconds} seconds.`,
        );

        resolve(false);
      }, approvalTimeoutSeconds * 1000);

      this.approvalTimers.set(approval.id, timer);
    });
  }

  private markTaskFailed(taskId: string, errorMessage: string): void {
    if (this.isTerminal(taskId)) {
      return;
    }

    const task = this.taskRepo.findById(taskId);
    if (!task) {
      return;
    }

    const now = new Date().toISOString();
    const sanitizedErrorMessage = sanitizeLog(errorMessage);
    this.taskRepo.updateStatus(taskId, 'failed', {
      finishedAt: now,
      errorMessage: sanitizedErrorMessage,
    });

    this.persistTaskEvent({
      id: uuid(),
      taskId,
      type: 'task.failed',
      level: 'error',
      payload: {
        errorMessage: sanitizedErrorMessage,
      },
      createdAt: now,
    });
    this.notificationService?.notifyTaskFailed(task, sanitizedErrorMessage);
  }

  private persistTaskEvent<TType extends TaskEventType>(event: TaskEvent<TType>): void {
    const persistedEvent = this.eventRepo.create(event);
    sseManager.sendTaskEvent(persistedEvent.taskId, persistedEvent);
    this.notifyTaskEvent(persistedEvent);
  }

  private notifyTaskEvent(event: TaskEvent): void {
    const listeners = this.taskEventListeners.get(event.taskId);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }

  private notifyPartialText(taskId: string, text: string, isFinal: boolean, turnId?: string): void {
    const listeners = this.partialTextListeners.get(taskId);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(text, isFinal, turnId);
    }
  }

  private resolveProviderBinding(
    executorType: ExecutorType,
    modelId: string | undefined,
  ): { modelId?: string; providerEnvironment?: Record<string, string> } {
    const model = this.modelRegistry?.getForExecutor(executorType, modelId);
    const binding = this.providerControlService?.runtimeBindingForModel(model);
    if (binding) {
      return {
        modelId: binding.modelId,
        providerEnvironment: binding.environment,
      };
    }

    const resolvedModelId = model?.modelId ?? modelId;
    return {
      modelId: resolvedModelId && resolvedModelId !== 'default' ? resolvedModelId : undefined,
    };
  }

  private isTerminal(taskId: string): boolean {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      return true;
    }

    return (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled'
    );
  }

  private clearApprovalTimer(approvalId: string): void {
    const timer = this.approvalTimers.get(approvalId);
    if (timer) {
      clearTimeout(timer);
      this.approvalTimers.delete(approvalId);
    }
  }
}
