import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import type { ProjectRepository } from '@rac/storage';
import type { AgentMode, ExecutorType, SessionPermissionMode } from '@rac/shared';
import { HttpError } from '../services/errors.js';

const DEFAULT_AGENT_MODEL_SETTING_KEY = 'agent.defaultModel';

export function defaultModelSettingKey(executorType: ExecutorType): string {
  return executorType === 'codex'
    ? DEFAULT_AGENT_MODEL_SETTING_KEY
    : `${DEFAULT_AGENT_MODEL_SETTING_KEY}.${executorType}`;
}

export function handleAgentRouteError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Request failed';
  const status = err instanceof HttpError ? err.statusCode : 400;
  res.status(status).json({ ok: false, error: message });
}

export function normalizeMode(value: unknown): AgentMode {
  return value === 'plan' || value === 'review' ? value : 'agent';
}

export function normalizePermissionMode(value: unknown): SessionPermissionMode {
  if (value === 'readonly') return 'read-only';
  if (value === 'ask') return 'default';
  if (value === 'auto') return 'auto-review';
  if (value === 'dangerous_skip') return 'full-access';
  if (
    value === 'read-only' ||
    value === 'default' ||
    value === 'auto-review' ||
    value === 'full-access'
  ) {
    return value;
  }
  return 'default';
}

export function isWorkbenchExecutorValue(value: unknown): value is ExecutorType {
  return (
    value === 'claude-code' || value === 'codex' || value === 'mock' || value === 'custom-command'
  );
}

export function normalizeExecutorType(value: unknown): ExecutorType {
  return isWorkbenchExecutorValue(value) ? value : 'codex';
}

export function normalizeNativeTerminalProvider(value: unknown): 'codex' | 'claude-code' {
  if (value === 'codex' || value === 'claude-code') return value;
  throw new Error('provider must be "codex" or "claude-code".');
}

export function usesProviderNativeMode(executorType: ExecutorType | undefined): boolean {
  return executorType === 'codex' || executorType === 'claude-code';
}

export function resolveExistingDirectory(input: string): string {
  const resolved = realpathSync.native(path.resolve(input));
  if (!statSync(resolved).isDirectory()) {
    throw new Error('Project path must be an existing directory.');
  }
  return resolved;
}

function tryResolveExistingDirectory(input: string): string | undefined {
  try {
    return resolveExistingDirectory(input);
  } catch {
    return undefined;
  }
}

function sameRegisteredPath(
  requestedPath: string,
  projectPath: string,
  resolvedRequestedPath?: string
): boolean {
  if (requestedPath.trim() === projectPath.trim()) {
    return true;
  }

  const resolvedProjectPath = tryResolveExistingDirectory(projectPath);
  if (resolvedRequestedPath && resolvedProjectPath) {
    return path.resolve(resolvedRequestedPath) === path.resolve(resolvedProjectPath);
  }

  return false;
}

export function promptForMode(
  prompt: string,
  mode: AgentMode,
  executorType?: ExecutorType
): string {
  if (usesProviderNativeMode(executorType)) {
    return prompt;
  }

  if (mode === 'plan') {
    return [
      'Plan mode: analyze the request and propose a concrete implementation plan.',
      'Do not edit files, run mutating commands, or make code changes.',
      '',
      prompt,
    ].join('\n');
  }

  if (mode === 'review') {
    return [
      'Review mode: inspect the current repository diff and report bugs, risks, regressions, and missing tests.',
      'Prioritize findings with file and line references. Do not modify files unless explicitly asked.',
      '',
      prompt,
    ].join('\n');
  }

  return prompt;
}

export function generateTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  return cleaned.length > 54
    ? `${cleaned.slice(0, 54).trimEnd()}...`
    : cleaned || 'Codex agent run';
}

export function requireRegisteredProject(
  projectRepo: ProjectRepository,
  body: { deviceId?: string; projectId?: string; projectPath?: string }
) {
  const deviceId =
    typeof body.deviceId === 'string' && body.deviceId.trim() ? body.deviceId.trim() : undefined;
  const projectId =
    typeof body.projectId === 'string' && body.projectId.trim() ? body.projectId.trim() : undefined;
  const requestedPath =
    typeof body.projectPath === 'string' && body.projectPath.trim()
      ? body.projectPath.trim()
      : undefined;
  const resolvedRequestedPath = requestedPath
    ? tryResolveExistingDirectory(requestedPath)
    : undefined;

  let project = projectId ? projectRepo.findById(projectId) : undefined;
  if (!project && requestedPath) {
    if (deviceId) {
      project = projectRepo.findByDevicePath(deviceId, requestedPath);
      if (!project && resolvedRequestedPath && resolvedRequestedPath !== requestedPath) {
        project = projectRepo.findByDevicePath(deviceId, resolvedRequestedPath);
      }
    } else {
      project = projectRepo.findByPath(
        resolvedRequestedPath ?? resolveExistingDirectory(requestedPath)
      );
    }
  }

  if (!project) {
    throw new Error('Project must be registered and enabled before starting an Agent Session.');
  }
  if (deviceId && project.deviceId !== deviceId) {
    throw new Error('Project is not registered for the selected device.');
  }
  if (!project.enabled) {
    throw new Error(`Project "${project.name}" is disabled.`);
  }
  if (requestedPath) {
    if (!sameRegisteredPath(requestedPath, project.path, resolvedRequestedPath)) {
      throw new Error('projectPath must match the registered project.');
    }
  }
  return project;
}
