import path from 'node:path';
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import {
  DeviceRepository,
  TemplateRepository,
  TaskRepository,
} from '@rac/storage';
import {
  createTaskTemplateInputSchema,
  runTaskTemplateInputSchema,
  type Task,
  type TaskTemplate,
  updateTaskTemplateInputSchema,
} from '@rac/shared';
import { assessFilePathRisk } from '@rac/security';
import { createLogger } from '@rac/logger';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthRequest } from '../middleware/auth.js';
import type Database from 'better-sqlite3';
import type { TaskService } from '../services/task-service.js';
import { requireRunnableDeviceTarget } from '../services/device-target.js';
import { config } from '../config.js';
import { parseBody, sendError, wrapHandler } from './_helpers.js';

const log = createLogger('templates');

function normalizeWorkDir(workDir: string): string {
  if (path.isAbsolute(workDir)) {
    return path.resolve(workDir);
  }

  return path.resolve(config.allowedWorkDir ?? process.cwd(), workDir);
}

function createQueuedTask(
  taskRepo: TaskRepository,
  taskService: TaskService,
  input: Pick<Task, 'deviceId' | 'executorType' | 'title' | 'prompt' | 'workDir' | 'autoApprove' | 'createdBy'>,
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
    retryCount: 0,
    maxRetries: 0,
    parentTaskId: undefined,
    parentGroupId: undefined,
    status: 'queued',
    createdBy: input.createdBy,
    createdAt: now,
  };

  taskRepo.create(task);
  taskService.recordTaskCreated(task);
  void taskService.dispatchTask(task.id).catch((error) => {
    log.error({ err: error, taskId: task.id }, 'Task execution error');
  });
  return task;
}

export function createTemplateRouter(db: Database.Database, taskService: TaskService): Router {
  const router = Router();
  const templateRepo = new TemplateRepository(db);
  const taskRepo = new TaskRepository(db);
  const deviceRepo = new DeviceRepository(db);

  router.use(authMiddleware);

  router.get('/', (_req, res) => {
    res.json({ ok: true, data: templateRepo.findAll() });
  });

  router.post('/', wrapHandler((req, res) => {
    const data = parseBody(req, createTaskTemplateInputSchema, 'Invalid template payload');

    const storedWorkDir = data.workDir?.trim() || undefined;

    const now = new Date().toISOString();
    const template: TaskTemplate = {
      id: uuid(),
      name: data.name.trim(),
      description: data.description?.trim() || undefined,
      executorType: data.executorType,
      prompt: data.prompt.trim(),
      workDir: storedWorkDir,
      autoApprove: data.autoApprove ?? false,
      createdAt: now,
      updatedAt: now,
    };

    templateRepo.create(template);
    res.status(201).json({ ok: true, data: template });
  }));

  router.get('/:id', wrapHandler((req, res) => {
    const template = templateRepo.findById(req.params.id);
    if (!template) {
      sendError(res, 404, 'Template not found');
      return;
    }

    res.json({ ok: true, data: template });
  }));

  router.put('/:id', wrapHandler((req, res) => {
    const existing = templateRepo.findById(req.params.id);
    if (!existing) {
      sendError(res, 404, 'Template not found');
      return;
    }

    const data = parseBody(req, updateTaskTemplateInputSchema, 'Invalid template payload');

    const hasDescription = Object.prototype.hasOwnProperty.call(data, 'description');
    const hasWorkDir = Object.prototype.hasOwnProperty.call(data, 'workDir');
    const storedWorkDir =
      typeof data.workDir === 'string' && data.workDir.trim()
        ? data.workDir.trim()
        : null;

    const updatedAt = new Date().toISOString();
    templateRepo.update(req.params.id, {
      name: data.name?.trim(),
      description: hasDescription ? data.description?.trim() || null : undefined,
      executorType: data.executorType,
      prompt: data.prompt?.trim(),
      workDir: hasWorkDir ? storedWorkDir : undefined,
      autoApprove: data.autoApprove,
      updatedAt,
    });

    const updated = templateRepo.findById(req.params.id);
    res.json({ ok: true, data: updated ?? existing });
  }));

  router.delete('/:id', wrapHandler((req, res) => {
    const existing = templateRepo.findById(req.params.id);
    if (!existing) {
      sendError(res, 404, 'Template not found');
      return;
    }

    templateRepo.delete(req.params.id);
    res.json({ ok: true });
  }));

  router.post('/:id/run', wrapHandler((req, res) => {
    const auth = req as AuthRequest;
    const template = templateRepo.findById(req.params.id);
    if (!template) {
      sendError(res, 404, 'Template not found');
      return;
    }

    const data = parseBody(req, runTaskTemplateInputSchema, 'Invalid run payload');

    requireRunnableDeviceTarget(deviceRepo, taskService, data.deviceId, template.executorType);
    const workDir = template.workDir && taskService.isLocalDevice(data.deviceId)
      ? normalizeWorkDir(template.workDir)
      : template.workDir;
    if (workDir && taskService.isLocalDevice(data.deviceId) && config.allowedWorkDir) {
      const risk = assessFilePathRisk(workDir, config.allowedWorkDir);
      if (risk.level === 'critical') {
        sendError(res, 400, risk.reason);
        return;
      }
    }

    const task = createQueuedTask(taskRepo, taskService, {
      deviceId: data.deviceId,
      executorType: template.executorType,
      title: template.name,
      prompt: template.prompt,
      workDir,
      autoApprove: template.autoApprove,
      createdBy: auth.username || auth.userId || 'unknown',
    });

    res.status(201).json({ ok: true, data: task });
  }));

  return router;
}
