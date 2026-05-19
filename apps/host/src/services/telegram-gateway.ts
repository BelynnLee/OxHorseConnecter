import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Bot, InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { v4 as uuid } from 'uuid';
import { createLogger } from '@rac/logger';
import type {
  AgentMode,
  ExecutorType,
  SessionMessage,
  SessionStreamEvent,
  TelegramChatType,
  TelegramMediaAttachment,
  TelegramMediaKind,
  TelegramSource,
} from '@rac/shared';
import type {
  TelegramBindingScope,
  TelegramChatSettings,
  TelegramRepository,
} from '@rac/storage';
import type { SessionService } from './session-service.js';
import type { AgentSessionRunService } from './agent-session-run-service.js';
import {
  chunkTelegramText,
  escapeMarkdownV2,
  isRootThreadKey,
  normalizeTelegramCommand,
  stripBotMention,
  telegramActor,
  threadKeyFromId,
} from './telegram-utils.js';

const log = createLogger('telegram-gateway');
const CALLBACK_PREFIX = 'tg:';
const CALLBACK_TTL_MS = 24 * 60 * 60 * 1000;
const LOCK_TTL_MS = 45_000;
const TEXT_DOCUMENT_LIMIT_BYTES = 100 * 1024;
const MEDIA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TELEGRAM_COMMANDS = [
  { command: 'start', description: 'Start using ox from Telegram' },
  { command: 'help', description: 'Show Telegram commands' },
  { command: 'new', description: 'Start a new session lane' },
  { command: 'sessions', description: 'List Telegram-bound sessions' },
  { command: 'resume', description: 'Bind this chat to a session id' },
  { command: 'status', description: 'Show current session status' },
  { command: 'stop', description: 'Stop the current run' },
  { command: 'model', description: 'Show or switch model' },
  { command: 'models', description: 'List models' },
  { command: 'effort', description: 'Change reasoning effort' },
  { command: 'agent', description: 'Use agent mode' },
  { command: 'plan', description: 'Use plan mode' },
  { command: 'review', description: 'Use review mode' },
  { command: 'diff', description: 'Show diff status' },
  { command: 'export', description: 'Show export URL' },
  { command: 'topic', description: 'Manage topic session lanes' },
  { command: 'permissions', description: 'Show or switch permissions' },
  { command: 'codex', description: 'Use Codex for new sessions' },
  { command: 'claude', description: 'Use Claude Code for new sessions' },
];

interface TelegramGatewayConfig {
  enabled: boolean;
  mode: 'auto' | 'polling' | 'webhook';
  webhookUrl?: string;
  allowAllUsers: boolean;
  allowedUsers: string[];
  allowedGroupChats: string[];
  requireMention: boolean;
  defaultDeviceId: string;
  defaultProjectId?: string;
  defaultProjectPath?: string;
  defaultExecutor: Extract<ExecutorType, 'codex' | 'claude-code' | 'mock' | 'custom-command'>;
  defaultMode: AgentMode;
  defaultPermissionMode: 'read-only' | 'default' | 'auto-review' | 'full-access';
  streamingEnabled: boolean;
  streamEditIntervalMs: number;
  cacheDir: string;
  mediaMaxBytes: number;
}

interface TelegramGatewayOptions {
  botToken?: string;
  webhookSecret?: string;
  publicBaseUrl: string;
  hostDeviceId: string;
  config: TelegramGatewayConfig;
}

interface LooseTelegramUser {
  id?: number;
  username?: string;
  first_name?: string;
}

interface LooseTelegramChat {
  id: number | string;
  type: TelegramChatType | string;
}

interface LooseTelegramFileRef {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
  file_name?: string;
  mime_type?: string;
  emoji?: string;
  set_name?: string;
}

interface LooseTelegramMessage {
  message_id?: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  chat?: LooseTelegramChat;
  from?: LooseTelegramUser;
  reply_to_message?: { from?: LooseTelegramUser };
  photo?: LooseTelegramFileRef[];
  video?: LooseTelegramFileRef;
  audio?: LooseTelegramFileRef;
  voice?: LooseTelegramFileRef;
  document?: LooseTelegramFileRef;
  sticker?: LooseTelegramFileRef;
  media_group_id?: string;
}

interface PreparedMedia {
  fileType: TelegramMediaKind;
  telegramFileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  localPath?: string;
  sizeBytes?: number;
  promptText: string;
  metadata?: Record<string, unknown>;
}

interface TelegramDestination {
  chatId: string;
  threadKey: string;
}

interface TelegramStreamState {
  destination: TelegramDestination;
  telegramMessageId?: number;
  lastText: string;
  timer?: ReturnType<typeof setTimeout>;
  lastEditAt: number;
}

export class TelegramGateway {
  private readonly bot?: Bot;
  private readonly botKey?: string;
  private readonly ownerId = `${process.pid}-${randomBytes(6).toString('hex')}`;
  private botId?: number;
  private botUsername?: string;
  private running = false;
  private pollingMode = false;
  private lockRenewTimer?: ReturnType<typeof setInterval>;
  private pollingPromise?: Promise<void>;
  private readonly sessionSubscriptions = new Map<string, () => void>();
  private readonly sessionDestinations = new Map<string, TelegramDestination>();
  private readonly streamStates = new Map<string, TelegramStreamState>();

  constructor(
    private readonly repo: TelegramRepository,
    private readonly sessionService: SessionService,
    private readonly runService: AgentSessionRunService,
    private readonly options: TelegramGatewayOptions,
  ) {
    if (options.botToken) {
      this.bot = new Bot(options.botToken);
      this.botKey = createHash('sha256').update(options.botToken).digest('hex').slice(0, 24);
      this.registerHandlers();
    }
  }

