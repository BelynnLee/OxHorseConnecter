import type {
  AgentPermissionDecision,
  AgentSession,
  Approval,
  InitClaudeFilePlan,
  InitClaudePlan,
  RiskLevel,
  Task,
} from '@rac/shared';

export interface InitClaudeFilePermission {
  decision: AgentPermissionDecision;
  reason: string;
  riskLevel: RiskLevel;
}

export function buildInitClaudePlan(input: {
  session: AgentSession;
  cwd: string;
  templates: Record<string, string>;
  resolveFile: (relativePath: string) => { normalized: string; target: string };
  exists: (target: string) => boolean;
  evaluateFile: (normalizedPath: string, target: string) => InitClaudeFilePermission;
}): InitClaudePlan {
  const files = Object.entries(input.templates).map(
    ([relativePath, content]): InitClaudeFilePlan => {
      const resolved = input.resolveFile(relativePath);
      if (input.exists(resolved.target)) {
        return {
          path: resolved.normalized,
          action: 'merge-needed',
          reason: 'File already exists; Workbench will not overwrite it.',
        };
      }

      const permission = input.evaluateFile(resolved.normalized, resolved.target);
      const riskLevel = permission.riskLevel;

      if (permission.decision === 'deny') {
        return {
          path: resolved.normalized,
          action: 'unsafe',
          reason: permission.reason,
          permissionDecision: permission.decision,
          riskLevel,
        };
      }

      return {
        path: resolved.normalized,
        action: 'create',
        reason:
          permission.decision === 'ask'
            ? `Requires approval by rule before writing: ${permission.reason}`
            : 'Missing; safe conservative template can be created.',
        content,
        permissionDecision: permission.decision,
        riskLevel,
      };
    }
  );

  return {
    sessionId: input.session.id,
    projectPath: input.cwd,
    files,
    status: 'planned',
  };
}

export function buildInitClaudeApproval(input: {
  id: string;
  taskId: string;
  files: InitClaudeFilePlan[];
  createdAt: string;
}): Approval {
  return {
    id: input.id,
    taskId: input.taskId,
    actionType: 'init_claude',
    riskLevel: input.files.some((file) => file.riskLevel === 'critical')
      ? 'critical'
      : input.files.some((file) => file.riskLevel === 'high')
        ? 'high'
        : 'medium',
    reason: [
      'Workbench approval gate: create missing Claude Code project files.',
      'Files:',
      ...input.files.map((file) => `- ${file.path}: ${file.reason}`),
    ].join('\n'),
    status: 'pending',
    createdAt: input.createdAt,
    commandPreview: input.files.map((file) => `create ${file.path}`).join('\n'),
    targetPaths: input.files.map((file) => file.path),
  };
}

export function createInitClaudeTaskRecord(input: {
  id: string;
  session: AgentSession;
  username: string;
  status: Task['status'];
  createdAt: string;
}): Task {
  return {
    id: input.id,
    deviceId: input.session.deviceId,
    executorType: input.session.executorType,
    title: 'Claude project initialization',
    prompt: '/init-claude apply',
    workDir: input.session.workingDirectory,
    autoApprove: false,
    retryCount: 0,
    maxRetries: 0,
    status: input.status,
    createdBy: input.username,
    createdAt: input.createdAt,
    startedAt: input.status === 'running' ? input.createdAt : undefined,
  };
}
