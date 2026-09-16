import { GoogleGenAI, Type } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BusinessAnalyticsFactSheet,
  IAIProvider,
  RawAIAnalysisResponse,
  RawAIQuestionResponse,
  RawExtractedCustomer,
} from '../ai.interface';

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
                          description:
                            'Mobile or phone number as printed/written',
                        },
                        rawEmail: {
                          type: Type.STRING,
                          description: 'Email address if present',
                        },
                        rawGender: {
                          type: Type.STRING,
                          description:
                            'Gender if indicated (e.g. Male, Female)',
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
      this.logger.error(
        'Failed to extract customer records via Gemini API',
        err,
      );
      throw new Error(
        'AI vision extraction failed to process the image: ' +
          (err instanceof Error ? err.message : 'Unknown error'),
      );
    }
  }

  async generateBusinessAnalysis(
    factSheet: BusinessAnalyticsFactSheet,
    analysisType: string,
  ): Promise<RawAIAnalysisResponse> {
    if (!this.aiClient) {
      this.logger.warn(
        'Gemini client is not initialized. Operating in fallback limitation mode.',
      );
      return {
        summary:
          'Analysis generated in offline/fallback mode. AI provider is not configured.',
        insights: [],
        recommendations: [],
        dataLimitations: [
          'Gemini API key is not configured; AI analytical synthesis is unavailable.',
          ...factSheet.dataLimitations,
        ],
      };
    }

    try {
      const model =
        this.configService.get<string>('GEMINI_MODEL') ||
        'gemini-3.1-flash-lite';

      const prompt = `You are an expert AI Business Analyst for an SMB clothing store.
Analyze the following trusted, pre-computed backend analytics fact sheet for analysis type "${analysisType}".

CRITICAL CONSTRAINTS:
1. The backend fact sheet is the authoritative source of truth. Every metric has already been computed.
2. You must ONLY interpret and explain the provided numbers. Do NOT invent, extrapolate, or hallucinate missing sales, revenue, orders, products, or campaigns.
3. Every insight and recommendation must explicitly specify a "referencedMetricKey" matching one of the keys provided in the fact sheet metrics. Do NOT provide metric values; the backend resolves them.
4. If a category is listed under data limitations or has no data, do NOT fabricate claims about it. Return empty arrays if no valid recommendations can be formed from the provided data.
5. Do NOT make unsupported market generalizations. Keep recommendations grounded directly on the customer profiles and consent metrics provided.

FACT SHEET:
${JSON.stringify(factSheet, null, 2)}`;

      let response: any;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await this.aiClient.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  summary: {
                    type: Type.STRING,
                    description:
                      'Concise executive summary of business metrics',
                  },
                  insights: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                        category: { type: Type.STRING },
                        referencedMetricKey: { type: Type.STRING },
                        severity: {
                          type: Type.STRING,
                          enum: ['POSITIVE', 'NEUTRAL', 'ATTENTION'],
                        },
                      },
                      required: [
                        'title',
                        'description',
                        'category',
                        'referencedMetricKey',
                        'severity',
                      ],
                    },
                  },
                  recommendations: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        title: { type: Type.STRING },
                        action: { type: Type.STRING },
                        rationale: { type: Type.STRING },
                        referencedMetricKey: { type: Type.STRING },
                        priority: {
                          type: Type.STRING,
                          enum: ['LOW', 'MEDIUM', 'HIGH'],
                        },
                      },
                      required: [
                        'title',
                        'action',
                        'rationale',
                        'referencedMetricKey',
                        'priority',
                      ],
                    },
                  },
                  dataLimitations: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: [
                  'summary',
                  'insights',
                  'recommendations',
                  'dataLimitations',
                ],
              },
            },
          });
          break;
        } catch (callErr: any) {
          const isTransient =
            callErr?.status === 503 ||
            callErr?.status === 429 ||
            callErr?.message?.includes('503') ||
            callErr?.message?.includes('RESOURCE_EXHAUSTED');

          if (isTransient && attempt < maxRetries) {
            const delayMs = attempt * 1500;
            this.logger.warn(
              `Gemini API transient error (attempt ${attempt}/${maxRetries}). Retrying...`,
            );
            await new Promise((r) => setTimeout(r, delayMs));
          } else {
            throw callErr;
          }
        }
      }

      const parsed: RawAIAnalysisResponse = JSON.parse(response.text);
      return {
        summary: String(parsed.summary || '').trim(),
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
        recommendations: Array.isArray(parsed.recommendations)
          ? parsed.recommendations
          : [],
        dataLimitations: Array.isArray(parsed.dataLimitations)
          ? parsed.dataLimitations
          : factSheet.dataLimitations,
      };
    } catch (err: unknown) {
      this.logger.error(
        'Failed to generate business analysis via Gemini API',
        err,
      );
      throw new Error(
        'AI business analysis failed: ' +
          (err instanceof Error ? err.message : 'Unknown error'),
      );
    }
  }

  async answerBusinessQuestion(
    question: string,
    contextFactSheet: BusinessAnalyticsFactSheet,
  ): Promise<RawAIQuestionResponse> {
    if (!this.aiClient) {
      return {
        answer:
          'AI Q&A service is running in offline fallback mode. Gemini API key is not configured.',
        referencedMetricKeys: [],
        dataLimitations: contextFactSheet.dataLimitations,
      };
    }

    try {
      const model =
        this.configService.get<string>('GEMINI_MODEL') ||
        'gemini-3.1-flash-lite';

      const prompt = `You are an expert AI Business Analyst answering a store owner's question.
Answer based strictly and solely on the provided analytics context.

CRITICAL RULES:
1. Do NOT assume, extrapolate, or invent unavailable data (e.g. sales, products, revenue).
2. If the user asks about an unavailable metric (such as sales transactions or revenue), explicitly state that sales data is not yet integrated.
3. Be direct, clear, and professional.

QUESTION: "${question}"

CONTEXT FACT SHEET:
${JSON.stringify(contextFactSheet, null, 2)}`;

      let response: any;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          response = await this.aiClient.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  answer: { type: Type.STRING },
                  referencedMetricKeys: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  dataLimitations: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: ['answer', 'referencedMetricKeys', 'dataLimitations'],
              },
            },
          });
          break;
        } catch (callErr: any) {
          const isTransient =
            callErr?.status === 503 ||
            callErr?.status === 429 ||
            callErr?.message?.includes('503') ||
            callErr?.message?.includes('RESOURCE_EXHAUSTED');

          if (isTransient && attempt < maxRetries) {
            const delayMs = attempt * 1500;
            await new Promise((r) => setTimeout(r, delayMs));
          } else {
            throw callErr;
          }
        }
      }

      const parsed: RawAIQuestionResponse = JSON.parse(response.text);
      return {
        answer: String(parsed.answer || '').trim(),
        referencedMetricKeys: Array.isArray(parsed.referencedMetricKeys)
          ? parsed.referencedMetricKeys
          : [],
        dataLimitations: Array.isArray(parsed.dataLimitations)
          ? parsed.dataLimitations
          : contextFactSheet.dataLimitations,
      };
    } catch (err: unknown) {
      this.logger.error(
        'Failed to answer business question via Gemini API',
        err,
      );
      throw new Error(
        'AI question answering failed: ' +
          (err instanceof Error ? err.message : 'Unknown error'),
      );
    }
  }
}
