import { Injectable, Logger } from '@nestjs/common';
import { RawExtractedCustomer } from './ai.interface';
import { GeminiProvider } from './providers/gemini.provider';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(private readonly geminiProvider: GeminiProvider) {}

  /**
   * Extracts raw customer records from image buffer using configured AI vision provider.
   * NOTE: Output is treated as untrusted input and must undergo complete backend
   * normalization, validation, and staging before persistence.
   */
  async extractCustomersFromImage(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<RawExtractedCustomer[]> {
    this.logger.log(`Invoking AI vision extraction for image (${imageBuffer.length} bytes, ${mimeType})`);
    return this.geminiProvider.extractCustomersFromImage(imageBuffer, mimeType);
  }
}
