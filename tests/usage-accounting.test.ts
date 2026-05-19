import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from '../packages/storage/src/schema.ts';
import { SessionService } from '../apps/host/src/services/session-service.ts';
import {
  aggregateUsageReports,
  calculateUsageCosts,
  estimateTokenCount,
  parseUsagePricing,
} from '../apps/host/src/services/usage-accounting.ts';

function requireReport(values: unknown[]) {
  const report = aggregateUsageReports(values);
  assert.ok(report, 'expected usage report');
  return report;
}

const pricing = parseUsagePricing(JSON.stringify({
  'claude-sonnet': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadInputPerMillion: 0.3,
    cacheCreationInputPerMillion: 3.75,
    cacheCreation5mInputPerMillion: 3.75,
    cacheCreation1hInputPerMillion: 6,
    currency: 'USD',
  },
}));

{
  assert.equal(estimateTokenCount(''), 0);
  assert.equal(estimateTokenCount('hello world'), 3);
  assert.equal(estimateTokenCount('\u4f60\u597d\u4e16\u754c'), 4);
}

{
  const chinesePrompt = Array.from({ length: 40 }, () => '\u4f60').join('');
  assert.equal(estimateTokenCount(chinesePrompt), 40);
  assert.ok(
    estimateTokenCount(chinesePrompt) > Math.ceil(chinesePrompt.length / 4),
    'CJK estimates should not use the ASCII chars/4 fallback',
  );
}

{
  const code = 'function add(a, b) {\n  return a + b;\n}';
  assert.ok(
    estimateTokenCount(code) > Math.ceil(code.length / 4),
    'code estimates should account for dense punctuation and line breaks',
  );
}

{
  const report = requireReport([
    { usage: { input_tokens: 21, cache_creation_input_tokens: 188_086, output_tokens: 393 } },
  ]);
  assert.equal(report.tokens.inputTokens, 188_107);
  assert.equal(report.tokens.totalTokens, 188_500);
}

{
  const report = requireReport([
    {
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 2_000,
        output_tokens: 50,
      },
    },
  ]);
  const costs = calculateUsageCosts(report, 'claude-sonnet-4-6', pricing);
  assert.ok(costs, 'expected complete costs');
  assert.equal(costs.currency, 'USD');
  assert.equal(costs.inputCost, (100 / 1_000_000) * 3 + (500 / 1_000_000) * 3.75 + (2_000 / 1_000_000) * 0.3);
  assert.equal(costs.outputCost, (50 / 1_000_000) * 15);
}

{
  const report = requireReport([
    {
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 300,
        cache_creation: {
          ephemeral_5m_input_tokens: 100,
          ephemeral_1h_input_tokens: 200,
        },
        output_tokens: 20,
      },
    },
  ]);
  const costs = calculateUsageCosts(report, 'claude-sonnet-4-6', pricing);
  assert.ok(costs, 'expected ttl-aware costs');
  assert.equal(costs.cacheCreationCost, (100 / 1_000_000) * 3.75 + (200 / 1_000_000) * 6);
}

{
  const missingCachePricing = parseUsagePricing(JSON.stringify({
    'claude-sonnet': { inputPerMillion: 3, outputPerMillion: 15, currency: 'USD' },
  }));
  const report = requireReport([
    { usage: { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 } },
  ]);
  assert.equal(calculateUsageCosts(report, 'claude-sonnet-4-6', missingCachePricing), undefined);
}

{
  const report = requireReport([
    { usage: { input_tokens: 10, output_tokens: 5 } },
    { usage: { inputTokens: 20, cacheReadInputTokens: 40, outputTokens: 10 } },
  ]);
  assert.equal(report.tokens.uncachedInputTokens, 30);
  assert.equal(report.tokens.cacheReadInputTokens, 40);
  assert.equal(report.tokens.outputTokens, 15);
  assert.equal(report.tokens.totalTokens, 85);
}

{
  const report = requireReport([
    {
      usage: { input_tokens: 1, output_tokens: 1 },
      model_usage: {
        'claude-sonnet-4-6': {
          inputTokens: 1,
          cacheReadInputTokens: 2,
          outputTokens: 3,
        },
      },
    },
  ]);
  const costs = calculateUsageCosts(report, 'ignored-session-model', pricing);
  assert.ok(costs, 'expected model_usage costs');
  assert.equal(costs.inputCost, (1 / 1_000_000) * 3 + (2 / 1_000_000) * 0.3);
  assert.equal(costs.outputCost, (3 / 1_000_000) * 15);
}

{
  const report = requireReport([
    { usage: { input_tokens: 25, output_tokens: 10 } },
  ]);
  assert.equal(report.tokens.cacheCreationInputTokens, 0);
  assert.equal(report.tokens.cacheReadInputTokens, 0);
}

{
  const report = requireReport([
    {
      usage: {
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 40 },
        output_tokens: 20,
      },
    },
  ]);
  assert.equal(report.tokens.uncachedInputTokens, 60);
  assert.equal(report.tokens.cacheReadInputTokens, 40);
  assert.equal(report.tokens.inputTokens, 100);
  assert.equal(report.tokens.totalTokens, 120);
}

{
  const report = requireReport([
    { token_usage: { input: 12, output: 8, total: 20 } },
  ]);
  assert.equal(report.tokens.inputTokens, 12);
  assert.equal(report.tokens.outputTokens, 8);
  assert.equal(report.tokens.totalTokens, 20);
}

