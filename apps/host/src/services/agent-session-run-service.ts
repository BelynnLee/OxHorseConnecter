import type { ProjectRepository, SettingRepository } from '@rac/storage';
import { agentRuntimeOptionsSchema, reasoningEffortSchema } from '@rac/shared';
import type {
  AgentMode,
  AgentRuntimeOptions,
  AgentSession,
  ExecutorType,
  ReasoningEffort,
  SendSessionMessageResult,
  SessionPermissionMode,
} from '@rac/shared';
import type { RagService } from './rag-service.js';
import type { SessionService } from './session-service.js';
import { BadRequestError, ConflictError, NotFoundError } from './errors.js';
import {
  defaultModelSettingKey,
  generateTitle,
  isWorkbenchExecutorValue,
  normalizeExecutorType,
  normalizeMode,
  normalizePermissionMode,
  promptForMode,
  requireRegisteredProject,
} from '../routes/agent-route-utils.js';

export interface StartAgentSessionInput {
  deviceId?: string;
  projectId?: string;
  projectPath?: string;
  prompt?: string;
  executorType?: ExecutorType;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  mode?: AgentMode;
  permissionMode?: SessionPermissionMode | string;
  confirmDangerousSkip?: boolean;
  runtimeOptions?: AgentRuntimeOptions;
  allowDirtyWorktree?: boolean;
  useRag?: boolean;
  ragTopK?: number;
}

export interface AppendAgentSessionInput {
  content?: string;
  mode?: AgentMode;
  useRag?: boolean;
  ragTopK?: number;
}

export interface StartAgentSessionResult {
  session: AgentSession;
  run: SendSessionMessageResult;
  project: {
    id: string;
    path: string;
  };
}

export class AgentSessionRunService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly settingRepo: SettingRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly ragService?: RagService,
  ) {}

  async start(input: StartAgentSessionInput, actor: string): Promise<StartAgentSessionResult> {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt) {
      throw new BadRequestError('prompt is required');
    }

    const mode = normalizeMode(input.mode);
    const permissionMode = normalizePermissionMode(input.permissionMode);
    if (permissionMode === 'full-access' && input.confirmDangerousSkip !== true) {
      throw new BadRequestError('full-access requires confirmDangerousSkip=true.');
    }
    if (input.executorType !== undefined && !isWorkbenchExecutorValue(input.executorType)) {
      throw new BadRequestError(
        `Executor "${String(input.executorType)}" is not available in Agent Workbench.`
      );
    }

    const executorType = normalizeExecutorType(input.executorType);
    if (!this.sessionService.isWorkbenchExecutor(executorType)) {
      throw new BadRequestError(`Executor "${executorType}" is not available in Agent Workbench.`);
    }

    const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim() : '';
    if (!deviceId) {
      throw new BadRequestError('deviceId is required');
    }

    const modelId = input.model ?? this.settingRepo.get(defaultModelSettingKey(executorType));
    const reasoningEffort = parseReasoningEffort(input.reasoningEffort);
    const runtimeOptions = parseRuntimeOptions(input.runtimeOptions);
    const project = requireRegisteredProject(this.projectRepo, input);
    const projectPath = project.path;
    const isLocalProject = this.sessionService.isLocalDevice(deviceId);
    if (isLocalProject) {
      const worktreeStatus = this.sessionService.inspectWorktree(projectPath);
      if (worktreeStatus.dirty && input.allowDirtyWorktree !== true) {
        throw new ConflictError(
          'Worktree has uncommitted changes. Confirm before starting so baseline isolation is explicit.'
        );
      }
    }
    if (mode === 'agent') {
      this.sessionService.assertNoConcurrentMutatingWorktree(projectPath, undefined, deviceId);
    }

    const session = this.sessionService.create(
      {
        deviceId,
        executorType,
        mode,
        title: generateTitle(prompt),
        modelId,
        reasoningEffort,
        permissionMode,
        workingDirectory: projectPath,
        runtimeOptions,
      },
      actor,
    );
    const agentPrompt = promptForMode(prompt, mode, executorType);
    const promptContent = await this.buildRagPromptContent({
      sessionId: session.id,
      workingDirectory: session.workingDirectory,
      deviceId: session.deviceId,
      query: prompt,
      agentPrompt,
      useRag: input.useRag,
      ragTopK: input.ragTopK,
    });
    const run = await this.sessionService.postMessage(
      session.id,
      agentPrompt,
      actor,
      mode,
      { promptContent },
    );

    return {
      session: run.session,
      run,
      project: {
        id: project.id,
        path: projectPath,
      },
    };
  }

  async append(
    sessionId: string,
    input: AppendAgentSessionInput,
    actor: string,
  ): Promise<SendSessionMessageResult> {
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (!content) {
      throw new BadRequestError('content is required');
    }

    const mode = normalizeMode(input.mode);
    const session = this.sessionService.getSession(sessionId);
    if (!session) {
      throw new NotFoundError('Session not found');
    }
    const agentPrompt = promptForMode(content, mode, session.executorType);
    const promptContent = await this.buildRagPromptContent({
      sessionId,
      workingDirectory: session.workingDirectory,
      deviceId: session.deviceId,
      query: content,
      agentPrompt,
      useRag: input.useRag,
      ragTopK: input.ragTopK,
    });
    return this.sessionService.postMessage(
      sessionId,
      agentPrompt,
      actor,
      mode,
      { promptContent },
    );
  }

  private async buildRagPromptContent(input: {
    sessionId: string;
    workingDirectory?: string;
    deviceId?: string;
    query: string;
    agentPrompt: string;
    useRag?: boolean;
    ragTopK?: unknown;
  }): Promise<string | undefined> {
    if (input.useRag !== true || !this.ragService) {
      return undefined;
    }
    const context = await this.ragService.buildPromptContext({
      sessionId: input.sessionId,
      workingDirectory: input.workingDirectory,
      deviceId: input.deviceId,
      query: input.query,
      topK: typeof input.ragTopK === 'number' ? input.ragTopK : undefined,
    });
    return context ? `${context}\n\nUser request:\n${input.agentPrompt}` : undefined;
  }
}

function parseReasoningEffort(value: ReasoningEffort | undefined): ReasoningEffort | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = reasoningEffortSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestError('Invalid reasoning effort payload');
  }
  return parsed.data;
}

function parseRuntimeOptions(
  value: AgentRuntimeOptions | undefined
): AgentRuntimeOptions | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = agentRuntimeOptionsSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestError('Invalid runtime options payload');
  }
  return parsed.data;
}
