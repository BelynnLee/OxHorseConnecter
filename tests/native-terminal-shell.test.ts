import assert from 'node:assert/strict';
import { resolveShellCommand } from '../apps/host/src/services/native-terminal-shell.ts';

assert.deepEqual(
  resolveShellCommand({
    platform: 'win32',
    commandExists: (command) => command === 'pwsh.exe',
  }),
  { file: 'pwsh.exe', args: ['-NoLogo'], label: 'PowerShell' }
);

assert.deepEqual(
  resolveShellCommand({
    platform: 'win32',
    commandExists: (command) => command === 'powershell.exe',
  }),
  { file: 'powershell.exe', args: ['-NoLogo'], label: 'Windows PowerShell' }
);

assert.deepEqual(
  resolveShellCommand({
    platform: 'win32',
    commandExists: () => false,
  }),
  { file: 'cmd.exe', args: [], label: 'Command Prompt' }
);

assert.deepEqual(
  resolveShellCommand({
    platform: 'linux',
    env: { SHELL: '/usr/bin/fish' },
    commandExists: (command) => command === '/usr/bin/fish',
  }),
  { file: '/usr/bin/fish', args: [], label: 'fish' }
);

assert.deepEqual(
  resolveShellCommand({
    platform: 'darwin',
    env: {},
    commandExists: (command) => command === '/bin/bash',
  }),
  { file: '/bin/bash', args: [], label: 'bash' }
);

assert.deepEqual(
  resolveShellCommand({
    platform: 'linux',
    env: {},
    commandExists: () => false,
  }),
  { file: '/bin/sh', args: [], label: 'sh' }
);

console.log('native terminal shell tests passed');
