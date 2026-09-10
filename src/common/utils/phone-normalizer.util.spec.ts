import { PhoneNormalizer } from './phone-normalizer.util';

describe('PhoneNormalizer', () => {
  describe('Indian Phone Number Normalization', () => {
    it('should normalize standard 10-digit Indian number', () => {
      const result = PhoneNormalizer.normalize('9876543210');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('+919876543210');
      expect(result.countryCode).toBe('91');
      expect(result.nationalNumber).toBe('9876543210');
    });

    it('should normalize number with spaces', () => {
      const result = PhoneNormalizer.normalize('+91 98765 43210');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('+919876543210');
    });

    it('should normalize number with dashes', () => {
      const result = PhoneNormalizer.normalize('+91-98765-43210');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('+919876543210');
    });

    it('should normalize number with 91 prefix without plus', () => {
      const result = PhoneNormalizer.normalize('919876543210');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('+919876543210');
    });

    it('should normalize number with leading 0 (trunk code)', () => {
      const result = PhoneNormalizer.normalize('09876543210');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('+919876543210');
    });
  });

  describe('International Phone Number Normalization', () => {
    it('should parse valid US E.164 number', () => {
      const result = PhoneNormalizer.normalize('+14155552671');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('+14155552671');
      expect(result.countryCode).toBe('1');
    });

    it('should parse valid UK E.164 number', () => {
      const result = PhoneNormalizer.normalize('+447911123456');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('+447911123456');
      expect(result.countryCode).toBe('44');
    });
  });

  describe('Invalid Phone Number Rejection', () => {
    it('should reject short numbers', () => {
      const result = PhoneNormalizer.normalize('12345');
      expect(result.isValid).toBe(false);
      expect(result.normalized).toBeNull();
      expect(result.error).toBeDefined();
    });

    it('should reject non-numeric strings', () => {
      const result = PhoneNormalizer.normalize('not-a-number');
      expect(result.isValid).toBe(false);
      expect(result.normalized).toBeNull();
    });

    it('should reject empty or whitespace strings', () => {
      const result = PhoneNormalizer.normalize('   ');
      expect(result.isValid).toBe(false);
      expect(result.normalized).toBeNull();
      expect(result.error).toContain('empty');
    });
  });

  describe('Utility Methods', () => {
    it('isValid() should return boolean', () => {
      expect(PhoneNormalizer.isValid('9876543210')).toBe(true);
      expect(PhoneNormalizer.isValid('123')).toBe(false);
    });

    it('toCanonicalOrThrow() should return string or throw', () => {
      expect(PhoneNormalizer.toCanonicalOrThrow('9876543210')).toBe('+919876543210');
      expect(() => PhoneNormalizer.toCanonicalOrThrow('abc')).toThrow();
    });
  });
});
