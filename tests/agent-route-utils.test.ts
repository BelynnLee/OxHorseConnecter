import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Project } from '../packages/shared/src/types/control-plane.ts';
import {
  defaultModelSettingKey,
  generateTitle,
  isWorkbenchExecutorValue,
  normalizeExecutorType,
  normalizeMode,
  normalizePermissionMode,
  promptForMode,
  requireRegisteredProject,
} from '../apps/host/src/routes/agent-route-utils.ts';

function main(): void {
  assert.equal(defaultModelSettingKey('codex'), 'agent.defaultModel');
  assert.equal(defaultModelSettingKey('claude-code'), 'agent.defaultModel.claude-code');

  assert.equal(normalizeMode('plan'), 'plan');
  assert.equal(normalizeMode('review'), 'review');
  assert.equal(normalizeMode('other'), 'agent');

  assert.equal(normalizePermissionMode('readonly'), 'read-only');
  assert.equal(normalizePermissionMode('ask'), 'default');
  assert.equal(normalizePermissionMode('auto'), 'auto-review');
  assert.equal(normalizePermissionMode('dangerous_skip'), 'full-access');
  assert.equal(normalizePermissionMode('bad'), 'default');

  assert.equal(isWorkbenchExecutorValue('codex'), true);
  assert.equal(isWorkbenchExecutorValue('not-real'), false);
  assert.equal(normalizeExecutorType('claude-code'), 'claude-code');
  assert.equal(normalizeExecutorType('not-real'), 'codex');

  assert.equal(promptForMode('do work', 'agent', 'mock'), 'do work');
  assert.equal(promptForMode('do work', 'plan', 'codex'), 'do work');
  assert.match(promptForMode('do work', 'plan', 'mock'), /^Plan mode:/);
  assert.match(promptForMode('check diff', 'review', 'mock'), /^Review mode:/);

  assert.equal(generateTitle(''), 'Codex agent run');
  assert.equal(generateTitle('  hello   world  '), 'hello world');
  assert.equal(generateTitle('x'.repeat(80)), `${'x'.repeat(54)}...`);

  const tempDir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'rac-agent-route-')));
  try {
    const project: Project = {
      id: 'project-1',
      deviceId: 'device-1',
      name: 'test-project',
      path: tempDir,
      enabled: true,
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
    };
    const repo = {
      findById: (id: string) => (id === project.id ? project : undefined),
      findByDevicePath: (deviceId: string, projectPath: string) =>
        deviceId === project.deviceId && projectPath === project.path ? project : undefined,
      findByPath: (projectPath: string, deviceId = '') =>
        deviceId === '' && projectPath === project.path ? project : undefined,
    } as Parameters<typeof requireRegisteredProject>[0];

    assert.equal(
      requireRegisteredProject(repo, {
        deviceId: project.deviceId,
        projectPath: `${tempDir}${path.sep}.`,
      }).id,
      project.id
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
console.log('agent route utils tests passed');
