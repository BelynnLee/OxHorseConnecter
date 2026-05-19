import assert from 'node:assert/strict';
import {
  claudeCodeEventLabel,
  extractClaudeCodeAssistantText,
  extractClaudeCodeSessionId,
  extractClaudeCodeToolProjections,
  extractClaudeCodeUsage,
} from '../packages/executors/src/claude-code-stream-parser.ts';

function main(): void {
  assert.equal(claudeCodeEventLabel({ type: 'system', subtype: 'init' }), 'system/init');
  assert.equal(claudeCodeEventLabel({ type: 'assistant' }), 'assistant');

  assert.equal(
    extractClaudeCodeSessionId({
      type: 'system',
      subtype: 'init',
      session_id: 'claude-session-1',
    }),
    'claude-session-1'
  );
  assert.equal(extractClaudeCodeSessionId({ type: 'assistant', session_id: 'ignored' }), undefined);

  assert.deepEqual(
    extractClaudeCodeUsage({
      type: 'result',
      usage: { input_tokens: 10, output_tokens: 5 },
      model_usage: { model: 'claude-test' },
      total_cost_usd: 0.002,
    }),
    {
      usage: { input_tokens: 10, output_tokens: 5 },
      model_usage: { model: 'claude-test' },
      total_cost_usd: 0.002,
    }
  );
  assert.equal(extractClaudeCodeUsage({ type: 'assistant' }), undefined);

  assert.deepEqual(
    extractClaudeCodeToolProjections(
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pnpm test' } },
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'ok',
              is_error: false,
            },
            {
              type: 'tool_result',
              tool_use_id: 'tool-2',
              content: { error: 'bad' },
              is_error: true,
            },
          ],
        },
      },
      'task-1'
    ),
    {
      toolCalls: [
        {
          tool: 'Bash',
          action: '{"command":"pnpm test"}',
          inputSummary: '{"command":"pnpm test"}',
          command: '{"command":"pnpm test"}',
          status: 'running',
          toolRunId: 'tool-1',
          level: 'info',
        },
        {
          tool: 'tool',
          action: 'completed',
          inputSummary: 'Claude Code tool result.',
          status: 'completed',
          toolRunId: 'tool-1',
          level: 'info',
        },
        {
          tool: 'tool',
          action: 'failed',
          inputSummary: 'Claude Code tool result.',
          status: 'failed',
          toolRunId: 'tool-2',
          level: 'error',
        },
      ],
      logs: [
        { message: 'ok', stream: 'stdout', toolRunId: 'tool-1', level: 'info' },
        { message: '{"error":"bad"}', stream: 'stderr', toolRunId: 'tool-2', level: 'warn' },
      ],
    }
  );

  assert.deepEqual(
    extractClaudeCodeAssistantText({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash' },
          { type: 'text', text: 'world' },
        ],
        stop_reason: 'end_turn',
      },
    }),
    { text: 'hello world', isFinal: true }
  );
}

main();
console.log('claude-code stream parser tests passed');
