import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assessFilePathRisk } from '@rac/security';
import type {
  ProviderConfigFile,
  ProviderConfigFileWriteInput,
  ProviderConfigProvider,
  ProviderConfigScope,
  ProviderFileFormat,
  ProviderFileKind,
} from '@rac/shared';
import { config } from '../config.js';

const MAX_PROVIDER_CONFIG_BYTES = 512 * 1024;

export interface ProviderFileReadInput {
  provider: ProviderConfigProvider;
  scope: ProviderConfigScope;
  kind: ProviderFileKind;
  projectPath?: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isoMtime(filePath: string): string | undefined {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function safeRead(filePath: string): { exists: boolean; content: string; updatedAt?: string } {
  try {
    return {
      exists: true,
      content: fs.readFileSync(filePath, 'utf8'),
      updatedAt: isoMtime(filePath),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, content: '' };
    }
    throw error;
  }
}

function defaultContent(format: ProviderFileFormat, kind: ProviderFileKind): string {
  if (format === 'toml') return '';
  return kind === 'hooks' ? '{\n  "hooks": {}\n}\n' : '{\n}\n';
}

function assertProjectPath(projectPath: string | undefined, scope: ProviderConfigScope): string {
  if (!projectPath || !projectPath.trim()) {
    throw new Error(`${scope} provider configuration requires a project path.`);
  }

  const requestedProjectPath = projectPath.trim();
  const baseDir = config.allowedWorkDir ? path.resolve(config.allowedWorkDir) : process.cwd();
  const resolved = path.isAbsolute(requestedProjectPath)
    ? path.resolve(requestedProjectPath)
    : path.resolve(baseDir, requestedProjectPath);
  if (config.allowedWorkDir) {
    const risk = assessFilePathRisk(resolved, config.allowedWorkDir);
    if (risk.level === 'critical') {
      throw new Error(risk.reason);
    }
  }
  return resolved;
}

function codexHome(): string {
  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), '.codex');
}

function codexConfigPath(scope: ProviderConfigScope, projectPath?: string): string {
  if (scope === 'local') {
    throw new Error('Codex does not expose a separate local config scope; use user or project.');
  }
  if (scope === 'project') {
    return path.join(assertProjectPath(projectPath, scope), '.codex', 'config.toml');
  }
  return process.env.CODEX_CONFIG_FILE
    ? path.resolve(process.env.CODEX_CONFIG_FILE)
    : path.join(codexHome(), 'config.toml');
}

function codexHooksPath(scope: ProviderConfigScope, projectPath?: string): string {
  if (scope === 'local') {
    throw new Error('Codex hooks are read from the user or trusted project Codex config layer.');
  }
  if (scope === 'project') {
    return path.join(assertProjectPath(projectPath, scope), '.codex', 'hooks.json');
  }
  return path.join(codexHome(), 'hooks.json');
}

function claudeSettingsPath(scope: ProviderConfigScope, projectPath?: string): string {
  if (scope === 'user') {
    return process.env.CLAUDE_SETTINGS_FILE
      ? path.resolve(process.env.CLAUDE_SETTINGS_FILE)
      : path.join(os.homedir(), '.claude', 'settings.json');
  }
  const project = assertProjectPath(projectPath, scope);
  return path.join(project, '.claude', scope === 'local' ? 'settings.local.json' : 'settings.json');
}

function resolveProviderFile(input: ProviderFileReadInput): { path: string; format: ProviderFileFormat } {
  if (input.provider === 'codex') {
    return input.kind === 'hooks'
      ? { path: codexHooksPath(input.scope, input.projectPath), format: 'json' }
      : { path: codexConfigPath(input.scope, input.projectPath), format: 'toml' };
  }

  if (input.provider === 'claude-code') {
    return { path: claudeSettingsPath(input.scope, input.projectPath), format: 'json' };
  }

  throw new Error(`Unsupported provider: ${String(input.provider)}`);
}

function validateJsonContent(content: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Provider JSON configuration must be an object.');
  }
}

function validateContent(file: Pick<ProviderConfigFile, 'format' | 'kind'>, content: string): void {
  const size = Buffer.byteLength(content, 'utf8');
  if (size > MAX_PROVIDER_CONFIG_BYTES) {
    throw new Error(`Provider configuration is too large (${size} bytes).`);
  }
  if (content.includes('\u0000')) {
    throw new Error('Provider configuration cannot contain NUL bytes.');
  }
  if (file.format === 'json') {
    validateJsonContent(content || '{}');
  }
}

function backupPath(filePath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${filePath}.rac-backup-${stamp}`;
}

export class ProviderConfigService {
  readProviderFile(input: ProviderFileReadInput): ProviderConfigFile {
    const resolved = resolveProviderFile(input);
    const loaded = safeRead(resolved.path);
    const content = loaded.exists ? loaded.content : defaultContent(resolved.format, input.kind);
    return {
      provider: input.provider,
      scope: input.scope,
      kind: input.kind,
      format: resolved.format,
      path: resolved.path,
      exists: loaded.exists,
      content,
      hash: sha256(content),
      updatedAt: loaded.updatedAt,
    };
  }

  writeProviderFile(input: ProviderConfigFileWriteInput): ProviderConfigFile {
    if (input.confirm !== true) {
      throw new Error('Provider configuration writes require explicit confirmation.');
    }

    const current = this.readProviderFile(input);
    if (current.hash !== input.expectedHash) {
      throw new Error('Provider configuration changed on disk. Reload before saving.');
    }

    validateContent(current, input.content);
    fs.mkdirSync(path.dirname(current.path), { recursive: true });

    if (current.exists && current.content !== input.content) {
      fs.copyFileSync(current.path, backupPath(current.path));
    }
    fs.writeFileSync(current.path, input.content, 'utf8');

    return this.readProviderFile(input);
  }
}