  isEnabled(): boolean {
    return this.options.config.enabled;
  }

  status(): Record<string, unknown> {
    return {
      enabled: this.options.config.enabled,
      configured: Boolean(this.bot),
      running: this.running,
      mode: this.pollingMode ? 'polling' : this.effectiveMode(),
      botUsername: this.botUsername,
      webhookUrl: this.options.config.webhookUrl,
    };
  }

  async start(): Promise<void> {
    if (!this.options.config.enabled) {
      log.info('Telegram gateway disabled');
      return;
    }
    if (!this.bot || !this.botKey) {
      log.warn('TELEGRAM_GATEWAY_ENABLED=true but TELEGRAM_BOT_TOKEN is not configured');
      return;
    }

    const me = await this.bot.api.getMe();
    this.botId = me.id;
    this.botUsername = me.username;
    await this.bot.api.setMyCommands(TELEGRAM_COMMANDS);
    this.repo.deleteExpiredCallbackTokens();
    void this.pruneMediaCache().catch((err) => {
      log.warn({ err }, 'Telegram media cache cleanup failed');
    });

    const mode = this.effectiveMode();
    if (mode === 'webhook') {
      if (!this.options.config.webhookUrl) {
        log.warn('Telegram webhook mode requested but TELEGRAM_WEBHOOK_URL is not configured');
        return;
      }
      if (!this.options.webhookSecret) {
        log.warn('Telegram webhook mode requested but TELEGRAM_WEBHOOK_SECRET is not configured');
        return;
      }
      await this.bot.api.setWebhook(this.options.config.webhookUrl, {
        secret_token: this.options.webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      });
      this.running = true;
      log.info({ bot: this.botUsername }, 'Telegram webhook gateway ready');
      return;
    }

    const lockName = `telegram:${this.botKey}:polling`;
    const locked = this.repo.acquireGatewayLock({
      name: lockName,
      keyHash: this.botKey,
      ownerId: this.ownerId,
      ttlMs: LOCK_TTL_MS,
    });
    if (!locked) {
      log.warn('Another host owns the Telegram polling lock; gateway not started here');
      return;
    }
    this.lockRenewTimer = setInterval(() => {
      const ok = this.repo.renewGatewayLock({
        name: lockName,
        ownerId: this.ownerId,
        ttlMs: LOCK_TTL_MS,
      });
      if (!ok) {
        log.warn('Lost Telegram polling lock; stopping gateway polling');
        void this.stop();
      }
    }, Math.floor(LOCK_TTL_MS / 2));
    this.lockRenewTimer.unref();

    await this.bot.api.deleteWebhook({ drop_pending_updates: false });
    this.running = true;
    this.pollingMode = true;
    this.pollingPromise = this.bot
      .start({ allowed_updates: ['message', 'callback_query'] })
      .catch((err) => {
        this.running = false;
        log.warn({ err }, 'Telegram polling stopped with an error');
      });
    log.info({ bot: this.botUsername }, 'Telegram polling gateway started');
  }

  async stop(): Promise<void> {
    if (this.lockRenewTimer) {
      clearInterval(this.lockRenewTimer);
      this.lockRenewTimer = undefined;
    }
    if (this.pollingMode && this.bot?.isRunning()) {
      await this.bot.stop();
    }
    if (this.pollingMode && this.botKey) {
      this.repo.releaseGatewayLock(`telegram:${this.botKey}:polling`, this.ownerId);
    }
    for (const unsubscribe of this.sessionSubscriptions.values()) {
      unsubscribe();
    }
    this.sessionSubscriptions.clear();
    this.sessionDestinations.clear();
    for (const state of this.streamStates.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
    }
    this.streamStates.clear();
    this.running = false;
  }

  async handleWebhook(req: {
    get(name: string): string | undefined;
    query: Record<string, unknown>;
    body: unknown;
  }): Promise<void> {
    if (!this.bot || !this.options.config.enabled) {
      return;
    }
    const providedSecret =
      req.get('x-telegram-bot-api-secret-token') ||
      (typeof req.query.secret === 'string' ? req.query.secret : undefined);
    if (this.options.webhookSecret && providedSecret !== this.options.webhookSecret) {
      throw new Error('Invalid Telegram webhook secret');
    }
    await this.bot.handleUpdate(req.body as Parameters<Bot['handleUpdate']>[0]);
  }

  private effectiveMode(): 'polling' | 'webhook' {
    if (this.options.config.mode === 'webhook') return 'webhook';
    if (this.options.config.mode === 'polling') return 'polling';
    return this.options.config.webhookUrl ? 'webhook' : 'polling';
  }

  private registerHandlers(): void {
    if (!this.bot || !this.botKey) return;

    this.bot.use(async (ctx, next) => {
      const updateId = typeof ctx.update.update_id === 'number' ? ctx.update.update_id : undefined;
      const lastUpdateId = this.repo.getLastUpdateId(this.botKey!);
      if (updateId !== undefined && lastUpdateId !== undefined && updateId <= lastUpdateId) {
        return;
      }
      await next();
      if (updateId !== undefined) {
        this.repo.setLastUpdateId(this.botKey!, updateId);
      }
    });
    this.bot.on('callback_query:data', (ctx) => this.handleCallback(ctx));
    this.bot.on('message', (ctx) => this.handleMessage(ctx));
    this.bot.catch((error) => {
      log.warn({ err: error.error }, 'Telegram update handler failed');
    });
  }

