export interface UsageTokenBreakdown {
  uncachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageCostBreakdown {
  uncachedInputCost: number;
  cacheCreationCost: number;
  cacheReadCost: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

export interface UsagePricing {
  inputPerMillion?: number;
  outputPerMillion?: number;
  cacheReadInputPerMillion?: number;
  cacheCreationInputPerMillion?: number;
  cacheCreation5mInputPerMillion?: number;
  cacheCreation1hInputPerMillion?: number;
  currency?: string;
}

export interface UsageReport {
  tokens: UsageTokenBreakdown;
  modelUsage: Array<{ model: string; tokens: UsageTokenBreakdown }>;
}

type UsageAggregationMode = 'delta' | 'snapshot';

const ZERO_TOKENS: UsageTokenBreakdown = {
  uncachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreation5mInputTokens: 0,
  cacheCreation1hInputTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

const ASCII_CODE_PUNCTUATION = new Set([
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  ';',
  '=',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '\\',
  '|',
  '&',
  '!',
  '?',
  ':',
  '.',
  ',',
  '`',
  '"',
  "'",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isCjkLikeCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af)
  );
}

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function estimateAsciiSegmentTokenUnits(segment: string): number {
  if (!segment) {
    return 0;
  }

  const normalized = segment.replace(/\r\n/g, '\n').replace(/[ \t\f\v]+/g, ' ').trim();
  const wordCount = segment.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  let punctuationCount = 0;
  let lineBreakCount = 0;

  for (const char of segment) {
    if (ASCII_CODE_PUNCTUATION.has(char)) {
      punctuationCount += 1;
    } else if (char === '\n') {
      lineBreakCount += 1;
    }
  }

  if (!normalized) {
    return lineBreakCount * 0.25;
  }

  return (
    Math.max(normalized.length / 4, wordCount * 0.75) +
    punctuationCount * 0.25 +
    lineBreakCount * 0.25
  );
}

export function estimateTokenCount(text: string): number {
  if (!text.trim()) {
    return 0;
  }

  let tokenUnits = 0;
  let asciiSegment = '';
  const flushAsciiSegment = () => {
    tokenUnits += estimateAsciiSegmentTokenUnits(asciiSegment);
    asciiSegment = '';
  };

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    if (codePoint <= 0x7f) {
      asciiSegment += char;
      continue;
    }

    flushAsciiSegment();
    if (isCjkLikeCodePoint(codePoint)) {
      tokenUnits += 1;
    } else if (!isCombiningCodePoint(codePoint)) {
      tokenUnits += 2;
    }
  }

  flushAsciiSegment();
  return Math.ceil(tokenUnits);
}

function tokenNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return undefined;
}

function pricingNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function addTokens(left: UsageTokenBreakdown, right: UsageTokenBreakdown): UsageTokenBreakdown {
  return finalizeTokens({
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    cacheReadInputTokens: left.cacheReadInputTokens + right.cacheReadInputTokens,
    cacheCreation5mInputTokens: left.cacheCreation5mInputTokens + right.cacheCreation5mInputTokens,
    cacheCreation1hInputTokens: left.cacheCreation1hInputTokens + right.cacheCreation1hInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  });
}

function addReports(left: UsageReport, right: UsageReport): UsageReport {
  const modelTokens = new Map<string, UsageTokenBreakdown>();
  for (const entry of left.modelUsage) {
    modelTokens.set(entry.model, entry.tokens);
  }
  for (const entry of right.modelUsage) {
    modelTokens.set(entry.model, addTokens(modelTokens.get(entry.model) ?? ZERO_TOKENS, entry.tokens));
  }

  return {
    tokens: addTokens(left.tokens, right.tokens),
    modelUsage: Array.from(modelTokens.entries()).map(([model, tokens]) => ({ model, tokens })),
  };
}

function emptyUsageReport(): UsageReport {
  return { tokens: ZERO_TOKENS, modelUsage: [] };
}

function finalizeTokens(input: {
  uncachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cacheCreation5mInputTokens: number;
  cacheCreation1hInputTokens: number;
  outputTokens: number;
}): UsageTokenBreakdown {
  const inputTokens =
    input.uncachedInputTokens +
    input.cacheCreationInputTokens +
    input.cacheReadInputTokens;
  return {
    ...input,
    inputTokens,
    totalTokens: inputTokens + input.outputTokens,
  };
}

function stringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function normalizedUsageMode(value: string | undefined): string {
  return (value ?? '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function usageAggregationMode(value: unknown): UsageAggregationMode {
  if (!isRecord(value)) {
    return 'delta';
  }

  if (value.usageCumulative === true || value.usage_cumulative === true || value.usageSnapshot === true || value.usage_snapshot === true) {
    return 'snapshot';
  }

  const explicitMode = normalizedUsageMode(stringValue(value, [
    'usageAggregation',
    'usage_aggregation',
    'usageAccounting',
    'usage_accounting',
    'usageMode',
    'usage_mode',
  ]));
  if (['snapshot', 'cumulative', 'cumulativesnapshot', 'sessiontotal', 'threadtotal'].includes(explicitMode)) {
    return 'snapshot';
  }
  if (['delta', 'incremental', 'increment'].includes(explicitMode)) {
    return 'delta';
  }

  const eventName = normalizedUsageMode(stringValue(value, ['codexEventType', 'method', 'event', 'type']));
  if (eventName.includes('tokenusageupdated') || eventName.includes('usageupdated')) {
    return 'snapshot';
  }

  const source = stringValue(value, ['source']);
  const message = stringValue(value, ['message']);
  if (source === 'codex-app-server' && message === 'Codex usage updated.') {
    return 'snapshot';
  }

  return 'delta';
}

export function extractUsageTokens(value: unknown): UsageTokenBreakdown | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const cacheCreation = isRecord(value.cache_creation)
    ? value.cache_creation
    : isRecord(value.cacheCreation)
      ? value.cacheCreation
      : undefined;
  const cacheCreation5mInputTokens = cacheCreation
    ? tokenNumber(cacheCreation, ['ephemeral_5m_input_tokens', 'ephemeral5mInputTokens'])
    : undefined;
  const cacheCreation1hInputTokens = cacheCreation
    ? tokenNumber(cacheCreation, ['ephemeral_1h_input_tokens', 'ephemeral1hInputTokens'])
    : undefined;
  const nestedCacheCreationTokens = (cacheCreation5mInputTokens ?? 0) + (cacheCreation1hInputTokens ?? 0);
  const inputTokenDetails = isRecord(value.input_tokens_details)
    ? value.input_tokens_details
    : isRecord(value.inputTokensDetails)
      ? value.inputTokensDetails
      : isRecord(value.prompt_tokens_details)
        ? value.prompt_tokens_details
        : isRecord(value.promptTokensDetails)
          ? value.promptTokensDetails
          : undefined;

  const explicitUncachedInputTokens = tokenNumber(value, ['uncached_input_tokens', 'uncachedInputTokens']);
  const rawInputTokens = tokenNumber(value, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens', 'input', 'prompt']);
  const cacheCreationInputTokens =
    tokenNumber(value, ['cache_creation_input_tokens', 'cacheCreationInputTokens']) ??
    (nestedCacheCreationTokens > 0 ? nestedCacheCreationTokens : undefined);
  const directCacheReadInputTokens = tokenNumber(value, ['cache_read_input_tokens', 'cacheReadInputTokens']);
  const cachedInputTokens =
    tokenNumber(value, ['cached_input_tokens', 'cachedInputTokens']) ??
    (inputTokenDetails ? tokenNumber(inputTokenDetails, ['cached_tokens', 'cachedTokens']) : undefined);
  const cacheReadInputTokens = directCacheReadInputTokens ?? cachedInputTokens;
  const inputIncludesCached = directCacheReadInputTokens === undefined && cachedInputTokens !== undefined;
  const uncachedInputTokens = explicitUncachedInputTokens ??
    (rawInputTokens === undefined
      ? undefined
      : inputIncludesCached
        ? Math.max(0, rawInputTokens - (cacheReadInputTokens ?? 0) - (cacheCreationInputTokens ?? 0))
        : rawInputTokens);
  const providedTotalTokens = tokenNumber(value, ['total_tokens', 'totalTokens', 'total']);
  const directOutputTokens = tokenNumber(value, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens', 'output', 'completion']);
  const knownInputTokens =
    (uncachedInputTokens ?? 0) +
    (cacheCreationInputTokens ?? 0) +
    (cacheReadInputTokens ?? 0);
  const outputTokens = directOutputTokens ??
    (providedTotalTokens !== undefined
      ? Math.max(0, providedTotalTokens - knownInputTokens)
      : undefined);

  if (
    uncachedInputTokens === undefined &&
    outputTokens === undefined &&
    cacheCreationInputTokens === undefined &&
    cacheReadInputTokens === undefined &&
    cacheCreation5mInputTokens === undefined &&
    cacheCreation1hInputTokens === undefined
  ) {
    return undefined;
  }

  return finalizeTokens({
    uncachedInputTokens: uncachedInputTokens ?? 0,
    cacheCreationInputTokens: cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: cacheReadInputTokens ?? 0,
    cacheCreation5mInputTokens: cacheCreation5mInputTokens ?? 0,
    cacheCreation1hInputTokens: cacheCreation1hInputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  });
}

export function extractUsageReport(value: unknown): UsageReport | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usageValue = isRecord(value.usage)
    ? value.usage
    : isRecord(value.token_usage)
      ? value.token_usage
      : isRecord(value.tokenUsage)
        ? value.tokenUsage
        : value;
  const directTokens = extractUsageTokens(usageValue);
  const rawModelUsage = isRecord(value.model_usage)
    ? value.model_usage
    : isRecord(value.modelUsage)
      ? value.modelUsage
      : undefined;
  const modelUsage = rawModelUsage
    ? Object.entries(rawModelUsage)
        .map(([model, tokensValue]) => {
          const tokens = extractUsageTokens(tokensValue);
          return tokens ? { model, tokens } : undefined;
        })
        .filter((entry): entry is { model: string; tokens: UsageTokenBreakdown } => Boolean(entry))
    : [];

  if (!directTokens && modelUsage.length === 0) {
    return undefined;
  }

  const tokens = directTokens ?? modelUsage.reduce((sum, entry) => addTokens(sum, entry.tokens), ZERO_TOKENS);
  return { tokens, modelUsage };
}

export function aggregateUsageReports(values: unknown[]): UsageReport | undefined {
  let deltaReport = emptyUsageReport();
  let committedSnapshotReport = emptyUsageReport();
  let currentSnapshotReport: UsageReport | undefined;
  let deltasAfterSnapshot = emptyUsageReport();
  let found = false;
  let foundSnapshot = false;

  for (const value of values) {
    const report = extractUsageReport(value);
    if (!report) {
      continue;
    }
    found = true;

    if (usageAggregationMode(value) === 'snapshot') {
      if (currentSnapshotReport && report.tokens.totalTokens < currentSnapshotReport.tokens.totalTokens) {
        committedSnapshotReport = addReports(
          committedSnapshotReport,
          addReports(currentSnapshotReport, deltasAfterSnapshot),
        );
      }
      foundSnapshot = true;
      currentSnapshotReport = report;
      deltasAfterSnapshot = emptyUsageReport();
      continue;
    }

    if (foundSnapshot) {
      deltasAfterSnapshot = addReports(deltasAfterSnapshot, report);
    } else {
      deltaReport = addReports(deltaReport, report);
    }
  }

  if (!found) {
    return undefined;
  }

  if (!foundSnapshot) {
    return deltaReport;
  }

  return addReports(
    committedSnapshotReport,
    addReports(currentSnapshotReport ?? emptyUsageReport(), deltasAfterSnapshot),
  );
}

export function parseUsagePricing(raw: string | undefined): Record<string, UsagePricing> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => isRecord(value))
        .map(([model, value]) => [
          model,
          {
            inputPerMillion: pricingNumber((value as Record<string, unknown>).inputPerMillion),
            outputPerMillion: pricingNumber((value as Record<string, unknown>).outputPerMillion),
            cacheReadInputPerMillion: pricingNumber((value as Record<string, unknown>).cacheReadInputPerMillion),
            cacheCreationInputPerMillion: pricingNumber((value as Record<string, unknown>).cacheCreationInputPerMillion),
            cacheCreation5mInputPerMillion: pricingNumber((value as Record<string, unknown>).cacheCreation5mInputPerMillion),
            cacheCreation1hInputPerMillion: pricingNumber((value as Record<string, unknown>).cacheCreation1hInputPerMillion),
            currency: typeof (value as Record<string, unknown>).currency === 'string'
              ? String((value as Record<string, unknown>).currency)
              : undefined,
          },
        ]),
    );
  } catch {
    return {};
  }
}

