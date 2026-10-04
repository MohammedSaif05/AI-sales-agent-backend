import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

export class CredentialCrypto {
  private static getKey(customKey?: string): Buffer {
    const rawKey = customKey || process.env.WHATSAPP_ENCRYPTION_KEY;
    if (!rawKey) {
      throw new Error(
        'WHATSAPP_ENCRYPTION_KEY environment variable is required for credential encryption',
      );
    }

    if (rawKey.length === 64) {
      // Hex string of 32 bytes
      return Buffer.from(rawKey, 'hex');
    } else if (rawKey.length === 44 && rawKey.endsWith('=')) {
      // Base64 string of 32 bytes
      return Buffer.from(rawKey, 'base64');
    } else if (Buffer.byteLength(rawKey, 'utf8') === 32) {
      return Buffer.from(rawKey, 'utf8');
    }

    // SHA-256 hash fallback to guarantee exactly 32 bytes
    return crypto.createHash('sha256').update(rawKey).digest();
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Returns formatted string: `${ivHex}:${authTagHex}:${ciphertextHex}`
   */
  static encrypt(plaintext: string, customKey?: string): string {
    if (!plaintext) {
      throw new Error('Cannot encrypt empty plaintext');
    }

    const key = this.getKey(customKey);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypts ciphertext formatted as `${ivHex}:${authTagHex}:${ciphertextHex}` using AES-256-GCM.
   */
  static decrypt(encryptedPayload: string, customKey?: string): string {
    if (!encryptedPayload) {
      throw new Error('Cannot decrypt empty payload');
    }

    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) {
      throw new Error(
        'Invalid encrypted payload format. Expected iv:authTag:ciphertext',
      );
    }

    const [ivHex, authTagHex, ciphertextHex] = parts;
    const key = this.getKey(customKey);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    if (iv.length !== IV_LENGTH) {
      throw new Error(
        `Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`,
      );
    }

    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(
        `Invalid auth tag length: expected ${AUTH_TAG_LENGTH} bytes, got ${authTag.length}`,
      );
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    try {
      let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      throw new Error(
        'Decryption failed: authentication tag mismatch or corrupted ciphertext',
      );
    }
  }
}
