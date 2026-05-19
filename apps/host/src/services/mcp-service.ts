import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { ProjectRepository } from '@rac/storage';
import type { ConfigRestartResult } from '@rac/shared';
import type { SessionService } from './session-service.js';
import type { RemoteProjectTree, RemoteWorkspaceClient } from './remote-workspace-client.js';
import { config } from '../config.js';
import { NotFoundError, BadRequestError } from './errors.js';

type ToolResult = Record<string, unknown>;
type RestartHost = (reason: string | undefined) => ConfigRestartResult;

interface ToolDefinition {
  name: string;
  description: string;
  mutating: boolean;
  inputSchema: Record<string, unknown>;
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_project_structure',
    description: 'Read a shallow project file tree.',
    mutating: false,
    inputSchema: { projectId: 'string', maxDepth: 'number?' },
  },
  {
    name: 'query_git_status',
    description: 'Read git status for a registered project.',
    mutating: false,
    inputSchema: { projectId: 'string' },
  },
  {
    name: 'read_recent_logs',
    description: 'Read recent session stream events.',
    mutating: false,
    inputSchema: { sessionId: 'string', limit: 'number?' },
  },
  {
    name: 'get_docker_status',
    description: 'Read local Docker container status.',
    mutating: false,
    inputSchema: {},
  },
  {
    name: 'query_gitea_issue',
    description: 'Fetch a Gitea issue when GITEA_BASE_URL and GITEA_TOKEN are configured.',
    mutating: false,
    inputSchema: { owner: 'string', repo: 'string', index: 'number' },
  },
  {
    name: 'create_gitea_issue',
    description: 'Create a Gitea issue when GITEA_BASE_URL and GITEA_TOKEN are configured.',
    mutating: true,
    inputSchema: { owner: 'string', repo: 'string', title: 'string', body: 'string?' },
  },
  {
    name: 'restart_service',
    description: 'Request a host service restart.',
    mutating: true,
    inputSchema: { reason: 'string' },
  },
];

const TOOL_ALIASES = new Map<string, string>([
  ['project_structure', 'get_project_structure'],
  ['git_status', 'query_git_status'],
  ['recent_logs', 'read_recent_logs'],
  ['docker_status', 'get_docker_status'],
  ['gitea_issue', 'query_gitea_issue'],
]);

function inputString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function canonicalToolName(name: string): string {
  return TOOL_ALIASES.get(name) ?? name;
}

function boundedNumber(args: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = typeof args[key] === 'number' ? args[key] : Number(args[key]);
  return Number.isFinite(value) && value > 0 ? Math.min(max, Math.floor(value)) : fallback;
}

function classifyToolFailure(message: string): string {
  const lowered = message.toLowerCase();
  if (lowered.includes('permission') || lowered.includes('denied')) return 'permission_denied';
  if (lowered.includes('timeout') || lowered.includes('timed out')) return 'timeout';
  if (lowered.includes('not found') || lowered.includes('enoent')) return 'missing_file_or_command';
  if (lowered.includes('docker')) return 'tool_unavailable';
  if (lowered.includes('gitea') || lowered.includes('fetch') || lowered.includes('network')) return 'network_error';
  if (lowered.includes('restart')) return 'service_operation_failed';
  return 'unknown';
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readTree(root: string, maxDepth: number): Array<{ path: string; type: 'file' | 'directory' }> {
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.venv', '__pycache__']);
  const entries: Array<{ path: string; type: 'file' | 'directory' }> = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth || entries.length >= 500) {
      return;
    }
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(dirent.name)) {
        continue;
      }
      const absolute = path.join(current, dirent.name);
      const relative = path.relative(root, absolute);
      const type = dirent.isDirectory() ? 'directory' : 'file';
      entries.push({ path: relative, type });
      if (type === 'directory') {
        walk(absolute, depth + 1);
      }
    }
  }

  walk(root, 1);
  return entries;
}

export class McpService {
  private projects: ProjectRepository;

  constructor(
    private db: Database.Database,
    private sessionService: SessionService,
    private restartHost?: RestartHost,
    private hostDeviceId?: string,
    private remoteWorkspace?: RemoteWorkspaceClient,
  ) {
    this.projects = new ProjectRepository(db);
  }

  listTools(): ToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const canonicalName = canonicalToolName(name);
    const tool = TOOL_DEFINITIONS.find((item) => item.name === canonicalName);
    if (!tool) {
      throw new Error(`Unsupported MCP tool: ${name}`);
    }
    const sessionId = inputString(args, 'sessionId');
    this.appendMcpEvent(sessionId, 'mcp.tool.call', {
      tool: canonicalName,
      requestedName: name,
      arguments: args,
      mutating: tool.mutating,
    });

