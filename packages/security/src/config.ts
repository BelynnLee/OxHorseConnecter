const DEFAULT_FORBIDDEN_SECRETS = [
  'admin123',
  'change-me',
  'change-me-before-production',
  'change-me-to-a-random-secret',
  'changeme',
  'default',
  'password',
  'secret',
];

export interface SecretPolicy {
  name: string;
  minLength?: number;
  forbiddenValues?: string[];
}

export function assertSecureSecret(
  value: string | undefined,
  policy: SecretPolicy,
): string {
  const secret = value?.trim() ?? '';
  const minLength = policy.minLength ?? 32;
  const forbidden = [
    ...DEFAULT_FORBIDDEN_SECRETS,
    ...(policy.forbiddenValues ?? []),
  ].map((candidate) => candidate.toLowerCase());

  if (!secret) {
    throw new Error(`${policy.name} is required. Set a strong value in .env.`);
  }

  if (secret.length < minLength) {
    throw new Error(`${policy.name} must be at least ${minLength} characters long.`);
  }

  if (forbidden.includes(secret.toLowerCase())) {
    throw new Error(`${policy.name} uses an unsafe default value.`);
  }

  if (/change[-_ ]?me|replace[-_ ]?with|before[-_ ]?production/i.test(secret)) {
    throw new Error(`${policy.name} looks like a placeholder value.`);
  }

  return secret;
}

export function assertProductionHttpsUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (parsed.protocol === 'https:') {
    return;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost');

  if (!isLoopback) {
    throw new Error(`${label} must use https:// outside local development.`);
  }
}
