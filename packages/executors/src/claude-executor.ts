import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type {
  Executor,
  ExecutorApprovalRequest,
  ExecutorCallbacks,
  RiskLevel,
  StartTaskInput,
} from '@rac/shared';
import { CLAUDE_TOOLS } from './tools/claude-tools.js';
import { getGitDiff } from './tools/git-diff.js';
import { describeToolUse, executeTool } from './tools/tool-runner.js';
import { terminateProcessTree } from './process-tree.js';

interface ClaudeExecutorOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  maxToolRounds?: number;
}

interface ClaudeTaskState {
  cancelled: boolean;
  activeChild?: ChildProcess;
}

interface ClaudeMessageResponse {
  content: ClaudeContentBlock[];
  stop_reason?: string | null;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ClaudeClient {
  messages: {
    create(payload: Record<string, unknown>): Promise<ClaudeMessageResponse>;
  };
}

interface RiskAssessment {
  level: RiskLevel;
  reason: string;
  requiresApproval: boolean;
}

const RISK_WEIGHTS: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const CRITICAL_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\brmdir\s+\/s\b/i,
  /\bdel\b.*\/[fFqQ]/i,
  /\bdelete\b/i,
];

const HIGH_COMMAND_PATTERNS: RegExp[] = [
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+push\s+-f\b/i,
  /\.(env|pem|key)\b/i,
  /\bcredentials\b/i,
  /\bsecret\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bsudo\b/i,
];

const MEDIUM_COMMAND_PATTERNS: RegExp[] = [
  /\bnpm\s+install\b/i,
  /\bpip\s+install\b/i,
  /\bpnpm\s+install\b/i,
  /\byarn\s+add\b/i,
];

