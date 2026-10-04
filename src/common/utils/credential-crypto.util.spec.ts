import { CredentialCrypto } from './credential-crypto.util';

describe('CredentialCrypto', () => {
  const sampleSecret = 'EAAX0192834710293847abcdef123456';
  const testKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeAll(() => {
    process.env.WHATSAPP_ENCRYPTION_KEY = testKey;
  });

  it('should encrypt and decrypt a plaintext string successfully', () => {
    const encrypted = CredentialCrypto.encrypt(sampleSecret);
    expect(encrypted).toBeDefined();
    expect(encrypted).not.toEqual(sampleSecret);

    const parts = encrypted.split(':');
    expect(parts.length).toBe(3);

    const decrypted = CredentialCrypto.decrypt(encrypted);
    expect(decrypted).toEqual(sampleSecret);
  });

  it('should fail decryption if ciphertext is tampered with', () => {
    const encrypted = CredentialCrypto.encrypt(sampleSecret);
    const parts = encrypted.split(':');
    // Deterministically tamper with ciphertext
    const firstChar = parts[2][0];
    const alteredChar = firstChar === 'a' ? 'b' : 'a';
    const tampered = `${parts[0]}:${parts[1]}:${alteredChar}${parts[2].slice(1)}`;

    expect(() => CredentialCrypto.decrypt(tampered)).toThrow(
      'Decryption failed: authentication tag mismatch or corrupted ciphertext',
    );
  });

  it('should fail decryption if auth tag is tampered with', () => {
    const encrypted = CredentialCrypto.encrypt(sampleSecret);
    const parts = encrypted.split(':');
    // Tamper with auth tag
    const tampered = `${parts[0]}:00000000000000000000000000000000:${parts[2]}`;

    expect(() => CredentialCrypto.decrypt(tampered)).toThrow(
      'Decryption failed: authentication tag mismatch or corrupted ciphertext',
    );
  });

  it('should throw error for invalid encrypted payload format', () => {
    expect(() => CredentialCrypto.decrypt('invalid-format')).toThrow(
      'Invalid encrypted payload format. Expected iv:authTag:ciphertext',
    );
  });

  it('should throw error when encrypting empty string', () => {
    expect(() => CredentialCrypto.encrypt('')).toThrow(
      'Cannot encrypt empty plaintext',
    );
  });
});
