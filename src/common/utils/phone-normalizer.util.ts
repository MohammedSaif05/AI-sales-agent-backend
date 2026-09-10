import { PhoneNumberFormat, PhoneNumberUtil } from 'google-libphonenumber';

export interface PhoneNormalizationResult {
  isValid: boolean;
  raw: string;
  normalized: string | null;
  countryCode?: string;
  nationalNumber?: string;
  error?: string;
}

export class PhoneNormalizer {
  private static readonly phoneUtil = PhoneNumberUtil.getInstance();
  private static readonly DEFAULT_REGION = 'IN';

  /**
   * Normalizes a phone number to canonical E.164 format.
   * Default region is India ('IN').
   * Example: '9876543210' -> '+919876543210'
   * Example: '+91 98765 43210' -> '+919876543210'
   */
  public static normalize(
    rawPhone: string,
    defaultRegion: string = this.DEFAULT_REGION,
  ): PhoneNormalizationResult {
    if (!rawPhone || typeof rawPhone !== 'string' || !rawPhone.trim()) {
      return {
        isValid: false,
        raw: rawPhone ?? '',
        normalized: null,
        error: 'Phone number is empty or missing',
      };
    }

    const trimmed = rawPhone.trim();

    try {
      // If number does not start with '+', parse with default region (IN)
      const parsedNumber = this.phoneUtil.parseAndKeepRawInput(
        trimmed,
        defaultRegion,
      );

      const isValid = this.phoneUtil.isValidNumber(parsedNumber);
      if (!isValid) {
        return {
          isValid: false,
          raw: trimmed,
          normalized: null,
          error: 'Phone number is invalid or has incorrect digit count',
        };
      }

      // Format as canonical E.164 (+919876543210)
      const formatted = this.phoneUtil.format(
        parsedNumber,
        PhoneNumberFormat.E164,
      );

      return {
        isValid: true,
        raw: trimmed,
        normalized: formatted,
        countryCode: String(parsedNumber.getCountryCode()),
        nationalNumber: String(parsedNumber.getNationalNumber()),
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to parse phone number';
      return {
        isValid: false,
        raw: trimmed,
        normalized: null,
        error: message,
      };
    }
  }

  /**
   * Quick boolean check if a phone number is valid
   */
  public static isValid(
    rawPhone: string,
    defaultRegion: string = this.DEFAULT_REGION,
  ): boolean {
    return this.normalize(rawPhone, defaultRegion).isValid;
  }

  /**
   * Returns canonical E.164 string or throws error if invalid
   */
  public static toCanonicalOrThrow(
    rawPhone: string,
    defaultRegion: string = this.DEFAULT_REGION,
  ): string {
    const result = this.normalize(rawPhone, defaultRegion);
    if (!result.isValid || !result.normalized) {
      throw new Error(result.error || `Invalid phone number: ${rawPhone}`);
    }
    return result.normalized;
  }
}
