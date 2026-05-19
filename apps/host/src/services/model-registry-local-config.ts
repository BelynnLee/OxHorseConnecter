import os from 'node:os';
import path from 'node:path';
import {
  codexConfigPath,
  parseTopLevelTomlString,
  safeReadText,
} from './native-terminal-runtime-state.js';
import { unique } from './model-registry-profiles.js';

export interface LocalModelConfig {
  codexModel?: string;
  codexProvider?: string;
  claudeModel?: string;
  claudeAvailableModels: string[];
}

function safeReadJson(filePath: string): unknown {
  const text = safeReadText(filePath);
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function valuesFromJsonArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
        .map((entry) => entry.trim())
    : [];
}

export function readLocalModelConfig(workingDirectory?: string | null): LocalModelConfig {
  const home = os.homedir();
  const codexConfig = safeReadText(codexConfigPath());

  const claudeSettingsPaths = unique([
    process.env.CLAUDE_SETTINGS_FILE,
    path.join(home, '.claude', 'settings.json'),
    workingDirectory ? path.join(workingDirectory, '.claude', 'settings.json') : undefined,
    workingDirectory ? path.join(workingDirectory, '.claude', 'settings.local.json') : undefined,
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.local.json'),
  ].filter((entry): entry is string => Boolean(entry)));

  let claudeModel: string | undefined;
  const claudeAvailableModels: string[] = [];
  for (const settingsPath of claudeSettingsPaths) {
    const settings = safeReadJson(settingsPath);
    if (!settings || typeof settings !== 'object') {
      continue;
    }
    const record = settings as Record<string, unknown>;
    if (typeof record.model === 'string' && record.model.trim()) {
      claudeModel = record.model.trim();
    }
    claudeAvailableModels.push(...valuesFromJsonArray(record.availableModels));
  }

  return {
    codexModel: parseTopLevelTomlString(codexConfig, 'model'),
    codexProvider: parseTopLevelTomlString(codexConfig, 'model_provider'),
    claudeModel,
    claudeAvailableModels: unique(claudeAvailableModels),
  };
}
