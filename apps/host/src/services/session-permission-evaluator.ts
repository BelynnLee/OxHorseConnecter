import path from 'node:path';
import { assessCommandRisk } from '@rac/security';
import type {
  AgentPermissionDecision,
  AgentPermissionProvider,
  AgentPermissionRule,
  AgentPermissionRuleType,
  RiskLevel,
} from '@rac/shared';
import { decisionRank, riskRank, ruleMatchesPattern } from './session-helpers.js';

export interface EvaluatePermissionRulesInput {
  provider: AgentPermissionProvider;
  deviceId?: string;
  projectPath?: string;
  inputType: AgentPermissionRuleType;
  inputValue: string;
  riskLevel?: RiskLevel;
}

export interface PermissionEvaluation {
  decision: AgentPermissionDecision;
  reason: string;
  riskLevel: RiskLevel;
  rule?: AgentPermissionRule;
}

export function inferPermissionRisk(input: {
  inputType: AgentPermissionRuleType;
  inputValue: string;
  riskLevel?: RiskLevel;
}): RiskLevel {
  return (
    input.riskLevel ??
    (input.inputType === 'command' || input.inputType === 'prompt'
      ? assessCommandRisk(input.inputValue).level
      : 'low')
  );
}

export function evaluatePermissionRules(
  allRules: AgentPermissionRule[],
  input: EvaluatePermissionRulesInput
): PermissionEvaluation {
  const risk = inferPermissionRisk(input);
  const rule = selectPermissionRule(allRules, input, risk);
  const defaultDecision: AgentPermissionDecision =
    risk === 'critical' || risk === 'high' ? 'ask' : 'allow';
  const decision = rule?.decision ?? defaultDecision;
  const reason = rule
    ? `${rule.builtIn ? 'Built-in' : 'Custom'} ${rule.ruleType} rule matched: ${rule.description ?? rule.pattern}`
    : risk === 'low'
      ? 'No permission rule matched; low-risk input allowed.'
      : `No permission rule matched; ${risk}-risk input requires approval.`;

  return { decision, reason, riskLevel: rule?.riskLevel ?? risk, rule };
}

export function selectPermissionRule(
  allRules: AgentPermissionRule[],
  input: EvaluatePermissionRulesInput,
  risk: RiskLevel = inferPermissionRisk(input)
): AgentPermissionRule | undefined {
  return allRules
    .filter((rule) => permissionRuleMatchesInput(rule, input, risk))
    .sort(comparePermissionRules)[0];
}

export function permissionRuleMatchesInput(
  rule: AgentPermissionRule,
  input: EvaluatePermissionRulesInput,
  risk: RiskLevel = inferPermissionRisk(input)
): boolean {
  if (!rule.enabled) {
    return false;
  }
  if (rule.provider !== 'all' && rule.provider !== input.provider) {
    return false;
  }
  if (rule.ruleType !== input.inputType && rule.ruleType !== 'risk') {
    return false;
  }
  if (rule.scope === 'project') {
    if (!rule.projectPath || !input.projectPath) {
      return false;
    }
    if (rule.deviceId && input.deviceId && rule.deviceId !== input.deviceId) {
      return false;
    }
    if (rule.deviceId && !input.deviceId) {
      return false;
    }
    if (rule.deviceId || input.deviceId) {
      if (rule.projectPath.trim() !== input.projectPath.trim()) {
        return false;
      }
    } else if (path.resolve(rule.projectPath) !== path.resolve(input.projectPath)) {
      return false;
    }
  }
  if (rule.ruleType === 'risk') {
    return riskRank(risk) >= riskRank(rule.riskLevel);
  }
  return ruleMatchesPattern(rule.pattern, input.inputValue);
}

export function comparePermissionRules(
  left: AgentPermissionRule,
  right: AgentPermissionRule
): number {
  const decisionDelta = decisionRank(right.decision) - decisionRank(left.decision);
  if (decisionDelta !== 0) return decisionDelta;
  const scopeDelta = (right.scope === 'project' ? 1 : 0) - (left.scope === 'project' ? 1 : 0);
  if (scopeDelta !== 0) return scopeDelta;
  return right.pattern.length - left.pattern.length;
}