  private async handleCallback(ctx: Context): Promise<void> {
    const callback = ctx.callbackQuery;
    const data = callback?.data;
    if (!callback || !data?.startsWith(CALLBACK_PREFIX)) {
      return;
    }
    const tokenValue = data.slice(CALLBACK_PREFIX.length);
    const token = this.repo.findCallbackToken(tokenValue);
    if (!token) {
      await this.answerCallback(ctx, 'This action is no longer available.');
      return;
    }
    if (token.resolvedAt) {
      await this.answerCallback(ctx, 'This action was already handled.');
      return;
    }
    if (Date.parse(token.expiresAt) < Date.now()) {
      await this.answerCallback(ctx, 'This action expired.');
      return;
    }
    const fromId = callback.from?.id ? String(callback.from.id) : undefined;
    const chatId = callback.message?.chat?.id ? String(callback.message.chat.id) : token.chatId;
    if (chatId !== token.chatId || (token.userId && fromId !== token.userId)) {
      await this.answerCallback(ctx, 'This button belongs to another Telegram session.');
      return;
    }
    if (token.kind !== 'approval' || !token.sessionId || !token.approvalId) {
      await this.answerCallback(ctx, 'Unsupported Telegram action.');
      return;
    }

    const approved = token.action === 'approve';
    try {
      const approval = this.sessionService.resolveApproval(
        token.sessionId,
        token.approvalId,
        approved,
        fromId ? `telegram:${fromId}` : 'telegram',
      );
      this.repo.resolveCallbackToken(token.token);
      await this.answerCallback(ctx, approved ? 'Approved.' : 'Rejected.');
      await this.editCallbackMessage(
        ctx,
        `Approval ${approval.status}. ${approval.reason}`.trim(),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resolve approval.';
      await this.answerCallback(ctx, message);
    }
  }

  private async handleMessage(ctx: Context): Promise<void> {
    const message = ctx.message as LooseTelegramMessage | undefined;
    const source = this.sourceFromMessage(message);
    if (!message || !source) {
      return;
    }
    const rawText = message.text ?? message.caption ?? '';
    const command = normalizeTelegramCommand(rawText);
    if (!this.isAuthorized(source)) {
      if (source.chatType === 'private') {
        await this.sendText(source, 'This Telegram user is not allowed to use this ox gateway.');
      }
      return;
    }
    if (source.isGroupLike && !this.isMessageAddressedToBot(message, rawText)) {
      return;
    }

    if (command) {
      await this.handleCommand(source, command.name, command.args, message);
      return;
    }

    const settings = this.getChatSettings(source);
    if (settings?.topicModeEnabled && source.isRootThread) {
      await this.sendText(
        source,
        'Topic mode is enabled. Open or create a Telegram topic and send your prompt there. Use /topic off to return to single-session mode.',
      );
      return;
    }

    const prompt = stripBotMention(rawText, this.botUsername);
    const media = await this.prepareMedia(message);
    const mediaPrompt = media.map((item) => item.promptText).filter(Boolean).join('\n\n');
    const finalPrompt = [prompt, mediaPrompt].filter(Boolean).join('\n\n').trim();
    if (!finalPrompt) {
      await this.sendText(source, 'Send a text prompt, caption, or supported file.');
      return;
    }
    await this.runPrompt(source, finalPrompt, media, settings);
  }

  private async handleCommand(
    source: TelegramSource,
    name: string,
    args: string,
    message: LooseTelegramMessage,
  ): Promise<void> {
    switch (name) {
      case 'start':
      case 'help':
        await this.sendText(source, this.helpText());
        return;
      case 'topic':
        await this.handleTopicCommand(source, args);
        return;
      case 'sessions':
        await this.handleSessionsCommand(source);
        return;
      case 'resume':
        await this.handleResumeCommand(source, args);
        return;
      case 'new':
        await this.handleNewCommand(source, args, message);
        return;
      case 'codex':
        await this.setDefaultExecutor(source, 'codex');
        return;
      case 'claude':
        await this.setDefaultExecutor(source, 'claude-code');
        return;
      case 'agent':
      case 'plan':
      case 'review':
        await this.handleModeCommand(source, name, args);
        return;
      case 'status':
      case 'stop':
      case 'model':
      case 'models':
      case 'effort':
      case 'diff':
      case 'export':
      case 'permissions':
        await this.handleSessionCommand(source, name, args);
        return;
      default:
        await this.sendText(source, `Unknown command /${name}. Use /help.`);
    }
  }

  private async handleTopicCommand(source: TelegramSource, args: string): Promise<void> {
    const normalized = args.trim();
    if (normalized === 'help') {
      await this.sendText(
        source,
        [
          '/topic - enable per-topic session lanes.',
          '/topic off - disable topic mode for this Telegram chat.',
          '/topic <session_id> - bind the current topic to an existing session you own.',
          'Root/General stays as a lobby while topic mode is enabled.',
        ].join('\n'),
      );
      return;
    }
    const scope = this.chatSettingsScope(source);
    if (normalized === 'off') {
      this.repo.setTopicMode({ id: uuid(), ...scope }, false);
      this.repo.deleteBindingsForChat(scope);
      await this.sendText(source, 'Topic mode disabled. The next prompt starts a fresh single-session lane.');
      return;
    }
    if (normalized) {
      await this.handleResumeCommand(source, normalized);
      return;
    }
    this.repo.setTopicMode({ id: uuid(), ...scope }, true);
    await this.sendText(
      source,
      'Topic mode enabled. Root/General is now the lobby; send prompts inside Telegram topics to create independent session lanes.',
    );
  }

  private async handleSessionsCommand(source: TelegramSource): Promise<void> {
    const settings = this.getChatSettings(source);
    const scope = this.bindingScope(source, settings?.topicModeEnabled ?? false);
    const bindings = this.repo.listBindings({
      chatId: scope.chatId,
      chatType: scope.chatType,
      userId: scope.userId,
    });
    if (bindings.length === 0) {
      await this.sendText(source, 'No Telegram-bound ox sessions yet.');
      return;
    }
    await this.sendText(
      source,
      bindings
        .slice(0, 12)
        .map((binding) => {
          const session = this.sessionService.getSession(binding.sessionId);
          return `${binding.threadKey || 'main'}: ${binding.sessionId} - ${session?.title ?? 'missing session'} (${session?.status ?? 'unknown'})`;
        })
        .join('\n'),
    );
  }

  private async handleResumeCommand(source: TelegramSource, args: string): Promise<void> {
    const sessionId = args.trim();
    if (!sessionId) {
      await this.sendText(source, 'Usage: /resume <session_id>');
      return;
    }
    const session = this.sessionService.getSession(sessionId);
    if (!session) {
      await this.sendText(source, 'Session not found.');
      return;
    }
    const actor = telegramActor(source);
    const existing = this.repo.findBindingBySession(sessionId);
    if (session.createdBy !== actor && existing?.userId !== source.userId) {
      await this.sendText(source, 'That session is not owned by this Telegram user.');
      return;
    }
    const settings = this.getChatSettings(source);
    const scope = this.bindingScope(source, settings?.topicModeEnabled ?? false);
    const now = new Date().toISOString();
    this.repo.upsertBinding({
      id: uuid(),
      ...scope,
      threadKey: scope.threadKey ?? '',
      sessionId,
      topicMode: settings?.topicModeEnabled ?? false,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      metadata: { source: 'telegram', restored: true },
    });
    this.subscribeSession(sessionId, source);
    await this.sendText(source, `Bound this Telegram lane to session ${sessionId}.`);
  }

  private async handleNewCommand(
    source: TelegramSource,
    args: string,
    message: LooseTelegramMessage,
  ): Promise<void> {
    const settings = this.getChatSettings(source);
    const scope = this.bindingScope(source, settings?.topicModeEnabled ?? false);
    if (settings?.topicModeEnabled && source.isRootThread) {
      await this.sendText(source, 'Root/General is the topic lobby. Open a topic, then use /new there.');
      return;
    }
    this.repo.deleteBinding(scope);
    const prompt = args.trim();
    if (!prompt) {
      await this.sendText(source, 'Current Telegram lane was reset. Send the next prompt to start a new ox session.');
      return;
    }
    const media = await this.prepareMedia(message);
    await this.runPrompt(source, prompt, media, settings);
  }

  private async setDefaultExecutor(source: TelegramSource, executor: 'codex' | 'claude-code'): Promise<void> {
    const scope = this.chatSettingsScope(source);
    const existing = this.repo.findChatSettings(scope);
    const now = new Date().toISOString();
    this.repo.upsertChatSettings({
      id: existing?.id ?? uuid(),
      ...scope,
      topicModeEnabled: existing?.topicModeEnabled ?? false,
      defaultDeviceId: existing?.defaultDeviceId,
      defaultProjectId: existing?.defaultProjectId,
      defaultProjectPath: existing?.defaultProjectPath,
      defaultExecutor: executor,
      defaultMode: existing?.defaultMode,
      defaultPermissionMode: existing?.defaultPermissionMode,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await this.sendText(source, `New Telegram sessions will use ${executor}. Use /new to start one.`);
  }

  private async handleModeCommand(
    source: TelegramSource,
    name: string,
    args: string,
  ): Promise<void> {
    const mode = name as AgentMode;
    if (args.trim()) {
      await this.runPrompt(source, args.trim(), [], this.getChatSettings(source), mode);
      return;
    }
    const scope = this.chatSettingsScope(source);
    const existing = this.repo.findChatSettings(scope);
    const now = new Date().toISOString();
    this.repo.upsertChatSettings({
      id: existing?.id ?? uuid(),
      ...scope,
      topicModeEnabled: existing?.topicModeEnabled ?? false,
      defaultDeviceId: existing?.defaultDeviceId,
      defaultProjectId: existing?.defaultProjectId,
      defaultProjectPath: existing?.defaultProjectPath,
      defaultExecutor: existing?.defaultExecutor,
      defaultMode: mode,
      defaultPermissionMode: existing?.defaultPermissionMode,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await this.sendText(source, `New Telegram sessions will use ${mode} mode.`);
  }

  private async handleSessionCommand(
    source: TelegramSource,
    name: string,
    args: string,
  ): Promise<void> {
    const settings = this.getChatSettings(source);
    const binding = this.repo.findBinding(this.bindingScope(source, settings?.topicModeEnabled ?? false));
    if (!binding) {
      await this.sendText(source, 'No session is bound to this Telegram lane yet.');
      return;
    }
    this.subscribeSession(binding.sessionId, source);
    const commandInput = this.toWorkbenchCommand(name, args);
    try {
      const result = await this.sessionService.executeCommand(
        binding.sessionId,
        commandInput,
        telegramActor(source),
      );
      if (result.message?.content) {
        await this.sendText(source, result.message.content);
      } else if (result.newSession) {
        await this.sendText(source, `Created session ${result.newSession.id}.`);
      }
    } catch (err) {
      await this.sendText(source, err instanceof Error ? err.message : 'Command failed.');
    }
  }

  private toWorkbenchCommand(name: string, args: string): string {
    if (name === 'effort') {
      return `/wb:model ${args}`.trim();
    }
    return `/wb:${name} ${args}`.trim();
  }

  private async runPrompt(
    source: TelegramSource,
    prompt: string,
    media: PreparedMedia[],
    settings?: TelegramChatSettings,
    overrideMode?: AgentMode,
  ): Promise<void> {
    const topicMode = settings?.topicModeEnabled ?? false;
    const scope = this.bindingScope(source, topicMode);
    const binding = this.repo.findBinding(scope);
    const actor = telegramActor(source);

    try {
      if (binding) {
        const session = this.sessionService.getSession(binding.sessionId);
        if (!session) {
          this.repo.deleteBinding(scope);
        } else if (session.status === 'running' || session.status === 'waiting_approval') {
          await this.sendText(
            source,
            `Session ${session.id} is ${session.status}. Use /status or /stop before sending another prompt.`,
          );
          return;
        } else {
          this.subscribeSession(session.id, source);
          const result = await this.runService.append(
            session.id,
            { content: prompt, mode: overrideMode ?? session.mode },
            actor,
          );
          await this.persistMedia(media, result.session.id);
          this.touchBinding(scope, result.session.id, topicMode);
          await this.sendText(source, `Queued in session ${result.session.id}.`);
          return;
        }
      }

      const result = await this.runService.start(
        {
          prompt,
          deviceId: this.defaultDeviceId(settings),
          projectId: settings?.defaultProjectId ?? this.options.config.defaultProjectId,
          projectPath: settings?.defaultProjectPath ?? this.options.config.defaultProjectPath,
          executorType: this.defaultExecutor(settings),
          mode: overrideMode ?? this.defaultMode(settings),
          permissionMode: this.defaultPermissionMode(settings),
          confirmDangerousSkip: this.defaultPermissionMode(settings) === 'full-access',
        },
        actor,
      );
      this.touchBinding(scope, result.session.id, topicMode);
      this.subscribeSession(result.session.id, source);
      await this.persistMedia(media, result.session.id);
      await this.sendText(source, `Started session ${result.session.id}.`);
    } catch (err) {
      await this.sendText(source, err instanceof Error ? err.message : 'Telegram prompt failed.');
    }
  }

  private touchBinding(
    scope: TelegramBindingScope,
    sessionId: string,
    topicMode: boolean,
  ): void {
    const now = new Date().toISOString();
    const existing = this.repo.findBinding(scope);
    this.repo.upsertBinding({
      id: existing?.id ?? uuid(),
      ...scope,
      threadKey: scope.threadKey ?? '',
      sessionId,
      topicMode,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastMessageAt: now,
      metadata: { source: 'telegram' },
    });
  }

  private subscribeSession(sessionId: string, source: TelegramSource): void {
    this.sessionDestinations.set(sessionId, { chatId: source.chatId, threadKey: source.threadKey });
    if (this.sessionSubscriptions.has(sessionId)) {
      return;
    }
    const unsubscribe = this.sessionService.subscribeSessionEvents(sessionId, (event) => {
      void this.renderSessionEvent(event);
    });
    this.sessionSubscriptions.set(sessionId, unsubscribe);
  }

  private async renderSessionEvent(event: SessionStreamEvent): Promise<void> {
    const destination = this.sessionDestinations.get(event.sessionId);
    if (!destination) {
      return;
    }
    const message = event.payload?.message as SessionMessage | undefined;
    if (event.eventType === 'approval.requested') {
      await this.sendApproval(destination, event);
      return;
    }
    if (event.eventType === 'message.delta' && this.options.config.streamingEnabled) {
      await this.renderStreamingDelta(event, destination);
      return;
    }
    if (event.eventType === 'approval.resolved' && message?.content) {
      await this.sendText(destination, message.content);
      return;
    }
    if (event.eventType === 'message.completed' && message?.content) {
      if (await this.finalizeStreamingMessage(event, destination, message.content)) {
        return;
      }
      await this.sendText(destination, message.content);
      return;
    }
    if (event.eventType === 'error') {
      const content =
        message?.content ??
        ((event.payload?.assistantMessage as SessionMessage | undefined)?.content || 'Session failed.');
      await this.sendText(destination, content);
      return;
    }
    if (event.eventType === 'session.interrupted' && message?.content) {
      await this.sendText(destination, message.content);
      return;
    }
    if (event.eventType === 'model.changed' && message?.content) {
      await this.sendText(destination, message.content);
    }
  }

  private async sendApproval(destination: TelegramDestination, event: SessionStreamEvent): Promise<void> {
    if (!this.bot) return;
    const approval = event.payload?.approval as
      | { id?: string; reason?: string; actionType?: string; riskLevel?: string; commandPreview?: string }
      | undefined;
    if (!approval?.id) {
      await this.sendText(destination, 'Approval requested.');
      return;
    }
    const binding = this.repo.findBindingBySession(event.sessionId);
    const chatId = binding?.chatId ?? destination.chatId;
    const userId = binding?.userId;
    const approveToken = this.createCallbackToken({
      chatId,
      userId,
      sessionId: event.sessionId,
      approvalId: approval.id,
      action: 'approve',
    });
    const rejectToken = this.createCallbackToken({
      chatId,
      userId,
      sessionId: event.sessionId,
      approvalId: approval.id,
      action: 'reject',
    });
    const text = [
      'Approval requested',
      approval.riskLevel ? `Risk: ${approval.riskLevel}` : undefined,
      approval.actionType ? `Action: ${approval.actionType}` : undefined,
      approval.reason,
      approval.commandPreview ? `Command: ${approval.commandPreview}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
    const keyboard = new InlineKeyboard()
      .text('Approve', `${CALLBACK_PREFIX}${approveToken}`)
      .text('Reject', `${CALLBACK_PREFIX}${rejectToken}`);
    await this.sendText(destination, text, { keyboard });
  }

  private createCallbackToken(input: {
    chatId: string;
    userId?: string;
    sessionId: string;
    approvalId: string;
    action: 'approve' | 'reject';
  }): string {
    const token = randomBytes(18).toString('base64url');
    const now = new Date();
    this.repo.createCallbackToken({
      token,
      kind: 'approval',
      chatId: input.chatId,
      userId: input.userId,
      sessionId: input.sessionId,
      approvalId: input.approvalId,
      action: input.action,
      expiresAt: new Date(now.getTime() + CALLBACK_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
    });
    return token;
  }

  private async sendText(
    destination: TelegramDestination | TelegramSource,
    text: string,
    options?: { keyboard?: InlineKeyboard },
  ): Promise<void> {
    if (!this.bot) return;
    for (const chunk of chunkTelegramText(text)) {
      await this.sendTelegramMessage(destination, chunk, options);
    }
  }

  private async sendTelegramMessage(
    destination: TelegramDestination | TelegramSource,
    text: string,
    options?: { keyboard?: InlineKeyboard },
  ): Promise<number | undefined> {
    if (!this.bot) return undefined;
    const baseOptions = {
      message_thread_id: this.threadIdForSend(destination.threadKey),
      parse_mode: 'MarkdownV2' as const,
      reply_markup: options?.keyboard,
    };
    try {
      const sent = await this.bot.api.sendMessage(destination.chatId, escapeMarkdownV2(text), baseOptions);
      return sent.message_id;
    } catch (err) {
      if (isThreadMissingError(err) && baseOptions.message_thread_id !== undefined) {
        const sent = await this.bot.api.sendMessage(destination.chatId, text, {
          reply_markup: options?.keyboard,
        });
        return sent.message_id;
      }
      try {
        const sent = await this.bot.api.sendMessage(destination.chatId, text, {
          message_thread_id: baseOptions.message_thread_id,
          reply_markup: options?.keyboard,
        });
        return sent.message_id;
      } catch (fallbackErr) {
        log.warn({ err: fallbackErr }, 'Telegram sendMessage failed');
        return undefined;
      }
    }
  }

  private async renderStreamingDelta(
    event: SessionStreamEvent,
    destination: TelegramDestination,
  ): Promise<void> {
    const key = this.streamKey(event);
    if (!key) {
      return;
    }
    const text = this.streamingText(event);
    if (!text.trim()) {
      return;
    }
    const state = this.streamStates.get(key) ?? {
      destination,
      lastText: '',
      lastEditAt: 0,
    };
    state.destination = destination;
    state.lastText = text;
    this.streamStates.set(key, state);

    if (!state.telegramMessageId) {
      state.telegramMessageId = await this.sendTelegramMessage(
        destination,
        this.streamingPreview(text),
      );
      state.lastEditAt = Date.now();
      return;
    }

    const elapsed = Date.now() - state.lastEditAt;
    if (elapsed >= this.options.config.streamEditIntervalMs) {
      await this.editTelegramText(state, this.streamingPreview(text));
      return;
    }
    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = undefined;
        void this.editTelegramText(state, this.streamingPreview(state.lastText));
      }, this.options.config.streamEditIntervalMs - elapsed);
      state.timer.unref();
    }
  }

  private async finalizeStreamingMessage(
    event: SessionStreamEvent,
    destination: TelegramDestination,
    text: string,
  ): Promise<boolean> {
    const key = this.streamKey(event);
    if (!key) {
      return false;
    }
    const state = this.streamStates.get(key);
    if (!state) {
      return false;
    }
    if (state.timer) {
      clearTimeout(state.timer);
    }
    const [first, ...rest] = chunkTelegramText(text);
    if (state.telegramMessageId) {
      await this.editTelegramText(state, first);
    } else {
      await this.sendTelegramMessage(destination, first);
    }
    for (const chunk of rest) {
      await this.sendTelegramMessage(destination, chunk);
    }
    this.streamStates.delete(key);
    return true;
  }

  private async editTelegramText(state: TelegramStreamState, text: string): Promise<void> {
    if (!this.bot || !state.telegramMessageId) {
      return;
    }
    state.lastEditAt = Date.now();
    try {
      await this.bot.api.editMessageText(
        state.destination.chatId,
        state.telegramMessageId,
        escapeMarkdownV2(text),
        { parse_mode: 'MarkdownV2' },
      );
    } catch {
      await this.bot.api
        .editMessageText(state.destination.chatId, state.telegramMessageId, text)
        .catch(() => undefined);
    }
  }

  private streamKey(event: SessionStreamEvent): string | undefined {
    return event.messageId ? `${event.sessionId}:${event.messageId}` : undefined;
  }

  private streamingText(event: SessionStreamEvent): string {
    const message = event.payload?.message as SessionMessage | undefined;
    return message?.content ?? event.delta ?? '';
  }

  private streamingPreview(text: string): string {
    const chunks = chunkTelegramText(text);
    return chunks[0] ?? '...';
  }

  private threadIdForSend(threadKey: string): number | undefined {
    if (isRootThreadKey(threadKey)) {
      return undefined;
    }
    const parsed = Number.parseInt(threadKey, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private async answerCallback(ctx: Context, text: string): Promise<void> {
    const id = ctx.callbackQuery?.id;
    if (!id || !this.bot) return;
    await this.bot.api.answerCallbackQuery(id, { text: text.slice(0, 180) }).catch(() => undefined);
  }

  private async editCallbackMessage(ctx: Context, text: string): Promise<void> {
    if (!this.bot) return;
    const message = ctx.callbackQuery?.message;
    if (!message) return;
    await this.bot.api
      .editMessageText(message.chat.id, message.message_id, escapeMarkdownV2(text), {
        parse_mode: 'MarkdownV2',
      })
      .catch(() => undefined);
  }

  private sourceFromMessage(message: LooseTelegramMessage | undefined): TelegramSource | undefined {
    const chat = message?.chat;
    if (!chat) {
      return undefined;
    }
    const chatType = this.chatType(chat.type);
    const threadKey = threadKeyFromId(message.message_thread_id);
    return {
      chatId: String(chat.id),
      chatType,
      userId: message.from?.id ? String(message.from.id) : undefined,
      username: message.from?.username,
      messageId: message.message_id,
      threadId: threadKey || undefined,
      threadKey,
      isRootThread: isRootThreadKey(threadKey),
      isGroupLike: chatType === 'group' || chatType === 'supergroup' || chatType === 'channel',
    };
  }

  private chatType(value: string): TelegramChatType {
    if (value === 'group' || value === 'supergroup' || value === 'channel') {
      return value;
    }
    return 'private';
  }

  private isAuthorized(source: TelegramSource): boolean {
    const allowedUsers = new Set(
      this.options.config.allowedUsers.map((entry) => entry.replace(/^@/, '').toLowerCase()),
    );
    const username = source.username?.toLowerCase();
    const userAllowed =
      this.options.config.allowAllUsers ||
      (source.userId ? allowedUsers.has(source.userId) : false) ||
      (username ? allowedUsers.has(username) : false);
    if (!userAllowed) {
      return false;
    }
    if (!source.isGroupLike) {
      return true;
    }
    const allowedChats = new Set(this.options.config.allowedGroupChats.map(String));
    return allowedChats.size === 0
      ? this.options.config.allowAllUsers
      : allowedChats.has(source.chatId);
  }

  private isMessageAddressedToBot(message: LooseTelegramMessage, rawText: string): boolean {
    if (!this.options.config.requireMention) {
      return true;
    }
    if (message.reply_to_message?.from?.id && this.botId && message.reply_to_message.from.id === this.botId) {
      return true;
    }
    if (!this.botUsername) {
      return false;
    }
    return rawText.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`);
  }

  private getChatSettings(source: TelegramSource): TelegramChatSettings | undefined {
    return this.repo.findChatSettings(this.chatSettingsScope(source));
  }

  private chatSettingsScope(source: TelegramSource): {
    chatId: string;
    chatType: TelegramChatType;
    userId?: string;
  } {
    return {
      chatId: source.chatId,
      chatType: source.chatType,
      userId: source.userId,
    };
  }

  private bindingScope(source: TelegramSource, topicMode: boolean): TelegramBindingScope {
    const threadKey = source.chatType === 'private' && !topicMode ? '' : source.threadKey;
    return {
      chatId: source.chatId,
      chatType: source.chatType,
      userId: source.userId,
      threadKey,
    };
  }

  private defaultDeviceId(settings: TelegramChatSettings | undefined): string {
    const configured = settings?.defaultDeviceId ?? this.options.config.defaultDeviceId;
    return configured === 'host' ? this.options.hostDeviceId : configured;
  }

  private defaultExecutor(settings: TelegramChatSettings | undefined): ExecutorType {
    const executor = settings?.defaultExecutor ?? this.options.config.defaultExecutor;
    if (
      executor === 'codex' ||
      executor === 'claude-code' ||
      executor === 'mock' ||
      executor === 'custom-command'
    ) {
      return executor;
    }
    return this.options.config.defaultExecutor;
  }

  private defaultMode(settings: TelegramChatSettings | undefined): AgentMode {
    const mode = settings?.defaultMode ?? this.options.config.defaultMode;
    return mode === 'plan' || mode === 'review' ? mode : 'agent';
  }

  private defaultPermissionMode(
    settings: TelegramChatSettings | undefined,
  ): 'read-only' | 'default' | 'auto-review' | 'full-access' {
    const mode = settings?.defaultPermissionMode ?? this.options.config.defaultPermissionMode;
    if (
      mode === 'read-only' ||
      mode === 'default' ||
      mode === 'auto-review' ||
      mode === 'full-access'
    ) {
      return mode;
    }
    return 'default';
  }

  private async prepareMedia(message: LooseTelegramMessage): Promise<PreparedMedia[]> {
    const refs = this.mediaRefs(message);
    const prepared: PreparedMedia[] = [];
    for (const ref of refs) {
      if (ref.fileType === 'sticker') {
        prepared.push({
          fileType: ref.fileType,
          telegramFileId: ref.file.file_id,
          fileUniqueId: ref.file.file_unique_id,
          sizeBytes: ref.file.file_size,
          promptText: `Telegram sticker: ${ref.file.emoji ?? 'sticker'}${ref.file.set_name ? ` from ${ref.file.set_name}` : ''}.`,
          metadata: { emoji: ref.file.emoji, setName: ref.file.set_name },
        });
        continue;
      }
      const downloaded = await this.downloadMedia(ref.fileType, ref.file).catch((err) => {
        log.warn({ err, fileType: ref.fileType }, 'Telegram media download failed');
        return undefined;
      });
      if (!downloaded) {
        prepared.push({
          fileType: ref.fileType,
          telegramFileId: ref.file.file_id,
          fileUniqueId: ref.file.file_unique_id,
          fileName: ref.file.file_name,
          mimeType: ref.file.mime_type,
          sizeBytes: ref.file.file_size,
          promptText: `Telegram ${ref.fileType} received but could not be cached.`,
        });
        continue;
      }
      const textContent = await this.textDocumentContent(ref.fileType, ref.file, downloaded.localPath);
      prepared.push({
        fileType: ref.fileType,
        telegramFileId: ref.file.file_id,
        fileUniqueId: ref.file.file_unique_id,
        fileName: ref.file.file_name ?? downloaded.fileName,
        mimeType: ref.file.mime_type,
        localPath: downloaded.localPath,
        sizeBytes: downloaded.sizeBytes,
        promptText: textContent
          ? `Telegram document ${ref.file.file_name ?? downloaded.fileName}:\n\n${textContent}`
          : `Telegram ${ref.fileType} saved at ${downloaded.localPath}${ref.file.file_name ? ` (${ref.file.file_name})` : ''}.`,
      });
    }
    return prepared;
  }

  private mediaRefs(message: LooseTelegramMessage): Array<{
    fileType: TelegramMediaKind;
    file: LooseTelegramFileRef;
  }> {
    const refs: Array<{ fileType: TelegramMediaKind; file: LooseTelegramFileRef }> = [];
    const photo = message.photo?.[message.photo.length - 1];
    if (photo) refs.push({ fileType: 'photo', file: photo });
    if (message.video) refs.push({ fileType: 'video', file: message.video });
    if (message.audio) refs.push({ fileType: 'audio', file: message.audio });
    if (message.voice) refs.push({ fileType: 'voice', file: message.voice });
    if (message.document) refs.push({ fileType: 'document', file: message.document });
    if (message.sticker) refs.push({ fileType: 'sticker', file: message.sticker });
    return refs;
  }

  private async downloadMedia(
    fileType: TelegramMediaKind,
    ref: LooseTelegramFileRef,
  ): Promise<{ localPath: string; fileName: string; sizeBytes: number }> {
    if (!this.bot || !this.options.botToken) {
      throw new Error('Telegram bot is not configured.');
    }
    if (ref.file_size && ref.file_size > this.options.config.mediaMaxBytes) {
      throw new Error('Telegram file exceeds TELEGRAM_MEDIA_MAX_BYTES.');
    }
    const file = await this.bot.api.getFile(ref.file_id);
    if (!file.file_path) {
      throw new Error('Telegram did not return a file path.');
    }
    const response = await fetch(
      `https://api.telegram.org/file/bot${this.options.botToken}/${file.file_path}`,
    );
    if (!response.ok) {
      throw new Error(`Telegram file download returned HTTP ${response.status}.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > this.options.config.mediaMaxBytes) {
      throw new Error('Telegram file exceeds TELEGRAM_MEDIA_MAX_BYTES.');
    }
    const fileName = safeFileName(ref.file_name || path.basename(file.file_path) || `${fileType}.bin`);
    const targetDir = path.join(this.options.config.cacheDir, new Date().toISOString().slice(0, 10));
    await mkdir(targetDir, { recursive: true });
    const localPath = path.join(targetDir, `${Date.now()}-${randomBytes(4).toString('hex')}-${fileName}`);
    await writeFile(localPath, buffer);
    return { localPath, fileName, sizeBytes: buffer.byteLength };
  }

  private async textDocumentContent(
    fileType: TelegramMediaKind,
    ref: LooseTelegramFileRef,
    localPath: string,
  ): Promise<string | undefined> {
    if (fileType !== 'document') {
      return undefined;
    }
    const name = ref.file_name?.toLowerCase() ?? '';
    const isText =
      ref.mime_type?.startsWith('text/') ||
      name.endsWith('.txt') ||
      name.endsWith('.md') ||
      name.endsWith('.markdown');
    if (!isText) {
      return undefined;
    }
    const size = ref.file_size ?? 0;
    if (size > TEXT_DOCUMENT_LIMIT_BYTES) {
      return `Document text omitted because it is larger than ${TEXT_DOCUMENT_LIMIT_BYTES} bytes. Cached path: ${localPath}`;
    }
    return readFile(localPath, 'utf8');
  }

  private async persistMedia(media: PreparedMedia[], sessionId: string): Promise<void> {
    for (const item of media) {
      const attachment: TelegramMediaAttachment = {
        id: uuid(),
        sessionId,
        telegramFileId: item.telegramFileId,
        fileUniqueId: item.fileUniqueId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileType: item.fileType,
        localPath: item.localPath,
        sizeBytes: item.sizeBytes,
        metadata: item.metadata,
        createdAt: new Date().toISOString(),
      };
      this.repo.createMediaAttachment(attachment);
    }
  }

  private async pruneMediaCache(): Promise<void> {
    const cutoff = Date.now() - MEDIA_CACHE_TTL_MS;
    await this.pruneDirectory(this.options.config.cacheDir, cutoff);
  }

  private async pruneDirectory(dir: string, cutoff: number): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.pruneDirectory(target, cutoff);
        const remaining = await readdir(target).catch(() => []);
        if (remaining.length === 0) {
          await rm(target, { recursive: true, force: true });
        }
        continue;
      }
      const info = await stat(target).catch(() => undefined);
      if (info && info.mtimeMs < cutoff) {
        await rm(target, { force: true });
      }
    }
  }

  private helpText(): string {
    return [
      'ox Telegram gateway',
      '',
      'Send a prompt to create or continue the current session lane.',
      '/new [prompt] - reset this lane or start with a prompt',
      '/sessions - list Telegram-bound sessions',
      '/resume <session_id> - bind this lane to a session',
      '/status, /stop, /diff, /export',
      '/model, /models, /effort, /permissions',
      '/agent, /plan, /review [prompt]',
      '/topic, /topic off, /topic <session_id>',
      '/codex, /claude - choose executor for new sessions',
    ].join('\n');
  }
}

function isThreadMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return message.includes('thread') && (message.includes('not found') || message.includes('invalid'));
}

function safeFileName(name: string): string {
  const invalid = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
  const cleaned = Array.from(name)
    .map((char) => (invalid.has(char) || char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .slice(0, 120);
  return cleaned || 'telegram-file';
}
