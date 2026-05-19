import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { AgentPermissionRuleRepository, DeviceRepository, ProjectRepository, SecurityAuditRepository } from '@rac/storage';
import {
  createProjectInputSchema,
  updateProjectInputSchema,
  type AgentPermissionRule,
  type Project,
} from '@rac/shared';
import { authMiddleware } from '../middleware/auth.js';
import { config } from '../config.js';
import type Database from 'better-sqlite3';
import { parseBody, sendError, wrapHandler } from './_helpers.js';
import type { TaskService } from '../services/task-service.js';
import { auditFromRequest } from '../services/security-audit.js';
import type { AuthRequest } from '../middleware/auth.js';

function isInsideOrSame(child: string, parent: string): boolean {
  const normalizedChild = path.resolve(child).toLowerCase();
  const normalizedParent = path.resolve(parent).toLowerCase();
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

function resolveProjectPath(input: string): string {
  const resolved = realpathSync.native(path.resolve(input));
  if (!statSync(resolved).isDirectory()) {
    throw new Error('Project path must be an existing directory.');
  }

  if (config.allowedWorkDir) {
    const allowed = realpathSync.native(path.resolve(config.allowedWorkDir));
    if (!isInsideOrSame(resolved, allowed)) {
      throw new Error(`Project path must be inside ALLOWED_WORK_DIR (${allowed}).`);
    }
  }

  return resolved;
}

function normalizeRemoteProjectPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Project path is required.');
  }
  return trimmed;
}

function projectDisplayName(projectPath: string): string {
  const parts = projectPath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? projectPath;
}

function sameProjectPath(rule: AgentPermissionRule, project: Project): boolean {
  if (rule.scope !== 'project' || !rule.projectPath) {
    return false;
  }
  if ((rule.deviceId ?? '') !== project.deviceId) {
    return false;
  }
  return project.deviceId
    ? rule.projectPath.trim() === project.path.trim()
    : path.resolve(rule.projectPath) === path.resolve(project.path);
}

