import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProviderSessionHistoryService } from '../apps/host/src/services/provider-session-history.ts';

const previousCodexHome = process.env.CODEX_HOME;
const previousClaudeHome = process.env.CLAUDE_HOME;
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'rac-provider-history-'));

try {
  const codexHome = path.join(tempRoot, 'codex');
  const claudeHome = path.join(tempRoot, 'claude');
  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_HOME = claudeHome;

  const codexSessionDir = path.join(codexHome, 'sessions', '2026', '05', '13');
  mkdirSync(codexSessionDir, { recursive: true });
  mkdirSync(path.join(claudeHome, 'projects', 'E--work'), { recursive: true });

  writeFileSync(
    path.join(codexHome, 'session_index.jsonl'),
    [
      JSON.stringify({
        id: 'codex-session-1',
        thread_name: 'Codex indexed title',
        updated_at: '2026-05-13T08:30:00.000Z',
      }),
      '',
    ].join('\n')
  );
  writeFileSync(
    path.join(codexSessionDir, 'rollout-2026-05-13T08-00-00-codex-session-1.jsonl'),
    [
      JSON.stringify({
        timestamp: '2026-05-13T08:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'codex-session-1',
          timestamp: '2026-05-13T08:00:00.000Z',
          cwd: 'E:\\work',
        },
      }),
      JSON.stringify({
        timestamp: '2026-05-13T08:01:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Inspect the project' },
      }),
      JSON.stringify({
        timestamp: '2026-05-13T08:01:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'text', text: 'Inspect the project' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-05-13T08:01:30.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'text',
              text: '<turn_aborted>\nThe user interrupted the previous turn on purpose.\n</turn_aborted>',
            },
          ],
        },
      }),
      JSON.stringify({
        timestamp: '2026-05-13T08:02:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Project inspected.' }],
        },
      }),
      '',
    ].join('\n')
  );

  const claudeSessionPath = path.join(
    claudeHome,
    'projects',
    'E--work',
    'claude-session-1.jsonl'
  );
  writeFileSync(
    claudeSessionPath,
    [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-05-13T09:00:00.000Z',
        cwd: 'E:\\work',
        sessionId: 'claude-session-1',
        message: { role: 'user', content: 'Review the diff' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-13T09:01:00.000Z',
        cwd: 'E:\\work',
        sessionId: 'claude-session-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'No findings.' }] },
      }),
      '',
    ].join('\n')
  );

  const service = new ProviderSessionHistoryService();
  const sessions = service.list({ limit: 10 });

  assert.deepEqual(
    sessions.map((session) => session.provider),
    ['claude-code', 'codex']
  );
  assert.equal(sessions[0].title, 'Review the diff');
  assert.equal(sessions[1].title, 'Codex indexed title');

  const codexDetail = service.getDetail(sessions[1].id);
  assert.equal(codexDetail?.session.executorType, 'codex');
  assert.deepEqual(
    codexDetail?.messages.map((message) => [message.role, message.content]),
    [
      ['user', 'Inspect the project'],
      ['assistant', 'Project inspected.'],
    ]
  );

  const claudeDetail = service.getDetail(sessions[0].id);
  assert.equal(claudeDetail?.session.executorType, 'claude-code');
  assert.deepEqual(
    claudeDetail?.messages.map((message) => [message.role, message.content]),
    [
      ['user', 'Review the diff'],
      ['assistant', 'No findings.'],
    ]
  );
} finally {
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  if (previousClaudeHome === undefined) delete process.env.CLAUDE_HOME;
  else process.env.CLAUDE_HOME = previousClaudeHome;
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('provider session history tests passed');
