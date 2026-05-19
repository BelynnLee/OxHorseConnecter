import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SECRET_PREFIX = 'v1';

function keyFromSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export class ProviderSecretVault {
  private key: Buffer;

  constructor(secret: string) {
    this.key = keyFromSecret(secret);
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      SECRET_PREFIX,
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  decrypt(value: string): string {
    const [version, ivText, tagText, encryptedText] = value.split(':');
    if (version !== SECRET_PREFIX || !ivText || !tagText || !encryptedText) {
      throw new Error('Unsupported encrypted provider secret format.');
    }

    const iv = Buffer.from(ivText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    const encrypted = Buffer.from(encryptedText, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  equalsEncrypted(plain: string, encryptedValue: string): boolean {
    try {
      const decrypted = Buffer.from(this.decrypt(encryptedValue));
      const candidate = Buffer.from(plain);
      return decrypted.length === candidate.length && timingSafeEqual(decrypted, candidate);
    } catch {
      return false;
    }
  }
}
