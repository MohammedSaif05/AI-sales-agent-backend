export interface RawExtractedCustomer {
  rawName: string;
  rawPhone: string;
  rawEmail?: string | null;
  rawGender?: string | null;
  rawDob?: string | null;
  rawCity?: string | null;
  rawAddress?: string | null;
}

export interface IAIProvider {
  extractCustomersFromImage(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<RawExtractedCustomer[]>;
}
