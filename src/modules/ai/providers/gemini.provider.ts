import { GoogleGenAI, Type } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAIProvider, RawExtractedCustomer } from '../ai.interface';

@Injectable()
export class GeminiProvider implements IAIProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly aiClient?: GoogleGenAI;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey && apiKey !== 'dev_gemini_api_key_placeholder') {
      this.aiClient = new GoogleGenAI({ apiKey });
    } else {
      this.logger.warn(
        'GEMINI_API_KEY is not configured with a valid key. Image extraction will operate in mock/fallback mode.',
      );
    }
  }

  async extractCustomersFromImage(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<RawExtractedCustomer[]> {
    if (!this.aiClient) {
      this.logger.warn(
        'Gemini client is not initialized with a live key. Returning empty extraction array.',
      );
      return [];
    }

    try {
      const base64Data = imageBuffer.toString('base64');

      const prompt = `You are an expert OCR and data extraction system for a clothing retailer.
Analyze this image (which may be a handwritten ledger, printed customer sheet, receipt, or business card) and extract all customer entries into structured JSON.
Extract as many customer records as possible. If an entry is incomplete, still extract whatever fields are visible.`;

      const model =
        this.configService.get<string>('GEMINI_MODEL') ||
        'gemini-3.1-flash-lite';

      let response: any;
      const maxRetries = 3;
      let lastError: any = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await this.aiClient.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: base64Data,
                    },
                  },
                  {
                    text: prompt,
                  },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  customers: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        rawName: {
                          type: Type.STRING,
                          description: 'Name of customer',
                        },
                        rawPhone: {
                          type: Type.STRING,
                          description: 'Mobile or phone number as printed/written',
                        },
                        rawEmail: {
                          type: Type.STRING,
                          description: 'Email address if present',
                        },
                        rawGender: {
                          type: Type.STRING,
                          description: 'Gender if indicated (e.g. Male, Female)',
                        },
                        rawDob: {
                          type: Type.STRING,
                          description: 'Birth date or anniversary if present',
                        },
                        rawCity: {
                          type: Type.STRING,
                          description: 'City or town',
                        },
                        rawAddress: {
                          type: Type.STRING,
                          description: 'Street address or locality',
                        },
                      },
                      required: ['rawName', 'rawPhone'],
                    },
                  },
                },
                required: ['customers'],
              },
            },
          });
          break; // Success
        } catch (callErr: any) {
          lastError = callErr;
          const isTransient =
            callErr?.status === 503 ||
            callErr?.status === 429 ||
            callErr?.message?.includes('503') ||
            callErr?.message?.includes('high demand') ||
            callErr?.message?.includes('RESOURCE_EXHAUSTED');

          if (isTransient && attempt < maxRetries) {
            const delayMs = attempt * 1500;
            this.logger.warn(
              `Gemini API transient error (attempt ${attempt}/${maxRetries}). Retrying in ${delayMs}ms...`,
            );
            await new Promise((r) => setTimeout(r, delayMs));
          } else {
            throw callErr;
          }
        }
      }

      const responseText = response.text;
      if (!responseText) {
        this.logger.warn('Empty text response received from Gemini model');
        return [];
      }

      const parsed = JSON.parse(responseText);
      if (Array.isArray(parsed.customers)) {
        return parsed.customers.map((item: any) => ({
          rawName: String(item.rawName || '').trim(),
          rawPhone: String(item.rawPhone || '').trim(),
          rawEmail: item.rawEmail ? String(item.rawEmail).trim() : null,
          rawGender: item.rawGender ? String(item.rawGender).trim() : null,
          rawDob: item.rawDob ? String(item.rawDob).trim() : null,
          rawCity: item.rawCity ? String(item.rawCity).trim() : null,
          rawAddress: item.rawAddress ? String(item.rawAddress).trim() : null,
        }));
      }

      return [];
    } catch (err: unknown) {
      this.logger.error('Failed to extract customer records via Gemini API', err);
      throw new Error(
        'AI vision extraction failed to process the image: ' +
          (err instanceof Error ? err.message : 'Unknown error'),
      );
    }
  }
}
