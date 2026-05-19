import assert from 'node:assert/strict';
import {
  buildNativeMutationRawInput,
  normalizeNativeMutationCommand,
} from '../apps/host/src/routes/agent-native-routes.ts';

function main(): void {
  assert.equal(normalizeNativeMutationCommand(' MCP '), 'mcp');
  assert.equal(normalizeNativeMutationCommand('plugin'), 'plugin');
  assert.equal(normalizeNativeMutationCommand('plugins'), 'plugins');
  assert.equal(normalizeNativeMutationCommand('auth'), undefined);

  assert.equal(
    buildNativeMutationRawInput('codex', 'mcp', 'add server -- node server.js'),
    '/wb:codex mcp add server -- node server.js'
  );
  assert.equal(
    buildNativeMutationRawInput('claude-code', 'plugin', 'install test-plugin'),
    '/wb:claude plugin install test-plugin'
  );
  assert.equal(buildNativeMutationRawInput('codex', 'plugins', ''), '/wb:codex plugins');
}

main();
console.log('agent native routes tests passed');