function gitValue(cwd: string, args: string[]): string | undefined {
  try {
    const output = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

function gitStatus(cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, 'status', '--short', '--branch'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Unable to read git status.');
  }
}

const projectPermissionRuleInputSchema = z.object({
  provider: z.enum(['all', 'shell', 'mock', 'codex', 'claude', 'claude-code', 'custom-command']).optional(),
  ruleType: z.enum(['command', 'file', 'tool', 'prompt', 'risk']),
  pattern: z.string().min(1),
  decision: z.enum(['allow', 'ask', 'deny']),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
});

export function createProjectRouter(db: Database.Database, taskService: TaskService): Router {
  const router = Router();
  const repo = new ProjectRepository(db);
  const devices = new DeviceRepository(db);
  const permissionRules = new AgentPermissionRuleRepository(db);
  const auditRepo = new SecurityAuditRepository(db);

  router.use(authMiddleware);

  router.get('/', wrapHandler((req, res) => {
    const enabled = req.query.enabled === undefined ? undefined : req.query.enabled === 'true';
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    res.json({ ok: true, data: repo.findAll({ enabled, search, deviceId }) });
  }));

  router.post('/', wrapHandler((req: AuthRequest, res) => {
    const data = parseBody(req, createProjectInputSchema, 'Invalid project payload');
    const device = devices.findById(data.deviceId);
    if (!device) {
      sendError(res, 404, 'Device not found');
      return;
    }
    if (!device.trusted) {
      sendError(res, 403, 'Device is not trusted.');
      return;
    }

    const isLocal = taskService.isLocalDevice(device.id);
    const projectPath = isLocal ? resolveProjectPath(data.path) : normalizeRemoteProjectPath(data.path);
    if (!isLocal && (!device.workRoot || device.workRootExists !== true)) {
      sendError(res, 400, 'Remote worker has not reported a usable workspace root.');
      return;
    }

    const existing = repo.findByDevicePath(device.id, projectPath);
    if (existing) {
      const updated = repo.update(existing.id, {
        name: data.name ?? existing.name,
        description: data.description ?? existing.description,
        enabled: data.enabled ?? existing.enabled,
      });
      res.json({ ok: true, data: updated, created: false });
      return;
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: `project-${randomUUID()}`,
      deviceId: device.id,
      name: data.name ?? projectDisplayName(projectPath),
      path: projectPath,
      gitRemote: isLocal ? gitValue(projectPath, ['remote', 'get-url', 'origin']) : undefined,
      defaultBranch: isLocal ? gitValue(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']) : undefined,
      description: data.description,
      enabled: data.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    repo.create(project);
    auditFromRequest(auditRepo, req, {
      eventType: isLocal ? 'project.created' : 'remote.project_created',
      actorType: 'user',
      actorId: req.userId,
      deviceId: device.id,
      message: isLocal ? 'Project was created.' : 'Remote project was created.',
      metadata: { projectId: project.id, path: project.path },
    });
    res.status(201).json({ ok: true, data: project, created: true });
  }));

  router.get('/:id', wrapHandler((req, res) => {
    const project = repo.findById(req.params.id);
    if (!project) {
      sendError(res, 404, 'Project not found');
      return;
    }
    res.json({ ok: true, data: project });
  }));

  router.put('/:id', wrapHandler((req, res) => {
    const data = parseBody(req, updateProjectInputSchema, 'Invalid project payload');
    const updated = repo.update(req.params.id, data);
    if (!updated) {
      sendError(res, 404, 'Project not found');
      return;
    }
    res.json({ ok: true, data: updated });
  }));

  router.patch('/:id', wrapHandler((req, res) => {
    const data = parseBody(req, updateProjectInputSchema, 'Invalid project payload');
    const updated = repo.update(req.params.id, data);
    if (!updated) {
      sendError(res, 404, 'Project not found');
      return;
    }
    res.json({ ok: true, data: updated });
  }));

  router.delete('/:id', wrapHandler((req, res) => {
    res.json({ ok: repo.delete(req.params.id) });
  }));

  router.post('/:id/enable', wrapHandler((req, res) => {
    const updated = repo.update(req.params.id, { enabled: true });
    if (!updated) {
      sendError(res, 404, 'Project not found');
      return;
    }
    res.json({ ok: true, data: updated });
  }));

  router.post('/:id/disable', wrapHandler((req, res) => {
    const updated = repo.update(req.params.id, { enabled: false });
    if (!updated) {
      sendError(res, 404, 'Project not found');
      return;
    }
    res.json({ ok: true, data: updated });
  }));

  router.get('/:id/git-status', wrapHandler((req, res) => {
    const project = repo.findById(req.params.id);
    if (!project) {
      sendError(res, 404, 'Project not found');
      return;
    }
    if (!taskService.isLocalDevice(project.deviceId)) {
      sendError(res, 400, 'Git status is only available for projects on the Host device.');
      return;
    }
    res.json({
      ok: true,
      data: {
        status: gitStatus(project.path),
        branch: gitValue(project.path, ['rev-parse', '--abbrev-ref', 'HEAD']),
        remote: gitValue(project.path, ['remote', 'get-url', 'origin']),
        latestCommit: gitValue(project.path, ['rev-parse', 'HEAD']),
      },
    });
  }));

  router.get('/:id/permission-rules', wrapHandler((req, res) => {
    const project = repo.findById(req.params.id);
    if (!project) {
      sendError(res, 404, 'Project not found');
      return;
    }
    res.json({
      ok: true,
      data: permissionRules
        .findAll()
        .filter((rule) => sameProjectPath(rule, project)),
    });
  }));

  router.post('/:id/permission-rules', wrapHandler((req, res) => {
    const project = repo.findById(req.params.id);
    if (!project) {
      sendError(res, 404, 'Project not found');
      return;
    }
    const data = parseBody(req, projectPermissionRuleInputSchema, 'Invalid permission rule payload');

    const now = new Date().toISOString();
    const rule: AgentPermissionRule = {
      id: `project-rule-${randomUUID()}`,
      provider: data.provider ?? 'all',
      deviceId: project.deviceId,
      projectPath: project.path,
      scope: 'project',
      ruleType: data.ruleType,
      pattern: data.pattern,
      decision: data.decision,
      riskLevel: data.riskLevel,
      enabled: data.enabled ?? true,
      description: data.description,
      createdAt: now,
      updatedAt: now,
    };
    permissionRules.create(rule);
    res.status(201).json({ ok: true, data: rule });
  }));

  router.put('/:id/permission-rules/:ruleId', wrapHandler((req, res) => {
    const project = repo.findById(req.params.id);
    const current = permissionRules.findById(req.params.ruleId);
    if (!project || !current || !sameProjectPath(current, project)) {
      sendError(res, 404, 'Permission rule not found');
      return;
    }
    const data = parseBody(req, projectPermissionRuleInputSchema.partial(), 'Invalid permission rule payload');

    const updated: AgentPermissionRule = {
      ...current,
      ...data,
      deviceId: project.deviceId,
      projectPath: project.path,
      scope: 'project',
      updatedAt: new Date().toISOString(),
    };
    permissionRules.update(updated);
    res.json({ ok: true, data: updated });
  }));

  router.delete('/:id/permission-rules/:ruleId', wrapHandler((req, res) => {
    const project = repo.findById(req.params.id);
    const current = permissionRules.findById(req.params.ruleId);
    if (!project || !current || !sameProjectPath(current, project)) {
      sendError(res, 404, 'Permission rule not found');
      return;
    }
    permissionRules.delete(current.id);
    res.json({ ok: true });
  }));

  return router;
}
