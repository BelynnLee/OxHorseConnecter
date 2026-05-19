/**
 * Redaction patterns for common secret / credential formats.
 *
 * Each tuple is [regex, replacement]. Prefer preserving the key prefix and only
 * redacting the sensitive value when the format has an explicit key.
 */
const REDACT_PATTERNS: [RegExp, string][] = [
  // Private key blocks.
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    '-----BEGIN PRIVATE KEY-----\n***REDACTED***\n-----END PRIVATE KEY-----',
  ],
  // API keys:  api_key=XXXX  /  apiKey: XXXX  /  api-key = XXXX
  [
    /((?:api[_-]?key|apikey)\s*[:=]\s*)\S+/gi,
    '$1***REDACTED***',
  ],
  // Common provider keys seen without an explicit key name.
  [
    /\b(sk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{16,})\b/g,
    '***REDACTED_KEY***',
  ],
  // Bearer tokens
  [
    /(Bearer\s+)\S+/gi,
    '$1***REDACTED***',
  ],
  // Authorization headers
  [
    /((?:authorization|auth)\s*[:=]\s*)(?!\*\*\*REDACTED\*\*\*)[^\r\n]+/gi,
    '$1***REDACTED***',
  ],
  // Cookie headers.
  [
    /((?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi,
    '$1***REDACTED***',
  ],
  // Password fields
  [
    /((?:password|passwd|pwd)\s*[:=]\s*)\S+/gi,
    '$1***REDACTED***',
  ],
  // Secret / token fields
  [
    /((?:secret|token|access_token|auth_token)\s*[:=]\s*)\S+/gi,
    '$1***REDACTED***',
  ],
  // Typical .env uppercase secrets, e.g. OPENAI_API_KEY=... or FOO_TOKEN=...
  [
    /(\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CREDENTIALS)\s*=\s*)[^\r\n]+/g,
    '$1***REDACTED***',
  ],
  // Database URLs, including common postgres/mysql/mongodb/redis schemes.
  [
    /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s'"`)]+/gi,
    '$1://***REDACTED***',
  ],
];

function redactionEnabled(): boolean {
  const value = process.env.LOG_REDACTION_ENABLED;
  if (value == null) {
    return true;
  }
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

/**
 * Sanitize a log string by replacing values that look like secrets with
 * `***REDACTED***`.
 */
export function sanitizeLog(text: string): string {
  if (!redactionEnabled()) {
    return text;
  }

  let result = text;
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
