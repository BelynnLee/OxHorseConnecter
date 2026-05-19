import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { config } from '../config.js';
import type Database from 'better-sqlite3';

const analyzeFailureSchema = z.object({
  sessionId: z.string().min(1).optional(),
  logs: z.string().optional(),
  error: z.string().optional(),
});

interface LocalClassificationEntry {
  reason: string;
  occurrences: number;
  sources: string[];
  evidence: Array<{ source: string; snippet: string }>;
}

const FAILURE_PATTERNS: Array<{ reason: string; patterns: string[] }> = [
  { reason: 'permission_denied', patterns: ['permission denied', 'eacces', 'operation not permitted', 'policy denied'] },
  { reason: 'approval_rejected', patterns: ['approval rejected', 'approval denied', 'user rejected'] },
  { reason: 'timeout', patterns: ['timeout', 'timed out', 'deadline exceeded', 'etimedout'] },
  { reason: 'network_error', patterns: ['econnrefused', 'econnreset', 'enotfound', 'fetch failed', 'socket hang up'] },
  { reason: 'missing_file_or_command', patterns: ['enoent', 'no such file', 'command not found'] },
  { reason: 'model_error', patterns: ['rate limit', 'invalid_api_key', 'context length', 'tokens exceeded'] },
  { reason: 'diff_conflict', patterns: ['merge conflict', 'patch does not apply'] },
  { reason: 'agent_process_error', patterns: ['exit code', 'killed', 'sigterm', 'sigkill'] },
  { reason: 'command_failed', patterns: ['non-zero exit', 'command failed'] },
];

function localAnalyze(sessionId: string | undefined, text: string): Record<string, unknown> {
  const lowered = text.toLowerCase();
  const classification: LocalClassificationEntry[] = [];
  for (const { reason, patterns } of FAILURE_PATTERNS) {
    const evidence = patterns
      .filter((pattern) => lowered.includes(pattern))
      .map((pattern) => ({ source: 'logs', snippet: pattern }));
    if (evidence.length > 0) {
      classification.push({ reason, occurrences: evidence.length, sources: ['logs'], evidence });
    }
  }
  if (classification.length === 0) {
    classification.push({ reason: 'unknown', occurrences: 1, sources: ['logs'], evidence: [] });
  }
  const primaryReason = classification[0].reason;
  return {
    sessionId,
    primaryReason,
    likelyCauses: classification.map((entry) => entry.reason),
    classification,
    summary: text.slice(0, 1000),
    source: 'host-fallback',
  };
}

function recentSessionLogs(db: Database.Database, sessionId: string): string {
  const rows = db
    .prepare(
      `SELECT eventType, delta, payload, createdAt
       FROM session_stream_events
       WHERE sessionId = ?
       ORDER BY seq DESC, createdAt DESC
       LIMIT 200`,
    )
    .all(sessionId) as Array<{ eventType: string; delta: string | null; payload: string; createdAt: string }>;
  return rows
    .reverse()
    .map((row) => `${row.createdAt} ${row.eventType} ${row.delta ?? row.payload}`)
    .join('\n');
}

function recentFailedCommands(db: Database.Database, sessionId: string): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT command, exitCode, stdoutPreview AS stdout, stderrPreview AS stderr
       FROM agent_commands
       WHERE sessionId = ? AND exitCode IS NOT NULL AND exitCode <> 0
       ORDER BY startedAt DESC
       LIMIT 20`,
    )
    .all(sessionId) as Array<Record<string, unknown>>;
}

function recentFailureEvents(db: Database.Database, sessionId: string): Array<Record<string, unknown>> {
  const rows = db
    .prepare(
      `SELECT type, payload
       FROM agent_events
       WHERE sessionId = ? AND (type LIKE '%failed%' OR type = 'error')
       ORDER BY seq DESC, createdAt DESC
       LIMIT 20`,
    )
    .all(sessionId) as Array<{ type: string; payload: string }>;
  return rows.map((row) => {
    let payload: unknown = row.payload;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      // keep as raw string
    }
    return { type: row.type, payload };
  });
}

export function createFailureAnalysisRouter(db: Database.Database): Router {
  const router = Router();
  router.use(authMiddleware);

  router.post('/analyze', async (req, res) => {
    const parsed = analyzeFailureSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'Invalid failure analysis payload', details: parsed.error.flatten() });
      return;
    }

    const logs = parsed.data.logs ?? (
      parsed.data.sessionId ? recentSessionLogs(db, parsed.data.sessionId) : ''
    );
    const commands = parsed.data.sessionId ? recentFailedCommands(db, parsed.data.sessionId) : [];
    const events = parsed.data.sessionId ? recentFailureEvents(db, parsed.data.sessionId) : [];
    const body = {
      sessionId: parsed.data.sessionId,
      logs,
      error: parsed.data.error,
      commands,
      events,
    };

    try {
      const response = await fetch(new URL('/analyze/failure', config.aiServiceUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`AI service returned ${response.status}.`);
      }
      res.json({ ok: true, data: await response.json() });
    } catch {
      res.json({ ok: true, data: localAnalyze(parsed.data.sessionId, [parsed.data.error, logs].filter(Boolean).join('\n')) });
    }
  });

  return router;
}
