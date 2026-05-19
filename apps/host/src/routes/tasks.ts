import path from 'node:path';
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { TaskRepository, EventRepository, DiffRepository, DeviceRepository, ApprovalRepository } from '@rac/storage';
import { createTaskInputSchema, type Task } from '@rac/shared';
import { assessFilePathRisk } from '@rac/security';
import { createLogger } from '@rac/logger';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { TaskService } from '../services/task-service.js';
import { requireRunnableDeviceTarget } from '../services/device-target.js';
import type Database from 'better-sqlite3';
import { parseBody, parseCappedInt, sendError, wrapHandler } from './_helpers.js';

const log = createLogger('tasks');

function generateTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= 60) return cleaned;
  const truncated = cleaned.slice(0, 60);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated) + '…';
}
import { config } from '../config.js';

function normalizeWorkDir(workDir: string): string {
  if (path.isAbsolute(workDir)) {
    return path.resolve(workDir);
  }

  return path.resolve(config.allowedWorkDir ?? process.cwd(), workDir);
}

function validateReasoningEffortForTask(
  executorType: Task['executorType'],
  reasoningEffort: Task['reasoningEffort'],
): string | null {
  if (!reasoningEffort) {
    return null;
  }
  if (executorType !== 'codex' && executorType !== 'claude-code') {
    return `Executor "${executorType}" does not support reasoning effort control.`;
  }
  const supported = executorType === 'codex'
    ? ['low', 'medium', 'high', 'xhigh']
    : ['low', 'medium', 'high', 'xhigh', 'max'];
  if (!supported.includes(reasoningEffort)) {
    return `Executor "${executorType}" does not support ${reasoningEffort} reasoning effort.`;
  }
  return null;
}

