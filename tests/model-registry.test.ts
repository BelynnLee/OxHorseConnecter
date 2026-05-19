import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelRegistry } from '../apps/host/src/services/model-registry.ts';
import { createProviderRuntime } from '../apps/host/src/services/provider-runtime.ts';
import type { ExecutorRegistryConfig } from '../packages/executors/src/index.ts';

function createFakeCli(dir: string, name: string, source: string): string {
  const scriptPath = path.join(dir, `${name}.mjs`);
  writeFileSync(scriptPath, source, 'utf8');

  if (process.platform === 'win32') {
    const commandPath = path.join(dir, `${name}.cmd`);
    writeFileSync(
      commandPath,
      `@echo off\r\n"${process.execPath}" "%~dp0${name}.mjs" %*\r\n`,
      'utf8'
    );
    return commandPath;
  }

  const commandPath = path.join(dir, name);
  writeFileSync(
    commandPath,
    `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/${name}.mjs" "$@"\n`,
    'utf8'
  );
  chmodSync(commandPath, 0o755);
  return commandPath;
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'rac-model-registry-'));
const originalCwd = process.cwd();
const originalEnv = {
  CODEX_CONFIG_FILE: process.env.CODEX_CONFIG_FILE,
  CODEX_HOME: process.env.CODEX_HOME,
  CLAUDE_SETTINGS_FILE: process.env.CLAUDE_SETTINGS_FILE,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  RAC_DISABLE_CLAUDE_AGENT_SDK: process.env.RAC_DISABLE_CLAUDE_AGENT_SDK,
};

