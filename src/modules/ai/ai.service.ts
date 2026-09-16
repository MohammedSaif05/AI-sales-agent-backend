import { Injectable, Logger } from '@nestjs/common';
import {
  BusinessAnalyticsFactSheet,
  RawAIAnalysisResponse,
  RawAIQuestionResponse,
  RawExtractedCustomer,
} from './ai.interface';
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
    this.logger.log(
      `Invoking AI vision extraction for image (${imageBuffer.length} bytes, ${mimeType})`,
    );
    return this.geminiProvider.extractCustomersFromImage(imageBuffer, mimeType);
  }

  /**
   * Generates analytical interpretations and grounded recommendations based strictly
   * on the pre-computed backend analytics fact sheet.
   */
  async generateBusinessAnalysis(
    factSheet: BusinessAnalyticsFactSheet,
    analysisType: string,
  ): Promise<RawAIAnalysisResponse> {
    this.logger.log(`Invoking AI business analysis for type=${analysisType}`);
    return this.geminiProvider.generateBusinessAnalysis(
      factSheet,
      analysisType,
    );
  }

  /**
   * Generates grounded natural-language answers to SMB store questions based on
   * permitted tenant-scoped aggregated metrics.
   */
  async answerBusinessQuestion(
    question: string,
    contextFactSheet: BusinessAnalyticsFactSheet,
  ): Promise<RawAIQuestionResponse> {
    this.logger.log(`Invoking AI business Q&A for question="${question}"`);
    return this.geminiProvider.answerBusinessQuestion(
      question,
      contextFactSheet,
    );
  }
}