export function createTaskRouter(db: Database.Database, taskService: TaskService): Router {
  const router = Router();
  const taskRepo = new TaskRepository(db);
  const eventRepo = new EventRepository(db);
  const diffRepo = new DiffRepository(db);
  const deviceRepo = new DeviceRepository(db);
  const approvalRepo = new ApprovalRepository(db);

  router.use(authMiddleware);

  function validateWorkDir(normalizedWorkDir?: string): string | null {
    if (!normalizedWorkDir || !config.allowedWorkDir) {
      return null;
    }

    const risk = assessFilePathRisk(normalizedWorkDir, config.allowedWorkDir);
    if (risk.level === 'critical') {
      return risk.reason;
    }

    return null;
  }

  function normalizeWorkDirForDevice(deviceId: string, workDir?: string): string | undefined {
    if (!workDir?.trim()) {
      return undefined;
    }
    if (!taskService.isLocalDevice(deviceId)) {
      return workDir.trim();
    }
    return normalizeWorkDir(workDir);
  }

  function normalizeRuntimeOptionsForDevice(
    deviceId: string,
    workDir?: string,
    runtimeOptions?: Task['runtimeOptions'],
  ): Task['runtimeOptions'] | undefined {
    if (!runtimeOptions) {
      return undefined;
    }
    if (!taskService.isLocalDevice(deviceId)) {
      return {
        ...runtimeOptions,
        extraDirs: runtimeOptions.extraDirs?.map((dir) => dir.trim()).filter(Boolean),
      };
    }
    return {
      ...runtimeOptions,
      extraDirs: runtimeOptions.extraDirs?.map((dir) =>
        path.isAbsolute(dir)
          ? path.resolve(dir)
          : path.resolve(workDir ?? config.allowedWorkDir ?? process.cwd(), dir),
      ),
    };
  }

  function createQueuedTask(
    input: Pick<
      Task,
      | 'deviceId'
      | 'executorType'
      | 'title'
      | 'prompt'
      | 'workDir'
      | 'autoApprove'
      | 'createdBy'
      | 'retryCount'
      | 'maxRetries'
      | 'parentTaskId'
      | 'parentGroupId'
      | 'modelId'
      | 'reasoningEffort'
      | 'mode'
      | 'permissionMode'
      | 'runtimeOptions'
    >,
  ): Task {
    const now = new Date().toISOString();
    const task: Task = {
      id: uuid(),
      deviceId: input.deviceId,
      executorType: input.executorType,
      title: input.title,
      prompt: input.prompt,
      workDir: input.workDir,
      autoApprove: input.autoApprove,
      retryCount: input.retryCount,
      maxRetries: input.maxRetries,
      parentTaskId: input.parentTaskId,
      parentGroupId: input.parentGroupId,
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort,
      mode: input.mode,
      permissionMode: input.permissionMode,
      runtimeOptions: input.runtimeOptions,
      status: 'queued',
      createdBy: input.createdBy,
      createdAt: now,
    };

    taskRepo.create(task);
    taskService.recordTaskCreated(task);
    void taskService.dispatchTask(task.id).catch((err) => {
      log.error({ err, taskId: task.id }, 'Agent run execution error');
    });

    return task;
  }

  // List tasks
  router.get('/', wrapHandler((req, res) => {
    const { status, deviceId, page, limit } = req.query;
    const p = parseCappedInt(page, 1, 10_000);
    const l = parseCappedInt(limit, 20, 200);
    const result = taskRepo.findAll({
      status: status as string | undefined,
      deviceId: deviceId as string | undefined,
      limit: l,
      offset: (p - 1) * l,
    });
    res.json({
      ok: true,
      data: { ...result, page: p, limit: l },
    });
  }));

  // Create task
  router.post('/', wrapHandler((req, res) => {
    const auth = req as AuthRequest;
    const data = parseBody(req, createTaskInputSchema, 'Invalid agent run payload');
    const { executorType, prompt, workDir, autoApprove, maxRetries, reasoningEffort, mode, permissionMode } =
      data;
    const title = data.title?.trim() || generateTitle(prompt);
    const targetDeviceIds = Array.from(
      new Set(
        (data.deviceIds?.length
          ? data.deviceIds
          : [data.deviceId]
        ).filter((value): value is string => Boolean(value)),
      ),
    );
    const targetInputs = new Map<
      string,
      { workDir?: string; runtimeOptions?: Task['runtimeOptions'] }
    >();
    for (const targetDeviceId of targetDeviceIds) {
      requireRunnableDeviceTarget(deviceRepo, taskService, targetDeviceId, executorType);
      const targetWorkDir = normalizeWorkDirForDevice(targetDeviceId, workDir);
      const targetRuntimeOptions = normalizeRuntimeOptionsForDevice(
        targetDeviceId,
        targetWorkDir,
        data.runtimeOptions,
      );
      if (taskService.isLocalDevice(targetDeviceId)) {
        const workDirError = validateWorkDir(targetWorkDir);
        if (workDirError) {
          sendError(res, 400, workDirError);
          return;
        }
        for (const dir of targetRuntimeOptions?.extraDirs ?? []) {
          const extraDirError = validateWorkDir(dir);
          if (extraDirError) {
            sendError(res, 400, extraDirError);
            return;
          }
        }
      }
      targetInputs.set(targetDeviceId, {
        workDir: targetWorkDir,
        runtimeOptions: targetRuntimeOptions,
      });
    }

    if (targetDeviceIds.length === 0) {
      sendError(res, 400, 'At least one device target is required.');
      return;
    }

    const reasoningEffortError = validateReasoningEffortForTask(executorType, reasoningEffort);
    if (reasoningEffortError) {
      sendError(res, 400, reasoningEffortError);
      return;
    }

    const parentGroupId = targetDeviceIds.length > 1 ? uuid() : undefined;
    const tasks = targetDeviceIds.map((targetDeviceId) => {
      const targetInput = targetInputs.get(targetDeviceId);
      return createQueuedTask({
        deviceId: targetDeviceId,
        executorType,
        title,
        prompt,
        workDir: targetInput?.workDir,
        autoApprove: autoApprove ?? false,
        retryCount: 0,
        maxRetries: maxRetries ?? 0,
        parentTaskId: undefined,
        parentGroupId,
        modelId: data.modelId,
        reasoningEffort,
        mode,
        permissionMode,
        runtimeOptions: targetInput?.runtimeOptions,
        createdBy: auth.username || auth.userId || 'unknown',
      });
    });

    if (parentGroupId) {
      res.status(201).json({
        ok: true,
        data: {
          fanOut: true,
          parentGroupId,
          taskIds: tasks.map((task) => task.id),
          tasks,
        },
      });
      return;
    }

    res.status(201).json({ ok: true, data: tasks[0] });
  }));

  router.post('/:id/retry', wrapHandler((req, res) => {
    const auth = req as AuthRequest;
    const originalTask = taskRepo.findById(req.params.id);
    if (!originalTask) {
      sendError(res, 404, 'Agent run not found');
      return;
    }

    if (originalTask.status !== 'failed') {
      sendError(res, 400, 'Only failed runs can be retried');
      return;
    }

    if (originalTask.retryCount >= originalTask.maxRetries) {
      sendError(res, 400, 'Retry limit reached for this run');
      return;
    }

    requireRunnableDeviceTarget(deviceRepo, taskService, originalTask.deviceId, originalTask.executorType);

    if (taskService.isLocalDevice(originalTask.deviceId)) {
      const workDirError = validateWorkDir(originalTask.workDir);
      if (workDirError) {
        sendError(res, 400, workDirError);
        return;
      }
    }

    const retriedTask = createQueuedTask({
      deviceId: originalTask.deviceId,
      executorType: originalTask.executorType,
      title: originalTask.title,
      prompt: originalTask.prompt,
      workDir: originalTask.workDir,
      autoApprove: originalTask.autoApprove,
      retryCount: originalTask.retryCount + 1,
      maxRetries: originalTask.maxRetries,
      parentTaskId: originalTask.id,
      parentGroupId: originalTask.parentGroupId,
      modelId: originalTask.modelId,
      reasoningEffort: originalTask.reasoningEffort,
      mode: originalTask.mode,
      permissionMode: originalTask.permissionMode,
      runtimeOptions: originalTask.runtimeOptions,
      createdBy: auth.username || auth.userId || 'unknown',
    });

    res.status(201).json({ ok: true, data: retriedTask });
  }));

  // Get task by ID
  router.get('/:id', wrapHandler((req, res) => {
    const task = taskRepo.findById(req.params.id);
    if (!task) {
      sendError(res, 404, 'Agent run not found');
      return;
    }
    const approvals = approvalRepo.findByTaskId(req.params.id);
    const diff = diffRepo.findByTaskId(req.params.id);
    const events = eventRepo.findByTaskId(req.params.id);
    res.json({ ok: true, data: { task, approvals, diff, events } });
  }));

  // Send follow-up message to a running/completed Claude Code session
  router.post('/:id/message', wrapHandler(async (req, res) => {
    const { message } = req.body as { message?: string };
    if (!message || typeof message !== 'string' || !message.trim()) {
      sendError(res, 400, 'message is required');
      return;
    }

    const task = taskRepo.findById(req.params.id);
    if (!task) {
      sendError(res, 404, 'Agent run not found');
      return;
    }

    await taskService.sendMessage(req.params.id, message.trim());
    res.json({ ok: true });
  }));

  // Cancel task
  router.post('/:id/cancel', wrapHandler(async (req, res) => {
    const ok = await taskService.cancelTask(req.params.id);
    if (!ok) {
      sendError(res, 400, 'Cannot cancel run');
      return;
    }
    res.json({ ok: true });
  }));

  // Get task events
  router.get('/:id/events', wrapHandler((req, res) => {
    const task = taskRepo.findById(req.params.id);
    if (!task) {
      sendError(res, 404, 'Agent run not found');
      return;
    }
    const events = eventRepo.findByTaskId(req.params.id);
    res.json({ ok: true, data: events });
  }));

  // Get task diff
  router.get('/:id/diff', wrapHandler((req, res) => {
    const task = taskRepo.findById(req.params.id);
    if (!task) {
      sendError(res, 404, 'Agent run not found');
      return;
    }
    const diff = diffRepo.findByTaskId(req.params.id);
    res.json({ ok: true, data: diff || null });
  }));

  return router;
}