async function main() {
  process.chdir(tempDir);
  process.env.CODEX_CONFIG_FILE = path.join(tempDir, 'missing-codex-config.toml');
  process.env.CODEX_HOME = tempDir;
  process.env.CLAUDE_SETTINGS_FILE = path.join(tempDir, 'missing-claude-settings.json');
  process.env.HOME = tempDir;
  process.env.USERPROFILE = tempDir;
  process.env.RAC_DISABLE_CLAUDE_AGENT_SDK = '1';

  const codexCommand = createFakeCli(
    tempDir,
    'fake-codex',
    `
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('fake codex 1.0.0');
  process.exit(0);
}
if (args.join(' ') === 'debug models --bundled') {
  console.log(JSON.stringify({
    models: [
      {
        slug: 'gpt-cli-only',
        display_name: 'GPT CLI Only',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
        visibility: 'list'
      }
    ]
  }));
  process.exit(0);
}
console.error('unexpected codex args: ' + args.join(' '));
process.exit(2);
`
  );

  const claudeCommand = createFakeCli(
    tempDir,
    'fake-claude',
    `
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('fake claude 1.0.0');
  process.exit(0);
}
if (args[0] === '--help') {
  console.log('Usage: claude [options] [command]\\n\\nCommands:\\n  models     List available models');
  process.exit(0);
}
if (args.join(' ') === 'models list --json' || args.join(' ') === 'models --json') {
  console.log(JSON.stringify({
    models: [
      { id: 'claude-fake-cli-1', display_name: 'Claude Fake CLI' },
      { id: 'sonnet', display_name: 'Claude Code Sonnet Alias' }
    ]
  }));
  process.exit(0);
}
console.error('unexpected claude args: ' + args.join(' '));
process.exit(2);
`
  );

  const config: ExecutorRegistryConfig = {
    codexOptions: { command: codexCommand },
    claudeCodeOptions: { command: claudeCommand },
  };
  const registry = new ModelRegistry(config, { workingDirectory: tempDir, refreshTtlMs: 0 });
  assert.equal(
    registry.getDefault('codex').id,
    'gpt-5.4',
    'Codex fallback default should be a real model id'
  );
  assert.equal(
    registry.listForExecutor('codex').some((model) => model.id === 'codex-default'),
    false,
    'Codex should not expose a synthetic default model'
  );
  assert.equal(
    registry.listForExecutor('claude-code').find((model) => model.id === 'claude-code-default')
      ?.displayName,
    'Claude Code Default',
    'Claude Code default display name should use title case'
  );
  assert.equal(
    registry.listForExecutor('claude-code').find((model) => model.id === 'claude-code-sonnet')
      ?.displayName,
    'Claude Code Sonnet',
    'Claude Code alias display names should use title case'
  );
  assert.deepEqual(registry.getDefault('codex').supportedReasoningEfforts, [
    'low',
    'medium',
    'high',
    'xhigh',
  ]);
  await registry.refresh({ force: true });

  const codexModels = registry.listForExecutor('codex');
  assert.ok(
    codexModels.some((model) => model.id === 'gpt-cli-only'),
    'Codex CLI models should be listed'
  );
  assert.equal(
    codexModels.some((model) => model.id === 'gpt-5.5'),
    false,
    'Codex static catalog should be fallback-only after CLI refresh'
  );
  assert.equal(
    codexModels.some((model) => model.id === 'codex-default'),
    false,
    'Codex CLI default should not be listed as a model'
  );
  assert.equal(
    codexModels.find((model) => model.id === 'gpt-cli-only')?.supportsReasoningEffort,
    true
  );

  const claudeModels = registry.listForExecutor('claude-code');
  assert.ok(
    claudeModels.some((model) => model.id === 'claude-fake-cli-1'),
    'Claude Code CLI models should be listed'
  );
  assert.ok(
    claudeModels.some((model) => model.id === 'claude-code-sonnet'),
    'Claude Code CLI aliases should stay selectable'
  );
  assert.equal(
    claudeModels.some((model) => model.id === 'claude-code-opus'),
    false,
    'Claude Code static aliases should be fallback-only after CLI refresh'
  );

  const codexNativeCommand = createFakeCli(
    tempDir,
    'fake-codex-native',
    `
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('fake codex native 1.0.0');
  process.exit(0);
}
if (args[0] === 'app-server') {
  let buffer = '';
  process.stdin.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\\r?\\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        console.log(JSON.stringify({ id: message.id, result: { capabilities: {} } }));
      }
      if (message.method === 'model/list') {
        console.log(JSON.stringify({
          id: message.id,
          result: {
            models: [
              {
                id: 'gpt-native-only',
                displayName: 'GPT Native Only',
                isDefault: true,
                defaultReasoningEffort: 'medium',
                supportedEffortLevels: ['medium', 'xhigh']
              }
            ]
          }
        }));
        setTimeout(() => process.exit(0), 20);
      }
    }
  });
} else if (args.join(' ') === 'debug models --bundled') {
  console.log(JSON.stringify({ models: [{ slug: 'gpt-cli-should-not-win' }] }));
  process.exit(0);
} else {
  console.error('unexpected native codex args: ' + args.join(' '));
  process.exit(2);
}
`
  );

  const nativeRegistry = new ModelRegistry(
    { codexOptions: { command: codexNativeCommand } },
    { workingDirectory: tempDir, refreshTtlMs: 0 }
  );
  await nativeRegistry.refresh({ force: true });
  const nativeCodexModels = nativeRegistry.listForExecutor('codex');
  assert.ok(
    nativeCodexModels.some((model) => model.id === 'gpt-native-only'),
    'Codex app-server model/list should be the preferred source'
  );
  assert.equal(
    nativeCodexModels.some((model) => model.id === 'gpt-cli-should-not-win'),
    false,
    'Codex CLI model list should not override app-server models'
  );
  assert.deepEqual(
    nativeCodexModels.find((model) => model.id === 'gpt-native-only')?.supportedReasoningEfforts,
    ['medium', 'xhigh']
  );
  assert.equal(
    nativeRegistry.getDefault('codex').id,
    'gpt-native-only',
    'Codex app-server isDefault should select the provider default model'
  );
  assert.equal(
    nativeRegistry.getDefault('codex').defaultReasoningEffort,
    'medium',
    'Codex app-server defaultReasoningEffort should be preserved for UI selectors'
  );
  assert.equal(
    nativeCodexModels.find((model) => model.id === 'gpt-native-only')?.catalogSource,
    'provider',
    'Codex app-server model/list should be marked as provider catalog data'
  );

  const noisyNativeCommand = createFakeCli(
    tempDir,
    'fake-codex-noisy-native',
    `
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('fake codex noisy native 1.0.0');
  process.exit(0);
}
if (args[0] === 'app-server') {
  let remaining = 512;
  const chunk = 'startup diagnostic '.repeat(256);
  function setupRpc() {
    let buffer = '';
    process.stdin.on('data', (input) => {
      buffer += input.toString();
      const lines = buffer.split(/\\r?\\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          console.log(JSON.stringify({ id: message.id, result: { capabilities: {} } }));
        }
        if (message.method === 'model/list') {
          console.log(JSON.stringify({
            id: message.id,
            result: { models: [{ id: 'gpt-noisy-native', displayName: 'GPT Noisy Native' }] }
          }));
          setTimeout(() => process.exit(0), 20);
        }
      }
    });
  }
  function writeDiagnostics() {
    while (remaining > 0) {
      remaining -= 1;
      if (!process.stderr.write(chunk)) {
        process.stderr.once('drain', writeDiagnostics);
        return;
      }
    }
    setupRpc();
  }
  writeDiagnostics();
} else {
  console.error('unexpected noisy native codex args: ' + args.join(' '));
  process.exit(2);
}
`
  );
  const noisyRuntime = createProviderRuntime(
    'codex',
    { codexOptions: { command: noisyNativeCommand } },
    tempDir
  );
  const noisyModels = await noisyRuntime.listModels();
  assert.equal(
    noisyModels.some((model) => model.id === 'gpt-noisy-native'),
    true,
    'Codex app-server stderr diagnostics should not block initialize/model-list'
  );

  console.log('model registry native/CLI tests passed');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  });
