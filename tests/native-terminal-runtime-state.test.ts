import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseCodexPermissionMode,
  parseTopLevelTomlString,
  readCodexRuntimeState,
  runtimeStateSignature,
} from '../apps/host/src/services/native-terminal-runtime-state.ts';

assert.equal(
  parseTopLevelTomlString('model = "gpt-5.4"\n[profiles.default]\nmodel = "ignored"', 'model'),
  'gpt-5.4'
);
assert.equal(
  parseTopLevelTomlString('# comment\nsandbox_mode = "read-only"', 'sandbox_mode'),
  'read-only'
);
assert.equal(parseCodexPermissionMode('danger_full_access'), 'full-access');
assert.equal(parseCodexPermissionMode('workspace-write'), 'default');
assert.equal(parseCodexPermissionMode('unknown'), undefined);

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'rac-native-runtime-'));
const previousConfig = process.env.CODEX_CONFIG_FILE;
try {
  const globalConfig = path.join(tempRoot, 'config.toml');
  const cwd = path.join(tempRoot, 'project');
  mkdirSync(path.join(cwd, '.codex'), { recursive: true });
  writeFileSync(
    globalConfig,
    [
      'model = "gpt-global"',
      'model_reasoning_effort = "high"',
      'sandbox_mode = "danger-full-access"',
      'approval_policy = "never"',
    ].join('\n')
  );
  writeFileSync(
    path.join(cwd, '.codex', 'config.toml'),
    ['model = "gpt-project"', 'service_tier = "fast"', 'permission_profile = "auto-review"'].join(
      '\n'
    )
  );
  process.env.CODEX_CONFIG_FILE = globalConfig;

  const state = readCodexRuntimeState(cwd);
  assert.deepEqual(state, {
    modelId: 'gpt-project',
    reasoningEffort: 'high',
    permissionMode: 'auto-review',
    runtimeOptions: { serviceTier: 'fast' },
  });
  assert.equal(
    runtimeStateSignature(state),
    '{"modelId":"gpt-project","reasoningEffort":"high","permissionMode":"auto-review","runtimeOptions":{"serviceTier":"fast"}}'
  );
} finally {
  if (previousConfig === undefined) {
    delete process.env.CODEX_CONFIG_FILE;
  } else {
    process.env.CODEX_CONFIG_FILE = previousConfig;
  }
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('native terminal runtime-state tests passed');
