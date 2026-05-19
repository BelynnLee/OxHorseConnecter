import path from 'node:path';
import { loadRiskRules, type RiskRule, type RiskRuleConfig } from './rule-loader.js';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskAssessment {
  level: RiskLevel;
  reason: string;
  requiresApproval: boolean;
}

const DEFAULT_COMMAND_RULES: RiskRule[] = [
  { pattern: String.raw`\bformat\s+c:`, level: 'critical', reason: 'Command attempts to format a disk.' },
  { pattern: String.raw`\bmkfs(\.[^\s]+)?\b`, level: 'critical', reason: 'Command attempts to create a filesystem.' },
  { pattern: String.raw`\bdd\s+if=`, level: 'critical', reason: 'Command may write raw disk data.' },
  { pattern: String.raw`:?\(\)\s*\{\s*:?\|:?\s*&\s*\};:`, level: 'critical', reason: 'Command resembles a fork bomb.' },
  { pattern: String.raw`\brm\s+-rf\b`, level: 'critical', reason: 'Command recursively deletes files.' },
  { pattern: String.raw`\brmdir\s+\/s\b`, level: 'critical', reason: 'Command recursively deletes directories.' },
  { pattern: String.raw`\bdel\b.*\/[fFqQ]`, level: 'critical', reason: 'Command force-deletes files on Windows.' },
  { pattern: String.raw`\bgit\s+reset\s+--hard\b`, level: 'high', reason: 'Command forcefully resets git state.' },
  { pattern: String.raw`\bgit\s+push\s+--force\b`, level: 'high', reason: 'Command force-pushes git history.' },
  { pattern: String.raw`\bgit\s+push\s+-f\b`, level: 'high', reason: 'Command force-pushes git history.' },
  { pattern: String.raw`curl .*?\|\s*(bash|sh)\b`, level: 'high', reason: 'Command pipes remote content into a shell.' },
  { pattern: String.raw`wget .*?-O-\s+.*?\|\s*(bash|sh)\b`, level: 'high', reason: 'Command pipes remote content into a shell.' },
  { pattern: String.raw`eval\s+\$\(`, level: 'high', reason: 'Command evaluates nested shell output.' },
  { pattern: String.raw`DROP\s+(TABLE|DATABASE)\b`, level: 'high', reason: 'Command appears to destroy database objects.' },
  { pattern: String.raw`truncate\s+--size=0`, level: 'high', reason: 'Command truncates a file to zero bytes.' },
  { pattern: String.raw`\bchmod\b`, level: 'high', reason: 'Command changes filesystem permissions.' },
  { pattern: String.raw`\bchown\b`, level: 'high', reason: 'Command changes filesystem ownership.' },
  { pattern: String.raw`\bsudo\b`, level: 'high', reason: 'Command escalates privileges.' },
  { pattern: String.raw`\b(npm|pnpm)\s+install\b`, level: 'medium', reason: 'Command installs or updates packages.' },
  { pattern: String.raw`\byarn\s+add\b`, level: 'medium', reason: 'Command installs or updates packages.' },
  { pattern: String.raw`\bpip\s+install\b`, level: 'medium', reason: 'Command installs Python packages.' },
  { pattern: String.raw`\bcargo\s+add\b`, level: 'medium', reason: 'Command modifies Rust dependencies.' },
  { pattern: String.raw`\bpoetry\s+add\b`, level: 'medium', reason: 'Command modifies Python dependencies.' },
  { pattern: String.raw`\bgit\s+clone\b`, level: 'medium', reason: 'Command pulls external code into the workspace.' },
  { pattern: String.raw`\bdocker\s+run\b`, level: 'medium', reason: 'Command launches a container.' },
];

const DEFAULT_PATH_RULES: RiskRule[] = [
  { pattern: String.raw`\.(env|pem|key)$`, level: 'high', reason: 'Path references a sensitive environment or key file.' },
  { pattern: String.raw`credentials`, level: 'high', reason: 'Path references credentials.' },
  { pattern: String.raw`\.(pfx|p12)$`, level: 'high', reason: 'Path references a certificate archive.' },
  { pattern: String.raw`id_rsa$`, level: 'high', reason: 'Path references an SSH private key.' },
  { pattern: String.raw`id_ed25519$`, level: 'high', reason: 'Path references an SSH private key.' },
  { pattern: String.raw`[\\/]\.aws[\\/]credentials$`, level: 'high', reason: 'Path references AWS credentials.' },
  { pattern: String.raw`[\\/]\.config([\\/]|$)`, level: 'high', reason: 'Path references a user configuration directory.' },
];

const DEFAULT_RISK_RULES: RiskRuleConfig = {
  commandRules: DEFAULT_COMMAND_RULES,
  pathRules: DEFAULT_PATH_RULES,
};

function compileRule(rule: RiskRule): RegExp {
  return new RegExp(rule.pattern, rule.flags ?? 'i');
}

function cloneRules(rules: RiskRuleConfig): RiskRuleConfig {
  return {
    commandRules: rules.commandRules.map((rule) => ({ ...rule })),
    pathRules: rules.pathRules.map((rule) => ({ ...rule })),
  };
}

function mergeRiskRules(base: RiskRuleConfig, override: RiskRuleConfig): RiskRuleConfig {
  return {
    commandRules: [...base.commandRules, ...override.commandRules],
    pathRules: [...base.pathRules, ...override.pathRules],
  };
}

const ACTIVE_RISK_RULES = mergeRiskRules(
  DEFAULT_RISK_RULES,
  loadRiskRules(process.env.RISK_RULES_PATH),
);

function assessAgainstRules(value: string, rules: RiskRule[]): RiskAssessment | null {
  for (const rule of rules) {
    if (compileRule(rule).test(value)) {
      return {
        level: rule.level,
        reason: rule.reason,
        requiresApproval: rule.level !== 'low',
      };
    }
  }

  return null;
}

export function getDefaultRiskRules(): RiskRuleConfig {
  return cloneRules(DEFAULT_RISK_RULES);
}

export function getRiskRules(): RiskRuleConfig {
  return cloneRules(ACTIVE_RISK_RULES);
}

export function assessCommandRisk(command: string): RiskAssessment {
  return (
    assessAgainstRules(command, ACTIVE_RISK_RULES.commandRules) ?? {
      level: 'low',
      reason: 'No known dangerous patterns detected.',
      requiresApproval: false,
    }
  );
}

export function assessFilePathRisk(
  filePath: string,
  allowedDir: string,
): RiskAssessment {
  const resolvedPath = path.resolve(filePath);
  const resolvedAllowedDir = path.resolve(allowedDir);
  const relative = path.relative(resolvedAllowedDir, resolvedPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      level: 'critical',
      reason: `Path "${resolvedPath}" is outside the allowed directory "${resolvedAllowedDir}".`,
      requiresApproval: true,
    };
  }

  return (
    assessAgainstRules(resolvedPath, ACTIVE_RISK_RULES.pathRules) ?? {
      level: 'low',
      reason: 'Path is within the allowed directory and is not sensitive.',
      requiresApproval: false,
    }
  );
}
