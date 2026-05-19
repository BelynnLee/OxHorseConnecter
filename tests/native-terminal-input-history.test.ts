import assert from 'node:assert/strict';
import {
  appendTerminalHistory,
  recordTerminalInputLines,
  shouldMirrorTerminalSlashCommand,
  slashCommandName,
  stripTerminalInputControls,
} from '../apps/host/src/services/native-terminal-input-history.ts';

assert.equal(stripTerminalInputControls('\x1b[31m/model gpt\x1b[0m'), '/model gpt');
assert.equal(slashCommandName('/permissions full-access'), 'permissions');
assert.equal(slashCommandName(' permissions'), undefined);
assert.equal(shouldMirrorTerminalSlashCommand('/fast'), true);
assert.equal(shouldMirrorTerminalSlashCommand('/help'), false);

const session = { linkedSessionId: 'session-1', inputBuffer: '' };
assert.deepEqual(recordTerminalInputLines(session, '/model gpt-5'), []);
assert.equal(session.inputBuffer, '/model gpt-5');
assert.deepEqual(recordTerminalInputLines(session, '\b4\n'), ['/model gpt-4']);
assert.equal(session.inputBuffer, '');

assert.deepEqual(recordTerminalInputLines(session, '/fast\x15ignored\n'), ['ignored']);
assert.equal(appendTerminalHistory('abc', 'def', 10), 'abcdef');
assert.equal(appendTerminalHistory('0123456789', 'abcdef', 8), '89abcdef');

console.log('native terminal input/history tests passed');