    if (tool.mutating) {
      const approvalId = inputString(args, 'approvalId');
      if (approvalId) {
        const approval = this.findAgentApproval(approvalId);
        if (!approval) {
          throw new NotFoundError('MCP approval not found.');
        }
        if (approval.actionType !== 'mcp_tool' || approval.commandPreview !== canonicalName) {
          throw new Error('MCP approval does not match this tool.');
        }
        if (sessionId && approval.sessionId && approval.sessionId !== sessionId) {
          throw new Error('MCP approval does not match this session.');
        }
        if (approval.status !== 'approved') {
          return {
            approvalRequired: true,
            approvalId,
            status: approval.status,
            message: 'MCP tool execution is waiting for approval.',
          };
        }
      } else {
        const decision = this.sessionService.evaluatePermission({
          provider: 'codex',
          inputType: 'tool',
          inputValue: name,
          riskLevel: 'high',
        });
        if (decision.decision === 'deny') {
          this.appendMcpEvent(sessionId, 'mcp.tool.failed', {
            tool: canonicalName,
            error: `MCP tool denied by policy: ${decision.reason}`,
            decision,
          });
          throw new Error(`MCP tool denied by policy: ${decision.reason}`);
        }
        if (decision.decision === 'ask') {
          const createdApprovalId = this.createAgentApproval(canonicalName, args, decision.reason, decision.riskLevel, sessionId);
          this.appendMcpEvent(sessionId, 'approval.requested', {
            approvalId: createdApprovalId,
            actionType: 'mcp_tool',
            tool: canonicalName,
            decision,
          });
          return {
            approvalRequired: true,
            approvalId: createdApprovalId,
            decision,
            message: 'Mutating MCP tools must be approved before execution.',
          };
        }
      }
    }