{
  const report = requireReport([
    {
      source: 'codex-app-server',
      message: 'Codex usage updated.',
      usage: { input_tokens: 10, output_tokens: 2 },
    },
    {
      source: 'codex-app-server',
      message: 'Codex usage updated.',
      usage: { input_tokens: 20, output_tokens: 5 },
    },
  ]);
  assert.equal(report.tokens.inputTokens, 20);
  assert.equal(report.tokens.outputTokens, 5);
  assert.equal(report.tokens.totalTokens, 25);
}

{
  const report = requireReport([
    {
      usageAggregation: 'snapshot',
      usage: { input_tokens: 10, output_tokens: 2 },
    },
    {
      usageAggregation: 'snapshot',
      usage: { input_tokens: 3, output_tokens: 1 },
    },
  ]);
  assert.equal(report.tokens.inputTokens, 13);
  assert.equal(report.tokens.outputTokens, 3);
  assert.equal(report.tokens.totalTokens, 16);
}

{
  const db = new Database(':memory:');
  initSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, deviceId, title, status, executorType, modelId, reasoningEffort, createdBy, createdAt, updatedAt, lastMessageAt, workingDirectory, pinned, archived, activeTaskId, currentPlan, contextClearedAt, externalSessionId)
     VALUES ('session-1', 'device-1', 'Usage repair', 'idle', 'claude-code', 'claude-sonnet-4-6', NULL, 'test', @now, @now, @now, NULL, 0, 0, NULL, NULL, NULL, NULL)`,
  ).run({ now });
  db.prepare(
    `INSERT INTO session_messages (id, sessionId, taskId, role, type, content, status, modelId, metadata, createdAt, sequence)
     VALUES ('message-1', 'session-1', 'task-1', 'assistant', 'text', 'done', 'completed', NULL, '{}', @now, 1)`,
  ).run({ now });
  db.prepare(
    `INSERT INTO task_events (id, seq, taskId, type, level, payload, createdAt)
     VALUES ('event-1', 1, 'task-1', 'task.log', 'info', @payload, @now)`,
  ).run({
    now,
    payload: JSON.stringify({
      usage: {
        input_tokens: 21,
        cache_creation_input_tokens: 188_086,
        output_tokens: 393,
      },
    }),
  });
  db.prepare(
    `INSERT INTO agent_usage (id, sessionId, provider, model, inputTokens, outputTokens, totalTokens, estimated, costEstimated, createdAt, updatedAt)
     VALUES ('usage-1', 'session-1', 'claude-code', 'claude-sonnet-4-6', 21, 393, 414, 0, 0, @now, @now)`,
  ).run({ now });

  const service = new SessionService(db, {} as never, {} as never);
  const usage = service.getUsage('session-1');
  assert.ok(usage, 'expected repaired usage');
  assert.equal(usage.inputTokens, 188_107);
  assert.equal(usage.totalTokens, 188_500);
  assert.equal(usage.cacheCreationInputTokens, 188_086);
  assert.equal(db.prepare('SELECT totalTokens FROM agent_usage WHERE sessionId = ?').get('session-1')?.totalTokens, 188_500);
  db.close();
}

{
  const db = new Database(':memory:');
  initSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, deviceId, title, status, executorType, modelId, reasoningEffort, createdBy, createdAt, updatedAt, lastMessageAt, workingDirectory, pinned, archived, activeTaskId, currentPlan, contextClearedAt, externalSessionId)
     VALUES ('session-2', 'device-1', 'Usage snapshot', 'idle', 'codex', 'gpt-5.5', NULL, 'test', @now, @now, @now, NULL, 0, 0, NULL, NULL, NULL, NULL)`,
  ).run({ now });
  db.prepare(
    `INSERT INTO session_messages (id, sessionId, taskId, role, type, content, status, modelId, metadata, createdAt, sequence)
     VALUES ('message-2', 'session-2', 'task-2', 'assistant', 'text', 'done', 'completed', NULL, '{}', @now, 1)`,
  ).run({ now });
  db.prepare(
    `INSERT INTO task_events (id, seq, taskId, type, level, payload, createdAt)
     VALUES ('event-2a', 1, 'task-2', 'task.log', 'info', @payload, @now)`,
  ).run({
    now,
    payload: JSON.stringify({
      source: 'codex-app-server',
      message: 'Codex usage updated.',
      usage: { input_tokens: 10, output_tokens: 2 },
    }),
  });
  db.prepare(
    `INSERT INTO task_events (id, seq, taskId, type, level, payload, createdAt)
     VALUES ('event-2b', 2, 'task-2', 'task.log', 'info', @payload, @now)`,
  ).run({
    now,
    payload: JSON.stringify({
      source: 'codex-app-server',
      message: 'Codex usage updated.',
      usage: { input_tokens: 20, output_tokens: 5 },
    }),
  });

  const service = new SessionService(db, {} as never, {} as never);
  const usage = service.getUsage('session-2');
  assert.ok(usage, 'expected session snapshot usage');
  assert.equal(usage.inputTokens, 20);
  assert.equal(usage.outputTokens, 5);
  assert.equal(usage.totalTokens, 25);
  assert.equal(db.prepare('SELECT totalTokens FROM agent_usage WHERE sessionId = ?').get('session-2')?.totalTokens, 25);
  db.close();
}

console.log('usage-accounting tests passed');
