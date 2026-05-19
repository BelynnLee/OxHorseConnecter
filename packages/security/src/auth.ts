import jwt from 'jsonwebtoken';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

interface TokenPayload {
  userId: string;
  username: string;
}

const PASSWORD_HASH_ALGORITHM = 'scrypt';
const PASSWORD_HASH_VERSION = 'v1';
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_BYTES = 24;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

interface ParsedPasswordHash {
  salt: Buffer;
  key: Buffer;
}

/**
 * Generate a signed JWT token.
 */
export function generateToken(
  payload: TokenPayload,
  secret: string,
  expiresIn: string = '24h',
): string {
  return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

/**
 * Verify a JWT token and return the decoded payload, or null if
 * the token is invalid / expired.
 */
export function verifyToken(
  token: string,
  secret: string,
): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
    if (
      typeof decoded === 'object' &&
      typeof decoded.userId === 'string' &&
      typeof decoded.username === 'string'
    ) {
      return { userId: decoded.userId, username: decoded.username };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Compare secrets without leaking timing differences.
 */
export function safeEqualSecret(
  provided: string | undefined | null,
  expected: string | undefined | null,
): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }

  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(provided), hash(expected));
}

function derivePasswordKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, PASSWORD_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

function parsePasswordHash(hash: string): ParsedPasswordHash | null {
  const parts = hash.split('$');
  if (
    parts.length !== 7 ||
    parts[0] !== PASSWORD_HASH_ALGORITHM ||
    parts[1] !== PASSWORD_HASH_VERSION
  ) {
    return null;
  }

  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    return null;
  }

  try {
    const salt = Buffer.from(parts[5], 'base64url');
    const key = Buffer.from(parts[6], 'base64url');
    if (salt.length !== PASSWORD_SALT_BYTES || key.length !== PASSWORD_KEY_LENGTH) {
      return null;
    }
    return { salt, key };
  } catch {
    return null;
  }
}

/**
 * Hash a password with Node's memory-hard scrypt KDF.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const key = derivePasswordKey(password, salt);
  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_VERSION,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Compare a plain-text password against a stored hash.
 *
 * Legacy plaintext values are accepted only so existing installations can log
 * in once and have the stored value upgraded by the caller.
 */
export function comparePassword(password: string, hash: string): boolean {
  const parsed = parsePasswordHash(hash);
  if (!parsed) {
    if (hash.startsWith(`${PASSWORD_HASH_ALGORITHM}$`)) {
      return false;
    }
    return safeEqualSecret(password, hash);
  }

  const derived = derivePasswordKey(password, parsed.salt);
  return timingSafeEqual(derived, parsed.key);
}

export function isPasswordHashSecure(hash: string): boolean {
  return parsePasswordHash(hash) !== null;
}