export function pricingForModel(
  pricing: Record<string, UsagePricing>,
  modelId: string | undefined,
): UsagePricing | undefined {
  if (!modelId) {
    return undefined;
  }
  return pricing[modelId] ?? Object.entries(pricing).find(([key]) => modelId.includes(key))?.[1];
}

function costOrUndefined(tokens: number, perMillion: number | undefined): number | undefined {
  if (tokens === 0) {
    return 0;
  }
  return perMillion === undefined ? undefined : (tokens / 1_000_000) * perMillion;
}

function addCosts(left: UsageCostBreakdown, right: UsageCostBreakdown): UsageCostBreakdown | undefined {
  if (left.currency !== right.currency) {
    return undefined;
  }
  return {
    currency: left.currency,
    uncachedInputCost: left.uncachedInputCost + right.uncachedInputCost,
    cacheCreationCost: left.cacheCreationCost + right.cacheCreationCost,
    cacheReadCost: left.cacheReadCost + right.cacheReadCost,
    inputCost: left.inputCost + right.inputCost,
    outputCost: left.outputCost + right.outputCost,
    totalCost: left.totalCost + right.totalCost,
  };
}

export function calculateTokenCosts(
  tokens: UsageTokenBreakdown,
  pricing: UsagePricing | undefined,
): UsageCostBreakdown | undefined {
  if (!pricing) {
    return undefined;
  }

  const uncachedInputCost = costOrUndefined(tokens.uncachedInputTokens, pricing.inputPerMillion);
  const outputCost = costOrUndefined(tokens.outputTokens, pricing.outputPerMillion);
  const cacheReadCost = costOrUndefined(tokens.cacheReadInputTokens, pricing.cacheReadInputPerMillion);
  if (uncachedInputCost === undefined || outputCost === undefined || cacheReadCost === undefined) {
    return undefined;
  }

  let cacheCreationCost: number | undefined;
  const ttlCacheCreationTokens = tokens.cacheCreation5mInputTokens + tokens.cacheCreation1hInputTokens;
  if (tokens.cacheCreationInputTokens === 0) {
    cacheCreationCost = 0;
  } else if (ttlCacheCreationTokens > 0) {
    const cacheCreation5mCost = costOrUndefined(tokens.cacheCreation5mInputTokens, pricing.cacheCreation5mInputPerMillion);
    const cacheCreation1hCost = costOrUndefined(tokens.cacheCreation1hInputTokens, pricing.cacheCreation1hInputPerMillion);
    const remainderTokens = Math.max(0, tokens.cacheCreationInputTokens - ttlCacheCreationTokens);
    const remainderCost = costOrUndefined(remainderTokens, pricing.cacheCreationInputPerMillion);
    if (cacheCreation5mCost === undefined || cacheCreation1hCost === undefined || remainderCost === undefined) {
      return undefined;
    }
    cacheCreationCost = cacheCreation5mCost + cacheCreation1hCost + remainderCost;
  } else {
    cacheCreationCost = costOrUndefined(tokens.cacheCreationInputTokens, pricing.cacheCreationInputPerMillion);
  }

  if (cacheCreationCost === undefined) {
    return undefined;
  }

  const inputCost = uncachedInputCost + cacheCreationCost + cacheReadCost;
  return {
    uncachedInputCost,
    cacheCreationCost,
    cacheReadCost,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: pricing.currency ?? 'USD',
  };
}

export function calculateUsageCosts(
  report: UsageReport,
  sessionModelId: string | undefined,
  pricing: Record<string, UsagePricing>,
): UsageCostBreakdown | undefined {
  if (report.modelUsage.length > 0) {
    let total: UsageCostBreakdown | undefined;
    for (const entry of report.modelUsage) {
      const costs = calculateTokenCosts(entry.tokens, pricingForModel(pricing, entry.model));
      if (!costs) {
        return undefined;
      }
      total = total ? addCosts(total, costs) : costs;
      if (!total) {
        return undefined;
      }
    }
    return total;
  }

  return calculateTokenCosts(report.tokens, pricingForModel(pricing, sessionModelId));
}
