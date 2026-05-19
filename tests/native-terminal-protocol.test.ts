import assert from 'node:assert/strict';
import {
  parseClientMessage,
  parseRemoteWorkerMessage,
} from '../apps/host/src/services/native-terminal-protocol.ts';

const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

assert.deepEqual(parseClientMessage(encode({ type: 'input', data: 'pwd\n' })), {
  type: 'input',
  data: 'pwd\n',
});
assert.deepEqual(parseClientMessage(encode({ type: 'resize', cols: 120, rows: 40 })), {
  type: 'resize',
  cols: 120,
  rows: 40,
});
assert.equal(parseClientMessage(encode({ type: 'resize', cols: '120', rows: 40 })), null);

assert.deepEqual(
  parseRemoteWorkerMessage(
    encode({
      type: 'ready',
      terminalId: 'term-shell',
      provider: 'shell',
      cwd: 'E:/ox',
      cols: 80,
      rows: 24,
      args: [],
    })
  ),
  {
    type: 'ready',
    terminalId: 'term-shell',
    provider: 'shell',
    cwd: 'E:/ox',
    cols: 80,
    rows: 24,
    args: [],
  }
);

assert.deepEqual(
  parseRemoteWorkerMessage(
    encode({
      type: 'state',
      terminalId: 'term-1',
      state: {
        modelId: 'gpt-5.4',
        reasoningEffort: 'high',
        permissionMode: 'full-access',
        runtimeOptions: { serviceTier: 'fast', ignored: true },
      },
    })
  ),
  {
    type: 'state',
    terminalId: 'term-1',
    state: {
      modelId: 'gpt-5.4',
      reasoningEffort: 'high',
      permissionMode: 'full-access',
      runtimeOptions: { serviceTier: 'fast' },
    },
  }
);

assert.equal(
  parseRemoteWorkerMessage(
    encode({
      type: 'ready',
      terminalId: 'term-1',
      provider: 'bad-provider',
      cwd: 'E:/ox',
      cols: 80,
      rows: 24,
      args: [],
    })
  ),
  null
);

console.log('native terminal protocol tests passed');
