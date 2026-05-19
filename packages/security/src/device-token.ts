import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_PREFIX = 'racw';
const SECRET_BYTES = 32;

export interface DeviceCredentialToken {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
}

export interface ParsedDeviceCredentialToken {
  credentialId: string;
  token: string;
}

export function hashDeviceCredentialToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createDeviceCredentialToken(credentialId: string): DeviceCredentialToken {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const token = `${TOKEN_PREFIX}_${credentialId}_${secret}`;
  return {
    token,
    tokenHash: hashDeviceCredentialToken(token),
    tokenPrefix: `${TOKEN_PREFIX}_${credentialId.slice(0, 8)}`,
  };
}

export function parseDeviceCredentialToken(token: string): ParsedDeviceCredentialToken | null {
  const marker = `${TOKEN_PREFIX}_`;
  if (!token.startsWith(marker)) {
    return null;
  }

  const credentialIdEnd = token.indexOf('_', marker.length);
  if (credentialIdEnd <= marker.length || credentialIdEnd === token.length - 1) {
    return null;
  }

  return {
    credentialId: token.slice(marker.length, credentialIdEnd),
    token,
  };
}

export function verifyDeviceCredentialToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashDeviceCredentialToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