    try {
      let result: ToolResult;
      switch (canonicalName) {
        case 'get_project_structure':
          result = await this.projectStructure(args);
          break;
        case 'query_git_status':
          result = await this.gitStatus(args);
          break;
        case 'read_recent_logs':
          result = this.recentLogs(args);
          break;
        case 'get_docker_status':
          result = await this.dockerStatus(args);
          break;
        case 'query_gitea_issue':
          result = await this.giteaIssue(args);
          break;
        case 'create_gitea_issue':
          result = await this.createGiteaIssue(args);
          break;
        case 'restart_service':
          result = this.restartService(args);
          break;
        default:
          throw new Error(`Unsupported MCP tool: ${name}`);
      }
      this.appendMcpEvent(sessionId, 'mcp.tool.result', { tool: canonicalName, result });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'MCP tool failed.';
      this.appendMcpEvent(sessionId, 'mcp.tool.failed', {
        tool: canonicalName,
        error,
        failureReason: classifyToolFailure(error),
      });
      throw err;
    }
  }

  private requireProject(projectId: string): { id: string; path: string; name: string; deviceId: string } {
    const project = this.projects.findById(projectId);
    if (!project) {
      throw new NotFoundError('Project not found.');
    }
    if (!project.enabled) {
      throw new BadRequestError('Project is disabled.');
    }
    if (!project.deviceId || !this.hostDeviceId || project.deviceId === this.hostDeviceId) {
      statSync(project.path);
    }
    return { id: project.id, path: project.path, name: project.name, deviceId: project.deviceId };
  }

  private createAgentApproval(
    toolName: string,
    args: Record<string, unknown>,
    reason: string,
    riskLevel: string,
    sessionId?: string,
  ): string {
    const id = `agent-approval-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO agent_approvals (id, sessionId, runId, actionType, riskLevel, reason, status, createdAt, commandPreview, targetPaths)
         VALUES (@id, @sessionId, NULL, @actionType, @riskLevel, @reason, 'pending', @createdAt, @commandPreview, @targetPaths)`,
      )
      .run({
        id,
        sessionId: sessionId ?? null,
        actionType: 'mcp_tool',
        riskLevel,
        reason,
        createdAt: now,
        commandPreview: toolName,
        targetPaths: JSON.stringify({ args }),
      });
    return id;
  }

  private appendMcpEvent(sessionId: string | undefined, type: string, payload: Record<string, unknown>): void {
    if (!sessionId) {
      return;
    }
    this.db
      .prepare(
        `INSERT INTO agent_events (id, seq, sessionId, runId, type, payload, schemaVersion, createdAt)
         VALUES (
           @id,
           (SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_events WHERE sessionId = @sessionId),
           @sessionId,
           NULL,
           @type,
           @payload,
           1,
           @createdAt
         )`,
      )
      .run({
        id: `mcp-event-${randomUUID()}`,
        sessionId,
        type,
        payload: JSON.stringify(payload),
        createdAt: new Date().toISOString(),
      });
  }

  private findAgentApproval(id: string): {
    id: string;
    sessionId: string | null;
    status: string;
    actionType: string;
    commandPreview: string | null;
  } | undefined {
    return this.db
      .prepare('SELECT id, sessionId, status, actionType, commandPreview FROM agent_approvals WHERE id = ?')
      .get(id) as {
        id: string;
        sessionId: string | null;
        status: string;
        actionType: string;
        commandPreview: string | null;
      } | undefined;
  }

  private async projectStructure(args: Record<string, unknown>): Promise<ToolResult> {
    const projectId = inputString(args, 'projectId');
    if (!projectId) {
      throw new Error('projectId is required.');
    }
    const project = this.requireProject(projectId);
    if (project.deviceId && this.hostDeviceId && project.deviceId !== this.hostDeviceId) {
      if (!this.remoteWorkspace) throw new Error('Remote workspace bridge is not configured.');
      return (await this.remoteWorkspace.request<RemoteProjectTree>(project.deviceId, 'project_tree', {
        projectId: project.id,
        workDir: project.path,
        maxDepth: boundedNumber(args, 'maxDepth', 2, 5),
      })) as unknown as ToolResult;
    }
    return {
      projectId: project.id,
      root: project.path,
      entries: readTree(project.path, boundedNumber(args, 'maxDepth', 2, 5)),
    };
  }

  private async gitStatus(args: Record<string, unknown>): Promise<ToolResult> {
    const projectId = inputString(args, 'projectId');
    if (!projectId) {
      throw new Error('projectId is required.');
    }
    const project = this.requireProject(projectId);
    if (project.deviceId && this.hostDeviceId && project.deviceId !== this.hostDeviceId) {
      if (!this.remoteWorkspace) throw new Error('Remote workspace bridge is not configured.');
      const info = await this.remoteWorkspace.request<Record<string, unknown>>(project.deviceId, 'git_info', {
        workDir: project.path,
      });
      return {
        projectId: project.id,
        ...info,
      };
    }
    return {
      projectId: project.id,
      status: git(project.path, ['status', '--short', '--branch']),
    };
  }

  private recentLogs(args: Record<string, unknown>): ToolResult {
    const sessionId = inputString(args, 'sessionId');
    if (!sessionId) {
      throw new Error('sessionId is required.');
    }
    const rows = this.db
      .prepare(
        `SELECT seq, eventType, delta, payload, createdAt
         FROM session_stream_events
         WHERE sessionId = ?
         ORDER BY seq DESC, createdAt DESC
         LIMIT ?`,
      )
      .all(sessionId, boundedNumber(args, 'limit', 50, 300));
    return { sessionId, events: rows };
  }

  private async dockerStatus(args: Record<string, unknown>): Promise<ToolResult> {
    const deviceId = inputString(args, 'deviceId');
    if (deviceId && this.hostDeviceId && deviceId !== this.hostDeviceId) {
      if (!this.remoteWorkspace) throw new Error('Remote workspace bridge is not configured.');
      return this.remoteWorkspace.request<ToolResult>(deviceId, 'docker_status');
    }
    try {
      const output = execFileSync('docker', ['ps', '--format', '{{json .}}'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return {
        containers: output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>),
      };
    } catch (err) {
      return { containers: [], error: err instanceof Error ? err.message : 'Docker status failed.' };
    }
  }

  private async giteaIssue(args: Record<string, unknown>): Promise<ToolResult> {
    const baseUrl = config.giteaBaseUrl;
    const token = config.giteaToken;
    const owner = inputString(args, 'owner');
    const repo = inputString(args, 'repo');
    const index = boundedNumber(args, 'index', 0, Number.MAX_SAFE_INTEGER);
    if (!baseUrl || !token) {
      return { configured: false, message: 'GITEA_BASE_URL and GITEA_TOKEN are not configured.' };
    }
    if (!owner || !repo || !index) {
      throw new Error('owner, repo, and index are required.');
    }
    const url = new URL(`/api/v1/repos/${owner}/${repo}/issues/${index}`, baseUrl);
    const response = await fetch(url, { headers: { authorization: `token ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Gitea returned ${response.status}.`);
    }
    return payload as ToolResult;
  }

  private async createGiteaIssue(args: Record<string, unknown>): Promise<ToolResult> {
    const baseUrl = config.giteaBaseUrl;
    const token = config.giteaToken;
    const owner = inputString(args, 'owner');
    const repo = inputString(args, 'repo');
    const title = inputString(args, 'title');
    const body = inputString(args, 'body') ?? '';
    if (!baseUrl || !token) {
      return { configured: false, message: 'GITEA_BASE_URL and GITEA_TOKEN are not configured.' };
    }
    if (!owner || !repo || !title) {
      throw new Error('owner, repo, and title are required.');
    }
    const url = new URL(`/api/v1/repos/${owner}/${repo}/issues`, baseUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `token ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title, body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Gitea returned ${response.status}.`);
    }
    return payload as ToolResult;
  }

  private restartService(args: Record<string, unknown>): ToolResult {
    if (!this.restartHost) {
      return {
        accepted: false,
        message: 'Host restart is not wired in this runtime.',
      };
    }

    const result = this.restartHost(inputString(args, 'reason'));
    return {
      accepted: true,
      message: 'Host restart scheduled.',
      restart: result,
    };
  }
}
