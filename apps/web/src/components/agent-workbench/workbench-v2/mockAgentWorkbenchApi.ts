import type {
  AgentEvent,
  AgentWorkbenchApi,
  CreateWorkbenchSessionInput,
  PermissionMode,
  WorkbenchCommand,
  WorkbenchContextSummary,
  WorkbenchDevice,
  WorkbenchDiff,
  WorkbenchExecutor,
  WorkbenchFileContent,
  WorkbenchInitPlan,
  WorkbenchLog,
  WorkbenchModel,
  WorkbenchPermissionHit,
  WorkbenchPermissionRule,
  WorkbenchPermissionRuleInput,
  WorkbenchSession,
  WorkbenchUsage,
  WorkbenchWorktreeStatus,
} from './types.ts';
import type { SlashCommand } from '../../../types.ts';
import en from '../../../i18n/locales/en.ts';

const baseTime = Date.parse('2026-04-30T06:00:00.000Z');

function iso(offsetMs: number): string {
  return new Date(baseTime + offsetMs).toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePermissionArgument(value: string): PermissionMode | undefined {
  const normalized = value.toLowerCase().replace(/[_\s]+/g, '-');
  if (normalized === 'read-only' || normalized === 'readonly' || normalized === 'read') return 'read-only';
  if (
    normalized === 'default' ||
    normalized === 'auto' ||
    normalized === 'workspace-write' ||
    normalized === 'ask' ||
    normalized === 'untrusted' ||
    normalized === 'on-request'
  ) return 'default';
  if (normalized === 'auto-review' || normalized === 'autoreview') return 'auto-review';
  if (normalized === 'full-access' || normalized === 'full' || normalized === 'danger-full-access' || normalized === 'bypass') {
    return 'full-access';
  }
  return undefined;
}

const sessions: WorkbenchSession[] = [
  {
    id: 'session-main',
    title: 'Implement Agent Workbench v2',
    projectPath: 'E:\\ox',
    status: 'waiting_approval',
    model: 'gpt-5.3-codex',
    provider: 'mock',
    deviceId: 'mock-device-1',
    mode: 'agent',
    permissionMode: 'default',
    updatedAt: iso(56000),
    checkpoints: [
      { id: 'checkpoint-1', title: 'Before UI shell changes', timestamp: iso(1000) },
      { id: 'checkpoint-2', title: 'Mock diff generated', timestamp: iso(54000) },
    ],
  },
  {
    id: 'session-completed',
    title: 'Review command streaming card',
    projectPath: 'E:\\ox',
    status: 'completed',
    model: 'gpt-5.3-codex',
    provider: 'mock',
    deviceId: 'mock-device-1',
    mode: 'review',
    permissionMode: 'read-only',
    updatedAt: iso(-240000),
    checkpoints: [{ id: 'checkpoint-3', title: 'Review finished', timestamp: iso(-244000) }],
  },
  {
    id: 'session-failed',
    title: 'Investigate flaky setup script',
    projectPath: 'E:\\ox\\scripts',
    status: 'failed',
    model: 'claude-sonnet-4.5',
    provider: 'mock',
    deviceId: 'mock-device-2',
    mode: 'plan',
    permissionMode: 'read-only',
    updatedAt: iso(-480000),
    checkpoints: [],
  },
];

const devices: WorkbenchDevice[] = [
  { id: 'mock-device-1', name: 'Local Mock Host', status: 'online', trusted: true, executors: ['mock', 'codex', 'claude-code'], workRoot: 'E:\\ox', workRootExists: true },
  { id: 'mock-device-2', name: 'Readonly Lab Host', status: 'online', trusted: true, executors: ['mock', 'claude-code'], workRoot: 'E:\\ox', workRootExists: true },
];

const executors: WorkbenchExecutor[] = [
  { type: 'mock', displayName: 'Mock Agent', available: true, permissionMode: en.workbench.permissionModes.default, supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
  { type: 'codex', displayName: 'Codex', available: true, permissionMode: en.workbench.permissionModes.default, supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], supportedServiceTiers: ['standard', 'fast'] },
  { type: 'claude-code', displayName: 'Claude Code', available: true, permissionMode: 'default', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
];

const slashCommands: SlashCommand[] = [
  { name: 'wb:help', description: 'Show available Workbench commands.', usage: '/wb:help', category: 'agent', handler: 'host', source: 'workbench', enabled: true },
  { name: 'wb:model', description: 'Show or switch the Workbench model and reasoning effort.', usage: '/wb:model [model-id] [reasoning-effort]', argsSchema: '[model-id] [default|minimal|low|medium|high|xhigh|max]', category: 'model', handler: 'host', source: 'workbench', enabled: true },
  { name: 'wb:models', description: 'List Workbench-known models available to this executor.', usage: '/wb:models', category: 'model', handler: 'host', source: 'workbench', enabled: true },
  { name: 'wb:fast', description: 'Show or toggle Workbench Codex Fast mode state.', usage: '/wb:fast [on|off|status]', argsSchema: '[on|off|status]', category: 'model', handler: 'host', source: 'workbench', enabled: true },
  { name: 'wb:status', description: 'Show Workbench-local runtime state.', usage: '/wb:status', category: 'environment', handler: 'host', source: 'workbench', enabled: true },
  { name: 'wb:plan', description: 'Run a Workbench planning prompt.', usage: '/wb:plan [prompt]', argsSchema: '[prompt]', category: 'agent', handler: 'agent-mode', source: 'workbench', enabled: true },
  { name: 'wb:review', description: 'Review the current repository diff.', usage: '/wb:review [focus]', argsSchema: '[focus]', category: 'agent', handler: 'agent-mode', source: 'workbench', enabled: true },
  { name: 'wb:diff', description: 'Open the diff review panel in the workbench.', usage: '/wb:diff', category: 'agent', handler: 'frontend', source: 'workbench', enabled: true },
  { name: 'wb:permissions', description: 'Show or switch the Workbench approval preset.', usage: '/wb:permissions [read-only|default|auto-review|full-access]', argsSchema: '[read-only|default|auto-review|full-access]', category: 'agent', handler: 'host', source: 'workbench', enabled: true },
  { name: 'wb:compact', description: 'Create a Workbench-local compact summary.', usage: '/wb:compact', category: 'session', handler: 'frontend', source: 'workbench', enabled: true },
  { name: 'wb:export', description: 'Export the current session.', usage: '/wb:export', category: 'session', handler: 'frontend', source: 'workbench', enabled: true },
  { name: 'wb:clear', description: 'Clear active Workbench context while keeping history.', usage: '/wb:clear', category: 'session', handler: 'frontend', source: 'workbench', enabled: true },
  { name: 'wb:resume', description: 'Resume an interrupted Workbench session.', usage: '/wb:resume', category: 'session', handler: 'frontend', source: 'workbench', enabled: true },
  { name: 'wb:checkpoint', description: 'Record a provider checkpoint marker.', usage: '/wb:checkpoint [title]', argsSchema: '[title]', category: 'session', handler: 'host', source: 'workbench', enabled: true },
  { name: 'wb:rewind', description: 'Rewind provider files to a native checkpoint.', usage: '/wb:rewind [latest|provider-user-message-id] [--dry-run]', argsSchema: '[latest|provider-user-message-id] [--dry-run]', category: 'session', handler: 'host', source: 'workbench', enabled: true },
];

const models: WorkbenchModel[] = [
  { id: 'gpt-5.3-codex', displayName: 'GPT-5.3 Codex', provider: 'OpenAI', executorTypes: ['mock', 'codex'], isDefault: true, supportsReasoningEffort: true, supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], contextWindowTokens: 8000 },
  { id: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', provider: 'Anthropic', executorTypes: ['mock', 'claude-code'], supportsReasoningEffort: true },
  { id: 'mock-fast-no-reasoning', displayName: 'Mock Fast', provider: 'local', executorTypes: ['mock'], supportsReasoningEffort: false },
];

const permissionRules: WorkbenchPermissionRule[] = [
  {
    id: 'rule-safe-read',
    provider: 'all',
    scope: 'global',
    ruleType: 'command',
    pattern: '^(git status|pnpm typecheck:web)',
    decision: 'allow',
    enabled: true,
    builtIn: true,
    description: 'Allow common read-only checks.',
  },
  {
    id: 'rule-apply-patch',
    provider: 'mock',
    projectPath: 'E:\\ox',
    scope: 'project',
    ruleType: 'tool',
    pattern: 'apply_patch',
    decision: 'ask',
    enabled: true,
    description: 'Ask before applying patches.',
  },
];

const permissionHits: WorkbenchPermissionHit[] = [
  {
    id: 'hit-1',
    provider: 'mock',
    inputType: 'tool',
    inputValue: 'apply_patch',
    decision: 'ask',
    reason: 'Project rule requires approval for apply_patch.',
    createdAt: iso(13900),
  },
];

const summariesBySession: Record<string, WorkbenchContextSummary[]> = {
  'session-main': [
    {
      id: 'summary-1',
      summary: 'The session has built a typed Agent Workbench timeline with commands, approvals, diffs, and a real adapter bridge.',
      createdAt: iso(13000),
      injectedIntoProvider: false,
      usedInResume: false,
    },
  ],
};

const usageBySession: Record<string, WorkbenchUsage> = {
  'session-main': {
    uncachedInputTokens: 1240,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreation5mInputTokens: 0,
    cacheCreation1hInputTokens: 0,
    inputTokens: 1240,
    outputTokens: 980,
    totalTokens: 2220,
    estimated: true,
    model: 'gpt-5.3-codex',
  },
};

const mainPatch = [
  'diff --git a/apps/web/src/components/agent-workbench/workbench-v2/AgentTimeline.tsx b/apps/web/src/components/agent-workbench/workbench-v2/AgentTimeline.tsx',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/apps/web/src/components/agent-workbench/workbench-v2/AgentTimeline.tsx',
  '@@ -0,0 +1,8 @@',
  '+export function AgentTimeline() {',
  '+  return (',
  '+    <section data-testid="agent-timeline">',
  '+      {/* events render as typed cards */}',
  '+    </section>',
  '+  );',
  '+}',
].join('\n');

const repeatedCommandResultPayload = JSON.stringify(
  [
    {
      name: 'openaiDeveloperDocs',
      enabled: true,
      disabled_reason: null,
      transport: {
        type: 'streamable_http',
        url: 'https://developers.openai.com/mcp',
        bearer_token_env_var: null,
        http_headers: null,
        env_http_headers: null,
      },
      startup_timeout_sec: null,
      tool_timeout_sec: null,
      auth_status: 'unsupported',
    },
  ],
  null,
  2
);

const eventsBySession: Record<string, AgentEvent[]> = {
  'session-main': [
    { id: 'evt-001', sessionId: 'session-main', type: 'checkpoint_created', timestamp: iso(1000), checkpointId: 'checkpoint-1', title: 'Before UI shell changes' },
    { id: 'evt-002', sessionId: 'session-main', type: 'message_delta', timestamp: iso(2000), role: 'assistant', content: 'I will build this as a workbench, not a chat page. ' },
    { id: 'evt-003', sessionId: 'session-main', type: 'message_delta', timestamp: iso(2600), role: 'assistant', content: 'First I am separating the mock adapter from the component tree, ' },
    { id: 'evt-004', sessionId: 'session-main', type: 'message_delta', timestamp: iso(3300), role: 'assistant', content: 'then the timeline can render commands, approvals, diffs, and errors as their own events.\n\n```tsx\n<AgentTimeline />\n```' },
    { id: 'evt-005', sessionId: 'session-main', type: 'reasoning_summary', timestamp: iso(4200), content: 'Visible summary: keep the first implementation isolated, use existing React/Vite/Tailwind, and leave the real SSE adapter for the next phase.' },
    { id: 'evt-006', sessionId: 'session-main', type: 'tool_call_started', timestamp: iso(5200), toolCallId: 'tool-scan', name: 'workspace.scan', input: { root: 'E:\\ox', include: ['apps/web', 'packages/shared'] } },
    { id: 'evt-007', sessionId: 'session-main', type: 'tool_call_completed', timestamp: iso(7600), toolCallId: 'tool-scan', name: 'workspace.scan', output: { filesRead: 18, frontendStack: ['React', 'Vite', 'Tailwind CSS'] }, status: 'success' },
    { id: 'evt-008', sessionId: 'session-main', type: 'command_started', timestamp: iso(9000), commandId: 'cmd-typecheck', cwd: 'E:\\ox', command: 'pnpm typecheck:web', riskLevel: 'safe' },
    { id: 'evt-009', sessionId: 'session-main', type: 'command_output', timestamp: iso(9800), commandId: 'cmd-typecheck', stream: 'stdout', content: '> @rac/web typecheck\n' },
    { id: 'evt-010', sessionId: 'session-main', type: 'command_output', timestamp: iso(10500), commandId: 'cmd-typecheck', stream: 'stdout', content: 'TypeScript project graph loaded.\n' },
    { id: 'evt-011', sessionId: 'session-main', type: 'command_output', timestamp: iso(11200), commandId: 'cmd-typecheck', stream: 'stderr', content: 'No type errors found in mock workbench modules.\n' },
    { id: 'evt-012', sessionId: 'session-main', type: 'command_completed', timestamp: iso(12100), commandId: 'cmd-typecheck', exitCode: 0, durationMs: 3100 },
    { id: 'evt-012a', sessionId: 'session-main', type: 'command_started', timestamp: iso(12400), commandId: 'cmd-security', cwd: 'E:\\ox', command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "pnpm test:security-hardening"', riskLevel: 'safe' },
    { id: 'evt-012b', sessionId: 'session-main', type: 'command_output', timestamp: iso(13200), commandId: 'cmd-security', stream: 'stdout', content: '> remote-agent-console@0.1.0 test:security-hardening\n' },
    { id: 'evt-012c', sessionId: 'session-main', type: 'command_output', timestamp: iso(13600), commandId: 'cmd-security', stream: 'stderr', content: 'Error: expected authorization header to be redacted before export.\n' },
    { id: 'evt-012d', sessionId: 'session-main', type: 'command_completed', timestamp: iso(13900), commandId: 'cmd-security', exitCode: 1, durationMs: 1500 },
    {
      id: 'evt-013',
      sessionId: 'session-main',
      type: 'approval_required',
      timestamp: iso(14500),
      approvalId: 'approval-apply-patch',
      actionType: 'apply_patch',
      title: 'Apply v2 workbench patch',
      description: 'The agent wants to replace the /workbench page entry with a mock-driven Agent Workbench v2 shell.',
      payload: {
        files: ['apps/web/src/pages/AgentWorkbenchPage.tsx', 'apps/web/src/components/agent-workbench/workbench-v2/*'],
        risk: 'medium',
      },
    },
    { id: 'evt-014', sessionId: 'session-main', type: 'file_diff_created', timestamp: iso(16000), filePath: 'apps/web/src/components/agent-workbench/workbench-v2/AgentTimeline.tsx', changeType: 'added', patch: mainPatch },
    { id: 'evt-015', sessionId: 'session-main', type: 'error', timestamp: iso(18000), message: 'Mock adapter noticed a missing real history endpoint.', details: { nextStep: 'Implement agentEventNormalizer in phase 3', severity: 'non-blocking' } },
    { id: 'evt-016', sessionId: 'session-main', type: 'checkpoint_created', timestamp: iso(54000), checkpointId: 'checkpoint-2', title: 'Mock diff generated' },
  ],
  'session-completed': [
    { id: 'evt-c-001', sessionId: 'session-completed', type: 'message_delta', timestamp: iso(-252000), role: 'assistant', content: 'Review complete. The command streaming card now separates stdout, stderr, exit code, and duration.' },
    { id: 'evt-c-002', sessionId: 'session-completed', type: 'command_started', timestamp: iso(-250000), commandId: 'cmd-build', cwd: 'E:\\ox', command: 'pnpm build:web', riskLevel: 'safe' },
    { id: 'evt-c-003', sessionId: 'session-completed', type: 'command_output', timestamp: iso(-249000), commandId: 'cmd-build', stream: 'stdout', content: 'vite v5.4.0 building for production...\n' },
    { id: 'evt-c-004', sessionId: 'session-completed', type: 'command_completed', timestamp: iso(-245000), commandId: 'cmd-build', exitCode: 0, durationMs: 5000 },
    { id: 'evt-c-005', sessionId: 'session-completed', type: 'patch_applied', timestamp: iso(-244500), filePaths: ['apps/web/src/components/agent-workbench/workbench-v2/OperationItemRow.tsx'] },
    { id: 'evt-c-006', sessionId: 'session-completed', type: 'session_completed', timestamp: iso(-244000), status: 'success' },
  ],
  'session-failed': [
    { id: 'evt-f-001', sessionId: 'session-failed', type: 'reasoning_summary', timestamp: iso(-481000), content: 'Visible summary: the setup script failure is outside the UI mock scope.' },
    { id: 'evt-f-result-001', sessionId: 'session-failed', type: 'message_delta', timestamp: iso(-480800), role: 'assistant', content: repeatedCommandResultPayload, messageKind: 'command_result' },
    { id: 'evt-f-result-002', sessionId: 'session-failed', type: 'message_delta', timestamp: iso(-480700), role: 'assistant', content: repeatedCommandResultPayload, messageKind: 'command_result' },
    { id: 'evt-f-result-003', sessionId: 'session-failed', type: 'message_delta', timestamp: iso(-480600), role: 'assistant', content: repeatedCommandResultPayload, messageKind: 'command_result' },
    { id: 'evt-f-002', sessionId: 'session-failed', type: 'error', timestamp: iso(-480000), message: 'Setup script returned exit code 1.', details: { script: 'scripts/setup.ps1', exitCode: 1 } },
    { id: 'evt-f-003', sessionId: 'session-failed', type: 'session_completed', timestamp: iso(-479500), status: 'failed' },
  ],
};

function commandFromEvents(sessionId: string, commandId: string): WorkbenchCommand | undefined {
  const events = eventsBySession[sessionId] ?? [];
  const started = events.find((event): event is Extract<AgentEvent, { type: 'command_started' }> => event.type === 'command_started' && event.commandId === commandId);
  if (!started) return undefined;
  const completed = events.find((event): event is Extract<AgentEvent, { type: 'command_completed' }> => event.type === 'command_completed' && event.commandId === commandId);
  const outputs = events.filter((event): event is Extract<AgentEvent, { type: 'command_output' }> => event.type === 'command_output' && event.commandId === commandId);
  return {
    id: `command-${commandId}`,
    commandId,
    sessionId,
    command: started.command,
    cwd: started.cwd,
    riskLevel: started.riskLevel,
    startedAt: started.timestamp,
    finishedAt: completed?.timestamp,
    stdout: outputs.filter((event) => event.stream === 'stdout').map((event) => event.content).join(''),
    stderr: outputs.filter((event) => event.stream === 'stderr').map((event) => event.content).join(''),
    exitCode: completed?.exitCode,
    durationMs: completed?.durationMs,
  };
}

function countPatchLines(patch: string): { insertions: number; deletions: number } {
  return patch.split('\n').reduce(
    (counts, line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) counts.insertions += 1;
      if (line.startsWith('-') && !line.startsWith('---')) counts.deletions += 1;
      return counts;
    },
    { insertions: 0, deletions: 0 },
  );
}

function mockSessionDiff(sessionId: string): WorkbenchDiff {
  const files = (eventsBySession[sessionId] ?? [])
    .filter((event): event is Extract<AgentEvent, { type: 'file_diff_created' }> => event.type === 'file_diff_created')
    .map((event) => {
      const patch = event.patch ?? '';
      return {
        filePath: event.filePath,
        changeType: event.changeType,
        patch,
        ...countPatchLines(patch),
      };
    });
  const totals = files.reduce(
    (counts, file) => {
      counts.insertions += file.insertions ?? 0;
      counts.deletions += file.deletions ?? 0;
      return counts;
    },
    { insertions: 0, deletions: 0 },
  );
  return {
    sessionId,
    files,
    patchText: files.map((file) => file.patch).filter(Boolean).join('\n\n'),
    ...totals,
  };
}

function contentFromPatch(patch: string): string {
  return patch
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

function mockFileContent(sessionId: string, filePath: string): WorkbenchFileContent {
  const diff = mockSessionDiff(sessionId);
  const file = diff.files.find((entry) => entry.filePath === filePath);
  if (!file) {
    throw new Error(en.workbench.v2.fileContentChangedOnly);
  }
  if (file.changeType === 'deleted') {
    return {
      path: filePath,
      exists: false,
      content: '',
      sizeBytes: 0,
      truncated: false,
      binary: false,
    };
  }
  const content = contentFromPatch(file.patch);
  return {
    path: filePath,
    exists: true,
    content,
    sizeBytes: content.length,
    truncated: false,
    binary: false,
    updatedAt: new Date().toISOString(),
  };
}

export const mockAgentWorkbenchApi: AgentWorkbenchApi = {
  async listSlashCommands() {
    return clone(slashCommands);
  },

  async listSessions() {
    return clone(sessions);
  },

  async createSession(input: CreateWorkbenchSessionInput) {
    const now = new Date().toISOString();
    const mode = input.mode ?? 'agent';
    const session: WorkbenchSession = {
      id: `session-local-${Date.now()}`,
      title: input.prompt ? input.prompt.slice(0, 48) : '',
      projectPath: input.projectPath,
      status: 'idle',
      model: input.model ?? 'gpt-5.3-codex',
      provider: input.provider ?? 'mock',
      deviceId: input.deviceId ?? 'mock-device-1',
      reasoningEffort: input.reasoningEffort,
      mode,
      permissionMode: mode === 'plan' || mode === 'review' ? 'read-only' : input.permissionMode ?? 'default',
      runtimeOptions: input.runtimeOptions,
      updatedAt: now,
      checkpoints: [],
    };
    sessions.unshift(session);
    eventsBySession[session.id] = [];
    return clone(session);
  },

  async cancelSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const now = new Date().toISOString();
    session.status = 'cancelled';
    session.updatedAt = now;
    eventsBySession[sessionId] = [
      ...(eventsBySession[sessionId] ?? []).filter((event) => event.type !== 'session_completed'),
      {
        id: `cancelled-${sessionId}`,
        sessionId,
        type: 'session_completed',
        timestamp: now,
        status: 'cancelled',
      },
    ];
    return clone(session);
  },

  async getSessionEvents(sessionId: string) {
    return clone(eventsBySession[sessionId] ?? []);
  },

  streamSessionEvents(sessionId, handlers) {
    handlers.onOpen?.();
    const timers = (eventsBySession[sessionId] ?? []).map((event, index) =>
      window.setTimeout(() => {
        handlers.onEvent(clone(event));
        if (event.type === 'file_diff_created') {
          handlers.onDiffUpdate?.(clone(mockSessionDiff(sessionId)));
        }
      }, 80 * (index + 1)),
    );
    const closeTimer = window.setTimeout(() => handlers.onClose?.(), 80 * ((eventsBySession[sessionId]?.length ?? 0) + 1));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(closeTimer);
    };
  },

  async approveAction(sessionId: string, approvalId: string) {
    return {
      id: `approval-resolved-${approvalId}`,
      sessionId,
      type: 'approval_resolved' as const,
      timestamp: new Date().toISOString(),
      approvalId,
      decision: 'approved' as const,
      reason: 'Approved locally in the mock adapter.',
    };
  },

  async rejectAction(sessionId: string, approvalId: string) {
    return {
      id: `approval-resolved-${approvalId}`,
      sessionId,
      type: 'approval_resolved' as const,
      timestamp: new Date().toISOString(),
      approvalId,
      decision: 'rejected' as const,
      reason: 'Rejected locally in the mock adapter.',
    };
  },

  async getSessionCommands(sessionId: string) {
    const ids = new Set(
      (eventsBySession[sessionId] ?? [])
        .filter((event): event is Extract<AgentEvent, { type: 'command_started' }> => event.type === 'command_started')
        .map((event) => event.commandId),
    );
    return clone(Array.from(ids).map((id) => commandFromEvents(sessionId, id)).filter((command): command is WorkbenchCommand => Boolean(command)));
  },

  async getSessionLogs(sessionId: string) {
    const logs: WorkbenchLog[] = (eventsBySession[sessionId] ?? []).map((event) => ({
      id: `log-${event.id}`,
      sessionId,
      timestamp: event.timestamp,
      level: event.type === 'error' ? 'error' : event.type === 'approval_required' ? 'warning' : 'info',
      message: `${event.type}: ${'message' in event ? event.message : 'content' in event ? event.content : event.id}`,
    }));
    return clone(logs);
  },

  async getSessionDiff(sessionId: string) {
    return clone(mockSessionDiff(sessionId));
  },

  async refreshSessionDiff(sessionId: string) {
    return clone(mockSessionDiff(sessionId));
  },

  async getSessionFileContent(sessionId: string, filePath: string) {
    return clone(mockFileContent(sessionId, filePath));
  },

  async openFile() {
    return undefined;
  },

  async discardFile(sessionId: string, filePath: string) {
    eventsBySession[sessionId] = (eventsBySession[sessionId] ?? []).filter((event) =>
      event.type !== 'file_diff_created' || event.filePath !== filePath,
    );
    return clone(mockSessionDiff(sessionId));
  },

  async discardAll(sessionId: string) {
    eventsBySession[sessionId] = (eventsBySession[sessionId] ?? []).filter((event) => event.type !== 'file_diff_created');
    return clone(mockSessionDiff(sessionId));
  },

  async listDevices() {
    return clone(devices);
  },

  async listExecutors() {
    return clone(executors);
  },

  async listModels(executorType?: string) {
    const scoped = executorType ? models.filter((model) => model.executorTypes.includes(executorType)) : models;
    return clone(scoped);
  },

  async switchModel(sessionId: string, modelId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.model = modelId;
    session.updatedAt = new Date().toISOString();
    return clone(session);
  },

  async switchReasoningEffort(sessionId: string, effort) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.reasoningEffort = effort;
    session.updatedAt = new Date().toISOString();
    return clone(session);
  },

  async switchPermissionMode(sessionId: string, permissionMode) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.permissionMode = session.mode === 'plan' || session.mode === 'review' ? 'read-only' : permissionMode;
    session.updatedAt = new Date().toISOString();
    return clone(session);
  },

  async switchRuntimeOptions(sessionId: string, runtimeOptions) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.runtimeOptions = runtimeOptions;
    session.updatedAt = new Date().toISOString();
    return clone(session);
  },

  async getWorktreeStatus(projectPath: string): Promise<WorkbenchWorktreeStatus> {
    return {
      cwd: projectPath,
      isGitRepository: true,
      dirty: projectPath.includes('dirty'),
      trackedFiles: projectPath.includes('dirty') ? ['apps/web/src/pages/AgentWorkbenchPage.tsx'] : [],
      untrackedFiles: [],
      statusText: projectPath.includes('dirty') ? 'M apps/web/src/pages/AgentWorkbenchPage.tsx' : '',
      warning: projectPath.includes('dirty') ? 'Mock dirty worktree detected.' : undefined,
    };
  },

  async listPermissionRules() {
    return clone(permissionRules);
  },

  async createPermissionRule(input: WorkbenchPermissionRuleInput) {
    const rule: WorkbenchPermissionRule = {
      ...input,
      id: `rule-${Date.now()}`,
    };
    permissionRules.push(rule);
    return clone(rule);
  },

  async updatePermissionRule(id: string, input: Partial<WorkbenchPermissionRuleInput>) {
    const index = permissionRules.findIndex((rule) => rule.id === id);
    if (index === -1) throw new Error(`Permission rule not found: ${id}`);
    permissionRules[index] = { ...permissionRules[index], ...input };
    return clone(permissionRules[index]);
  },

  async deletePermissionRule(id: string) {
    const index = permissionRules.findIndex((rule) => rule.id === id);
    if (index >= 0) permissionRules.splice(index, 1);
  },

  async listPermissionHits(limit = 200) {
    return clone(permissionHits.slice(0, limit));
  },

  async getSessionSummaries(sessionId: string) {
    return clone(summariesBySession[sessionId] ?? []);
  },

  async compactSession(sessionId: string) {
    const summary: WorkbenchContextSummary = {
      id: `summary-${Date.now()}`,
      summary: 'Mock compact summary saved from the current Agent Workbench context.',
      createdAt: new Date().toISOString(),
      injectedIntoProvider: false,
      usedInResume: false,
    };
    summariesBySession[sessionId] = [summary, ...(summariesBySession[sessionId] ?? [])];
    return clone(summary);
  },

  async getSessionUsage(sessionId: string) {
    return clone(usageBySession[sessionId] ?? null);
  },

  async exportSessionMarkdown(sessionId: string, options) {
    return {
      filename: `${sessionId}.md`,
      markdown: [
        `# ${sessions.find((session) => session.id === sessionId)?.title ?? sessionId}`,
        '',
        `includeDiff: ${options.includeDiff}`,
        `includeRawLogs: ${options.includeRawLogs}`,
      ].join('\n'),
    };
  },

  async getInitClaudePlan(sessionId: string): Promise<WorkbenchInitPlan> {
    return {
      sessionId,
      projectPath: sessions.find((session) => session.id === sessionId)?.projectPath ?? 'E:\\ox',
      status: 'planned',
      files: [
        { path: 'CLAUDE.md', action: 'create', reason: 'No project instructions file was found.' },
        { path: '.claude/settings.json', action: 'skip', reason: 'Settings already exist.' },
      ],
    };
  },

  async applyInitClaudePlan(sessionId: string): Promise<WorkbenchInitPlan> {
    return {
      sessionId,
      projectPath: sessions.find((session) => session.id === sessionId)?.projectPath ?? 'E:\\ox',
      status: 'waiting_approval',
      files: [
        { path: 'CLAUDE.md', action: 'create', reason: 'Approval required before writing project instructions.' },
      ],
    };
  },

  async executeSlashCommand(sessionId: string, input: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const now = new Date().toISOString();
    const [command = '', ...args] = input.trim().split(/\s+/);
    const name = command.replace(/^\//, '').toLowerCase();
    const localName = name.startsWith('wb:') ? name.slice(3) : name;
    const arg = args.join(' ');

    if (localName === 'model' && args.length > 0) {
      const effortValues = new Set(['default', 'auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
      const [modelOrEffort, maybeEffort] = args;
      if (modelOrEffort && effortValues.has(modelOrEffort)) {
        session.reasoningEffort = ['default', 'auto', 'none'].includes(modelOrEffort) ? undefined : modelOrEffort as WorkbenchSession['reasoningEffort'];
      } else if (modelOrEffort) {
        session.model = modelOrEffort;
      }
      if (maybeEffort) {
        session.reasoningEffort = ['default', 'auto', 'none'].includes(maybeEffort) ? undefined : maybeEffort as WorkbenchSession['reasoningEffort'];
      }
      session.updatedAt = now;
    }

    if (localName === 'permissions' && arg) {
      const normalized = normalizePermissionArgument(arg);
      if (!normalized) throw new Error('Usage: /wb:permissions [read-only|default|auto-review|full-access]');
      session.permissionMode = session.mode === 'plan' || session.mode === 'review' ? 'read-only' : normalized;
      session.updatedAt = now;
    }

    if (localName === 'fast') {
      const fastArg = arg.toLowerCase();
      const enable = fastArg
        ? fastArg === 'on' || fastArg === 'enable' || fastArg === 'enabled' || fastArg === 'true'
        : session.runtimeOptions?.serviceTier !== 'fast';
      const disable = fastArg
        ? fastArg === 'off' || fastArg === 'disable' || fastArg === 'disabled' || fastArg === 'false'
        : !enable;
      if (fastArg && !enable && !disable && fastArg !== 'status') throw new Error('Usage: /wb:fast [on|off|status]');
      if (enable) {
        session.runtimeOptions = { ...(session.runtimeOptions ?? {}), serviceTier: 'fast' };
        session.updatedAt = now;
      } else if (disable) {
        const rest = Object.fromEntries(
          Object.entries(session.runtimeOptions ?? {}).filter(([key]) => key !== 'serviceTier'),
        ) as NonNullable<WorkbenchSession['runtimeOptions']>;
        session.runtimeOptions = Object.keys(rest).length ? rest : undefined;
        session.updatedAt = now;
      }
    }

    const event: AgentEvent = localName === 'checkpoint'
      ? {
          id: `mock-checkpoint-${Date.now()}`,
          sessionId,
          type: 'checkpoint_created',
          timestamp: now,
          checkpointId: `mock-provider-checkpoint-${Date.now()}`,
          title: arg || 'Mock provider checkpoint',
        }
      : localName === 'status'
      ? {
          id: `mock-command-${Date.now()}`,
          sessionId,
          type: 'message_delta',
          timestamp: now,
          role: 'assistant',
          content: [
            `Status: ${session.status}`,
            `Provider: ${session.provider ?? 'mock'}`,
            `Model: ${session.model}`,
            `Permissions: ${session.permissionMode}`,
            `Fast mode: ${session.runtimeOptions?.serviceTier === 'fast' ? 'on' : 'off'}`,
          ].join('\n'),
          messageKind: 'command_result',
        }
      : localName === 'fast'
      ? {
          id: `mock-command-${Date.now()}`,
          sessionId,
          type: 'message_delta',
          timestamp: now,
          role: 'assistant',
          content: `Fast mode: ${session.runtimeOptions?.serviceTier === 'fast' ? 'on' : 'off'}.`,
          messageKind: 'command_result',
        }
      : localName === 'permissions'
      ? {
          id: `mock-command-${Date.now()}`,
          sessionId,
          type: 'message_delta',
          timestamp: now,
          role: 'assistant',
          content: `Current permissions: ${session.permissionMode}.`,
          messageKind: 'command_result',
        }
      : localName === 'model'
      ? {
          id: `mock-command-${Date.now()}`,
          sessionId,
          type: 'message_delta',
          timestamp: now,
          role: 'assistant',
          content: `Current model: ${session.model}\nCurrent reasoning effort: ${session.reasoningEffort ?? 'executor default'}`,
          messageKind: 'command_result',
        }
      : {
          id: `mock-command-${Date.now()}`,
          sessionId,
          type: 'message_delta',
          timestamp: now,
          role: 'assistant',
          content: `Mock command result for ${input}`,
          messageKind: 'command_result',
        };
    eventsBySession[sessionId] = [...(eventsBySession[sessionId] ?? []), event];
    return { session: clone(session), event: clone(event) };
  },

};