async function loadAnthropicClient(): Promise<new (options: { apiKey: string; baseURL?: string }) => ClaudeClient> {
  try {
    const moduleName = '@anthropic-ai/sdk';
    const imported = (await import(moduleName)) as {
      default?: new (options: { apiKey: string; baseURL?: string }) => ClaudeClient;
    };
    const Client = imported.default;
    if (!Client) {
      throw new Error('Anthropic SDK did not expose a default export.');
    }
    return Client;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Claude executor requires @anthropic-ai/sdk to be installed and available at runtime. ${reason}`,
    );
  }
}

function pickHigherRisk(current: RiskLevel, candidate: RiskLevel): RiskLevel {
  return RISK_WEIGHTS[candidate] > RISK_WEIGHTS[current] ? candidate : current;
}

function joinReasons(reasons: string[]): string {
  return Array.from(new Set(reasons.filter(Boolean))).join(' | ');
}

function assessCommandRisk(command: string): RiskAssessment {
  for (const pattern of CRITICAL_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: 'critical',
        reason: `Command matches dangerous pattern: ${pattern.source}`,
        requiresApproval: true,
      };
    }
  }

  for (const pattern of HIGH_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: 'high',
        reason: `Command touches sensitive resources: ${pattern.source}`,
        requiresApproval: true,
      };
    }
  }

  for (const pattern of MEDIUM_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: 'medium',
        reason: `Command installs or mutates external resources: ${pattern.source}`,
        requiresApproval: true,
      };
    }
  }

  return {
    level: 'low',
    reason: 'No known dangerous patterns detected.',
    requiresApproval: false,
  };
}

function assessFilePathRisk(filePath: string, allowedDir: string): RiskAssessment {
  const resolvedPath = path.resolve(filePath);
  const resolvedAllowedDir = path.resolve(allowedDir);
  const relative = path.relative(resolvedAllowedDir, resolvedPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      level: 'critical',
      reason: `Path "${resolvedPath}" is outside the allowed directory "${resolvedAllowedDir}".`,
      requiresApproval: true,
    };
  }

  if (/\.(env|pem|key)$|credentials|id_rsa|id_ed25519/i.test(resolvedPath)) {
    return {
      level: 'high',
      reason: `Path "${resolvedPath}" references a sensitive file.`,
      requiresApproval: true,
    };
  }

  return {
    level: 'low',
    reason: 'Path is within the allowed directory and is not sensitive.',
    requiresApproval: false,
  };
}

function summarizeToolResult(result: string): string | undefined {
  const normalized = result.trim();
  if (!normalized) {
    return undefined;
  }

  const limit = 1200;
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}\n... [truncated ${normalized.length - limit} chars]`;
}

export class ClaudeExecutor implements Executor {
  readonly type = 'claude';

  private readonly maxTokens: number;
  private readonly maxToolRounds: number;
  private readonly taskStates = new Map<string, ClaudeTaskState>();

  constructor(private readonly options: ClaudeExecutorOptions) {
    this.maxTokens = options.maxTokens ?? 8192;
    this.maxToolRounds = options.maxToolRounds ?? 30;
  }

  async startTask(input: StartTaskInput, callbacks: ExecutorCallbacks): Promise<void> {
    const state: ClaudeTaskState = { cancelled: false };
    this.taskStates.set(input.taskId, state);

    try {
      const AnthropicClient = await loadAnthropicClient();
      const client = new AnthropicClient({
        apiKey: input.providerEnvironment?.ANTHROPIC_API_KEY ?? this.options.apiKey,
        ...(input.providerEnvironment?.ANTHROPIC_BASE_URL ? { baseURL: input.providerEnvironment.ANTHROPIC_BASE_URL } : {}),
      });
      const workDir = path.resolve(input.workDir ?? process.cwd());
      const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
        { role: 'user', content: input.prompt },
      ];
      let completed = false;

      for (let round = 0; round < this.maxToolRounds; round += 1) {
        if (state.cancelled) {
          return;
        }

        const response = await client.messages.create({
          model: input.modelId ?? this.options.model,
          max_tokens: this.maxTokens,
          tools: CLAUDE_TOOLS,
          messages,
        });

        for (const block of response.content) {
          if (block.type === 'text' && block.text?.trim()) {
            await callbacks.onEvent({
              taskId: input.taskId,
              type: 'task.log',
              level: 'info',
              payload: {
                message: block.text,
                stream: 'stdout',
              },
            });
          }
        }

        if (response.stop_reason === 'end_turn') {
          completed = true;
          break;
        }

        if (response.stop_reason !== 'tool_use') {
          throw new Error(
            `Claude stopped unexpectedly with reason "${response.stop_reason ?? 'unknown'}".`,
          );
        }

        const toolUseBlocks = response.content.filter(
          (block): block is ClaudeContentBlock & { id: string; name: string; input: Record<string, unknown> } =>
            block.type === 'tool_use' &&
            typeof block.id === 'string' &&
            typeof block.name === 'string' &&
            Boolean(block.input && typeof block.input === 'object'),
        );

        if (toolUseBlocks.length === 0) {
          throw new Error('Claude requested tool use but did not return any tool blocks.');
        }

        const toolResults: Array<{
          type: 'tool_result';
          tool_use_id: string;
          content: string;
        }> = [];

        for (const block of toolUseBlocks) {
          if (state.cancelled) {
            return;
          }

          const toolDescription = describeToolUse(block.name, block.input);
          const approval = this.assessToolRisk(input, workDir, toolDescription);

          await callbacks.onEvent({
            taskId: input.taskId,
            type: 'task.tool_call',
            level: approval.requiresApproval && !input.autoApprove ? 'warn' : 'info',
            payload: {
              tool: block.name,
              action: toolDescription.action,
              inputSummary: toolDescription.inputSummary,
              requiresApproval: approval.requiresApproval && !input.autoApprove,
            },
          });

          let approved = true;
          if (approval.requiresApproval && !input.autoApprove) {
            approved = await callbacks.onApprovalRequest({
              actionType: toolDescription.actionType,
              riskLevel: approval.riskLevel,
              reason: approval.reason,
              commandPreview: toolDescription.commandPreview,
              targetPaths: toolDescription.targetPaths,
            });
          }

          if (state.cancelled) {
            return;
          }

          let result: string;
          if (!approved) {
            result = 'Tool use rejected by user.';
            await callbacks.onEvent({
              taskId: input.taskId,
              type: 'task.log',
              level: 'warn',
              payload: {
                message: `${block.name} was rejected by approval policy.`,
                stream: 'system',
              },
            });
          } else {
            result = await executeTool(block.name, block.input, workDir, {
              onShellProcess: (child) => {
                state.activeChild = child;
              },
            });
            state.activeChild = undefined;

            const toolLog = summarizeToolResult(result);
            if (toolLog) {
              await callbacks.onEvent({
                taskId: input.taskId,
                type: 'task.log',
                level: 'info',
                payload: {
                  message: toolLog,
                  stream: 'system',
                },
              });
            }
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }

        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }

      if (!completed && !state.cancelled) {
        throw new Error(
          `Claude executor exceeded the maximum of ${this.maxToolRounds} tool rounds.`,
        );
      }

      if (state.cancelled) {
        return;
      }

      const diff = getGitDiff(workDir);
      await callbacks.onComplete('Claude finished the task.', diff);
    } catch (error) {
      if (!state.cancelled) {
        const message = error instanceof Error ? error.message : String(error);
        await callbacks.onError(message);
      }
    } finally {
      if (state.activeChild) {
        terminateProcessTree(state.activeChild);
      }
      this.taskStates.delete(input.taskId);
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const state = this.taskStates.get(taskId);
    if (!state) {
      return;
    }

    state.cancelled = true;
    if (state.activeChild) {
      terminateProcessTree(state.activeChild);
      state.activeChild = undefined;
    }
  }

  private assessToolRisk(
    input: StartTaskInput,
    workDir: string,
    toolDescription: ReturnType<typeof describeToolUse>,
  ): ExecutorApprovalRequest & { requiresApproval: boolean } {
    let riskLevel: RiskLevel = 'low';
    let requiresApproval = false;
    const reasons = ['Tool use requested by Claude.'];
    const normalizedTargetPaths = toolDescription.targetPaths?.map((targetPath) =>
      path.isAbsolute(targetPath) ? path.resolve(targetPath) : path.resolve(workDir, targetPath),
    );

    if (toolDescription.commandPreview) {
      const commandRisk = assessCommandRisk(toolDescription.commandPreview);
      riskLevel = pickHigherRisk(riskLevel, commandRisk.level);
      requiresApproval ||= commandRisk.requiresApproval;
      if (commandRisk.requiresApproval || commandRisk.reason) {
        reasons.push(commandRisk.reason);
      }
    }

    for (const targetPath of normalizedTargetPaths ?? []) {
      const pathRisk = assessFilePathRisk(targetPath, workDir);
      riskLevel = pickHigherRisk(riskLevel, pathRisk.level);
      requiresApproval ||= pathRisk.requiresApproval;
      if (pathRisk.requiresApproval || pathRisk.reason) {
        reasons.push(pathRisk.reason);
      }
    }

    return {
      actionType: toolDescription.actionType,
      riskLevel,
      reason: joinReasons(reasons),
      commandPreview: toolDescription.commandPreview,
      targetPaths: normalizedTargetPaths,
      requiresApproval: requiresApproval && !input.autoApprove,
    };
  }
}
