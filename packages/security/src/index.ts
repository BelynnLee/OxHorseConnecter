export {
  generateToken,
  verifyToken,
  hashPassword,
  comparePassword,
  isPasswordHashSecure,
  safeEqualSecret,
} from './auth.js';

export {
  AUTH_RATE_LIMIT_SCOPE_DEFAULT,
  AUTH_RATE_LIMIT_SCOPE_LOGIN,
  createAuthRateLimiter,
  normalizeRateLimitClientIp,
} from './rate-limit.js';

export type {
  AuthRateLimiter,
  RateLimitCheckResult,
  RateLimitConfig,
} from './rate-limit.js';

export {
  assertProductionHttpsUrl,
  assertSecureSecret,
} from './config.js';

export type { SecretPolicy } from './config.js';

export {
  assessCommandRisk,
  assessFilePathRisk,
  getDefaultRiskRules,
  getRiskRules,
} from './risk.js';

export type { RiskLevel, RiskAssessment } from './risk.js';
export type { RiskRule, RiskRuleConfig } from './rule-loader.js';
export { loadRiskRules } from './rule-loader.js';

export { sanitizeLog } from './sanitize.js';

export {
  createDeviceCredentialToken,
  hashDeviceCredentialToken,
  parseDeviceCredentialToken,
  verifyDeviceCredentialToken,
  type DeviceCredentialToken,
  type ParsedDeviceCredentialToken,
} from './device-token.js';
