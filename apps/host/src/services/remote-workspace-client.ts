import type {
  AgentWorktreeStatus,
  DiffSummary,
  InitClaudePlan,
  ModelProfile,
  NativeTerminalRemoteBrowseResult,
  NativeTerminalRemoteWorkspaceOperation,
  NativeTerminalRemoteWorkspacePayload,
} from '@rac/shared';
import type { SessionBaseline } from '@rac/storage';
import type { NativeTerminalService } from './native-terminal-service.js';
import type { SessionFileContent } from './session-helpers.js';

export interface RemoteGitInfo {
  branch?: string;
  cwd?: string;
  isGitRepository: boolean;
}

export interface RemoteProjectTree {
  projectId?: string;
  root: string;
  entries: Array<{ path: string; type: 'file' | 'directory' }>;
}

export interface RemoteRagChunk {
  file: string;
  symbol?: string;
  content: string;
  startLine: number;
  ordinal: number;
}

export interface RemoteRagCollectResult {
  projectPath: string;
  chunks: RemoteRagChunk[];
  indexedFiles: number;
}

export interface RemoteEvalPrepareResult {
  workDir: string;
}

export interface RemoteProviderFile {
  provider: string;
  scope: string;
  kind: string;
  format: 'json' | 'toml';
  path: string;
  exists: boolean;
  content: string;
  hash: string;
  updatedAt?: string;
}

export interface RemoteWorkspaceClient {
  request<T = unknown>(
    deviceId: string,
    operation: NativeTerminalRemoteWorkspaceOperation,
    payload?: NativeTerminalRemoteWorkspacePayload,
    options?: { timeoutMs?: number }
  ): Promise<T>;
}

export class NativeTerminalRemoteWorkspaceClient implements RemoteWorkspaceClient {
  constructor(private readonly nativeTerminalService: NativeTerminalService) {}

  request<T = unknown>(
    deviceId: string,
    operation: NativeTerminalRemoteWorkspaceOperation,
    payload?: NativeTerminalRemoteWorkspacePayload,
    options?: { timeoutMs?: number }
  ): Promise<T> {
    return this.nativeTerminalService.requestRemoteWorkspace<T>(
      deviceId,
      operation,
      payload,
      options
    );
  }

  browse(deviceId: string, path?: string): Promise<NativeTerminalRemoteBrowseResult> {
    return this.request(deviceId, 'browse', { path });
  }

  worktreeStatus(deviceId: string, workDir?: string): Promise<AgentWorktreeStatus> {
    return this.request(deviceId, 'worktree_status', { workDir });
  }

  gitInfo(deviceId: string, workDir?: string): Promise<RemoteGitInfo> {
    return this.request(deviceId, 'git_info', { workDir });
  }

  captureBaseline(
    deviceId: string,
    payload: { sessionId: string; provider: string; workDir?: string }
  ): Promise<SessionBaseline> {
    return this.request(deviceId, 'capture_baseline', payload);
  }

  diffSummary(
    deviceId: string,
    payload: { workDir?: string; baseline?: SessionBaseline; sessionId?: string }
  ): Promise<Omit<DiffSummary, 'id' | 'taskId' | 'createdAt'> | undefined> {
    return this.request(deviceId, 'diff_summary', payload);
  }

  fileContent(
    deviceId: string,
    payload: {
      workDir?: string;
      filePath: string;
      baseline?: SessionBaseline;
      changedPaths?: string[];
    }
  ): Promise<SessionFileContent> {
    return this.request(deviceId, 'file_content', payload);
  }

  discardFile(
    deviceId: string,
    payload: { baseline: SessionBaseline; filePath: string; keptPaths?: string[] }
  ): Promise<Omit<DiffSummary, 'id' | 'taskId' | 'createdAt'> | undefined> {
    return this.request(deviceId, 'discard_file', payload);
  }

  discardAll(
    deviceId: string,
    payload: { baseline: SessionBaseline; keptPaths?: string[] }
  ): Promise<Omit<DiffSummary, 'id' | 'taskId' | 'createdAt'> | undefined> {
    return this.request(deviceId, 'discard_all', payload);
  }

  initClaudePlan(deviceId: string, payload: { session: unknown; workDir?: string }): Promise<InitClaudePlan> {
    return this.request(deviceId, 'init_claude_plan', payload);
  }

  initClaudeApply(
    deviceId: string,
    payload: { session: unknown; workDir?: string; plan: InitClaudePlan }
  ): Promise<InitClaudePlan> {
    return this.request(deviceId, 'init_claude_apply', payload);
  }

  projectTree(
    deviceId: string,
    payload: { projectId?: string; workDir?: string; maxDepth?: number }
  ): Promise<RemoteProjectTree> {
    return this.request(deviceId, 'project_tree', payload);
  }

  ragCollectChunks(deviceId: string, workDir?: string): Promise<RemoteRagCollectResult> {
    return this.request(deviceId, 'rag_collect_chunks', { workDir }, { timeoutMs: 60_000 });
  }

  evalPrepareRepo(
    deviceId: string,
    payload: { runId: string; source?: string }
  ): Promise<RemoteEvalPrepareResult> {
    return this.request(deviceId, 'eval_prepare_repo', payload, { timeoutMs: 60_000 });
  }

  listModels(deviceId: string, workDir?: string): Promise<ModelProfile[]> {
    return this.request(deviceId, 'list_models', { workDir }, { timeoutMs: 30_000 });
  }
}
