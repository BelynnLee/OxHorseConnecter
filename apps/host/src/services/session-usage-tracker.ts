import { v4 as uuid } from 'uuid';
import type {
  AgentUsageRepository,
  EventRepository,
  SessionMessageRepository,
  SessionRepository,
} from '@rac/storage';
import type { AgentSession, AgentUsage } from '@rac/shared';
import {
  aggregateUsageReports,
  calculateUsageCosts,
  estimateTokenCount,
  parseUsagePricing,
  type UsageCostBreakdown,
  type UsageReport,
  type UsageTokenBreakdown,
} from './usage-accounting.js';
import { config } from '../config.js';
import { MAX_EXPORT_MESSAGES } from './session-helpers.js';

export class SessionUsageTracker {
  constructor(
    private sessions: SessionRepository,
    private messages: SessionMessageRepository,
    private events: EventRepository,
    private usage: AgentUsageRepository
  ) {}

  formatUsageSummary(usage: AgentUsage): string {
    const cost =
      usage.totalCost !== undefined
        ? ` (${usage.currency ?? 'USD'} ${usage.totalCost.toFixed(6)})`
        : '';
    const inputBreakdown =
      usage.cacheCreationInputTokens || usage.cacheReadInputTokens
        ? `; input ${usage.inputTokens} = uncached ${usage.uncachedInputTokens} + cache write ${usage.cacheCreationInputTokens} + cache read ${usage.cacheReadInputTokens}`
        : `; input ${usage.inputTokens}`;
    return `${usage.totalTokens} tokens (output ${usage.outputTokens}${inputBreakdown})${cost}`;
  }

  rebuildActualUsageFromEvents(sessionId: string): AgentUsage | undefined {
    const session = this.sessions.findById(sessionId);
    if (!session) return undefined;
    const report = aggregateUsageReports(this.collectUsagePayloads(sessionId));
    if (!report) return undefined;
    const usage = this.usageFromReport(session, report, this.usage.findBySession(sessionId), false);
    this.usage.upsert(usage);
    return usage;
  }

  updateUsageEstimate(sessionId: string): AgentUsage | undefined {
    const session = this.sessions.findById(sessionId);
    if (!session) return undefined;
    const messages = this.messages.findBySessionId(sessionId, { limit: 1000 }).items;
    const inputText = messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n');
    const outputText = messages
      .filter((message) => message.role === 'assistant' || message.role === 'summary')
      .map((message) => message.content)
      .join('\n');
    const inputTokens = estimateTokenCount(inputText);
    const outputTokens = estimateTokenCount(outputText);
    const existing = this.usage.findBySession(sessionId);
    if (existing && !existing.estimated) {
      return existing;
    }
    const usage = this.usageFromReport(
      session,
      this.reportFromEstimatedTokens(inputTokens, outputTokens),
      existing,
      true
    );
    this.usage.upsert(usage);
    return usage;
  }

  recordActualUsage(sessionId: string, value: unknown): void {
    const session = this.sessions.findById(sessionId);
    if (!session) return;
    const rebuilt = this.rebuildActualUsageFromEvents(sessionId);
    if (rebuilt) return;
    const report = aggregateUsageReports([value]);
    if (!report) return;
    this.usage.upsert(
      this.usageFromReport(session, report, this.usage.findBySession(sessionId), false)
    );
  }

  private collectSessionTaskIds(sessionId: string): string[] {
    const session = this.sessions.findById(sessionId);
    const taskIds = new Set<string>();
    if (session?.activeTaskId) {
      taskIds.add(session.activeTaskId);
    }
    for (const message of this.messages.findBySessionId(sessionId, { limit: MAX_EXPORT_MESSAGES })
      .items) {
      if (message.taskId) {
        taskIds.add(message.taskId);
      }
    }
    return Array.from(taskIds);
  }

  private collectUsagePayloads(sessionId: string): unknown[] {
    return this.collectSessionTaskIds(sessionId)
      .flatMap((taskId) =>
        this.events.findByTaskId(taskId).filter((event) => {
          if (event.type !== 'task.log') {
            return false;
          }
          const payload = event.payload as Record<string, unknown>;
          return Boolean(
            payload.usage ||
            payload.token_usage ||
            payload.tokenUsage ||
            payload.model_usage ||
            payload.modelUsage
          );
        })
      )
      .sort((left, right) => {
        const leftTime = Date.parse(left.createdAt);
        const rightTime = Date.parse(right.createdAt);
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return (left.seq ?? 0) - (right.seq ?? 0);
      })
      .map((event) => event.payload);
  }

  private costsForUsage(
    report: UsageReport,
    sessionModelId: string | undefined
  ): UsageCostBreakdown | undefined {
    return calculateUsageCosts(
      report,
      sessionModelId,
      parseUsagePricing(config.agentModelPricingJson)
    );
  }

  private usageFromReport(
    session: AgentSession,
    report: UsageReport,
    existing: AgentUsage | undefined,
    estimated: boolean
  ): AgentUsage {
    const now = new Date().toISOString();
    const costs = this.costsForUsage(report, session.modelId);
    const tokens = report.tokens;
    return {
      id: existing?.id ?? uuid(),
      sessionId: session.id,
      provider: session.executorType,
      model: session.modelId,
      uncachedInputTokens: tokens.uncachedInputTokens,
      cacheCreationInputTokens: tokens.cacheCreationInputTokens,
      cacheReadInputTokens: tokens.cacheReadInputTokens,
      cacheCreation5mInputTokens: tokens.cacheCreation5mInputTokens,
      cacheCreation1hInputTokens: tokens.cacheCreation1hInputTokens,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      totalTokens: tokens.totalTokens,
      estimated,
      costEstimated: Boolean(costs),
      uncachedInputCost: costs?.uncachedInputCost,
      cacheCreationCost: costs?.cacheCreationCost,
      cacheReadCost: costs?.cacheReadCost,
      inputCost: costs?.inputCost,
      outputCost: costs?.outputCost,
      totalCost: costs?.totalCost,
      currency: costs?.currency,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  private reportFromEstimatedTokens(inputTokens: number, outputTokens: number): UsageReport {
    const tokens: UsageTokenBreakdown = {
      uncachedInputTokens: inputTokens,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
    return { tokens, modelUsage: [] };
  }
}
