import fs from 'node:fs';
import path from 'node:path';
import type { RiskLevel } from './risk.js';

export interface RiskRule {
  pattern: string;
  flags?: string;
  level: RiskLevel;
  reason: string;
}

export interface RiskRuleConfig {
  commandRules: RiskRule[];
  pathRules: RiskRule[];
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical';
}

function normalizeRule(rule: unknown, groupName: string): RiskRule {
  if (!rule || typeof rule !== 'object') {
    throw new Error(`Invalid ${groupName} rule: expected an object.`);
  }

  const candidate = rule as Record<string, unknown>;
  if (typeof candidate.pattern !== 'string' || !candidate.pattern.trim()) {
    throw new Error(`Invalid ${groupName} rule: "pattern" must be a non-empty string.`);
  }
  if (!isRiskLevel(candidate.level)) {
    throw new Error(`Invalid ${groupName} rule: "level" must be a valid risk level.`);
  }
  if (typeof candidate.reason !== 'string' || !candidate.reason.trim()) {
    throw new Error(`Invalid ${groupName} rule: "reason" must be a non-empty string.`);
  }
  if (candidate.flags != null && typeof candidate.flags !== 'string') {
    throw new Error(`Invalid ${groupName} rule: "flags" must be a string when provided.`);
  }

  return {
    pattern: candidate.pattern,
    flags: candidate.flags as string | undefined,
    level: candidate.level,
    reason: candidate.reason,
  };
}

function normalizeRuleGroup(group: unknown, groupName: string): RiskRule[] {
  if (group == null) {
    return [];
  }

  if (!Array.isArray(group)) {
    throw new Error(`Invalid ${groupName}: expected an array of rules.`);
  }

  return group.map((rule) => normalizeRule(rule, groupName));
}

export function loadRiskRules(filePath?: string): RiskRuleConfig {
  if (!filePath) {
    return { commandRules: [], pathRules: [] };
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Risk rules file not found: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  return {
    commandRules: normalizeRuleGroup(parsed.commandRules, 'commandRules'),
    pathRules: normalizeRuleGroup(parsed.pathRules, 'pathRules'),
  };
}
