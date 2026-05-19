import assert from 'node:assert/strict';
import {
  codexEventName,
  collectText,
  extractAssistantCompletedText,
  extractAssistantDelta,
  extractCodexSessionId,
  extractCodexUsagePayload,
  extractPlanOrStep,
  extractToolEvent,
  extractToolOutput,
  flushBufferedLines,
} from '../packages/executors/src/codex-event-parser.ts';

function main(): void {
  assert.equal(
    codexEventName({ method: 'response.output_text.delta' }),
    'response.output_text.delta'
  );
  assert.equal(codexEventName({ payload: { type: 'thread.created' } }), 'thread.created');

  assert.equal(
    extractCodexSessionId({
      type: 'thread.created',
      payload: { thread_id: '11111111-2222-3333-4444-555555555555' },
    }),
    '11111111-2222-3333-4444-555555555555'
  );
  assert.equal(
    extractCodexSessionId({ type: 'thread.created', payload: { thread_id: 'not-a-uuid' } }),
    undefined
  );

  assert.equal(
    extractAssistantDelta({
      type: 'response.output_text.delta',
      payload: { delta: 'hello' },
    }),
    'hello'
  );
  assert.equal(
    extractAssistantCompletedText({
      method: 'item.completed',
      params: {
        item: {
          type: 'agent_message',
          content: [{ type: 'output_text', text: 'final' }],
        },
      },
    }),
    'final'
  );
  assert.equal(
    collectText([{ text: 'A' }, { content: [{ text: 'B' }] }, { output_text: 'C' }]),
    'ABC'
  );

  assert.deepEqual(
    extractToolEvent({
      method: 'item.command_execution.completed',
      params: {
        item: {
          id: 'tool-1',
          type: 'command_execution',
          command: 'pnpm test',
          status: 'completed',
          exit_code: 0,
        },
      },
    }),
    {
      id: 'tool-1',
      name: 'shell',
      command: 'pnpm test',
      status: 'completed',
      exitCode: 0,
    }
  );
  assert.deepEqual(
    extractToolEvent({
      method: 'item.command_execution.completed',
      params: {
        item: {
          id: 'tool-2',
          type: 'command_execution',
          command: 'pnpm test',
          status: 'completed',
          exit_code: 1,
        },
      },
    })?.status,
    'failed'
  );
  assert.deepEqual(
    extractToolOutput({
      method: 'item.command_execution.stderr',
      params: {
        item: {
          id: 'tool-1',
          type: 'command_execution',
          stderr: 'bad output',
          stream: 'stderr',
        },
      },
    }),
    { id: 'tool-1', stream: 'stderr', delta: 'bad output' }
  );

  assert.deepEqual(
    extractPlanOrStep({
      type: 'plan.updated',
      payload: {
        explanation: 'Plan',
        plan: [
          { step: 'Inspect code', status: 'completed' },
          { step: 'Patch parser', status: 'in_progress' },
        ],
      },
    }),
    {
      title: 'Plan updated',
      message: 'Plan\nInspect code (completed)\nPatch parser (in_progress)',
    }
  );
  assert.deepEqual(
    extractCodexUsagePayload({
      type: 'usage.updated',
      payload: {
        usage: { input_tokens: 10, output_tokens: 5 },
        model_usage: { model: 'gpt-test' },
        total_cost_usd: 0.001,
      },
    }),
    {
      usage: { input_tokens: 10, output_tokens: 5 },
      model_usage: { model: 'gpt-test' },
      total_cost_usd: 0.001,
    }
  );

  const emitted: string[] = [];
  const remainder = flushBufferedLines('one\r\n two \npartial', (line) => emitted.push(line));
  assert.deepEqual(emitted, ['one', 'two']);
  assert.equal(remainder, 'partial');
}

main();
console.log('codex event parser tests passed');
