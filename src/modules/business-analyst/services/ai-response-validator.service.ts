import { Injectable, Logger } from '@nestjs/common';
import {
  RawAIAnalysisResponse,
  RawAIQuestionResponse,
} from '../../ai/ai.interface';
import {
  ALLOWED_METRIC_KEYS,
  ValidatedAnalysisResult,
  ValidatedInsightItem,
  ValidatedQuestionResult,
  ValidatedRecommendationItem,
} from '../business-analyst.types';
import { QuestionStatus } from '@prisma/client';

@Injectable()
export class AiResponseValidatorService {
  private readonly logger = new Logger(AiResponseValidatorService.name);
  private readonly allowedKeysSet = new Set<string>(ALLOWED_METRIC_KEYS);

  /**
   * Validates raw Gemini analysis response against backend fact sheet.
   * Discards items referencing unallowed or non-existent metric keys.
   * Resolves authoritative values directly from backend fact sheet.
   */
  validateAnalysisResponse(
    rawResponse: RawAIAnalysisResponse,
    period: { from: string; to: string },
    metrics: Array<{
      key: string;
      name: string;
      value: number | null;
      unit: string;
      description?: string;
    }>,
    metricValueMap: Map<string, number | string | null>,
    factSheetLimitations: string[],
  ): ValidatedAnalysisResult {
    const validatedInsights: ValidatedInsightItem[] = [];
    const validatedRecommendations: ValidatedRecommendationItem[] = [];

    // 1. Validate Insights
    if (Array.isArray(rawResponse.insights)) {
      for (const item of rawResponse.insights) {
        if (!item.title || !item.description || !item.referencedMetricKey) {
          continue;
        }

        const key = String(item.referencedMetricKey).trim();
        // Strict allowlist validation
        if (!this.allowedKeysSet.has(key)) {
          this.logger.warn(
            `Rejecting insight "${item.title}": referencedMetricKey "${key}" is not in strict allowlist.`,
          );
          continue;
        }

        // Authoritative value overwrite from trusted fact sheet
        const authoritativeValue = metricValueMap.has(key)
          ? metricValueMap.get(key)!
          : null;

        validatedInsights.push({
          title: String(item.title).trim(),
          description: String(item.description).trim(),
          category: String(item.category || 'CUSTOMER_ACQUISITION').trim(),
          referencedMetricKey: key,
          referencedMetricValue: authoritativeValue,
          severity: ['POSITIVE', 'NEUTRAL', 'ATTENTION'].includes(item.severity)
            ? item.severity
            : 'NEUTRAL',
        });
      }
    }

    // 2. Validate Recommendations
    if (Array.isArray(rawResponse.recommendations)) {
      for (const item of rawResponse.recommendations) {
        if (!item.title || !item.action || !item.referencedMetricKey) {
          continue;
        }

        const key = String(item.referencedMetricKey).trim();
        if (!this.allowedKeysSet.has(key)) {
          this.logger.warn(
            `Rejecting recommendation "${item.title}": referencedMetricKey "${key}" is not in strict allowlist.`,
          );
          continue;
        }

        const authoritativeValue = metricValueMap.has(key)
          ? metricValueMap.get(key)!
          : null;

        validatedRecommendations.push({
          title: String(item.title).trim(),
          action: String(item.action).trim(),
          rationale: String(item.rationale || item.action).trim(),
          referencedMetricKey: key,
          referencedMetricValue: authoritativeValue,
          priority: ['LOW', 'MEDIUM', 'HIGH'].includes(item.priority)
            ? item.priority
            : 'MEDIUM',
        });
      }
    }

    // 3. Compile limitations (ensures non-empty if insights/recommendations are empty)
    const combinedLimitations = Array.from(
      new Set([
        ...factSheetLimitations,
        ...(Array.isArray(rawResponse.dataLimitations)
          ? rawResponse.dataLimitations
          : []),
      ]),
    );

    if (
      validatedInsights.length === 0 &&
      validatedRecommendations.length === 0 &&
      combinedLimitations.length === 0
    ) {
      combinedLimitations.push(
        'Insufficient customer cohort activity during the selected period to generate insights or recommendations.',
      );
    }

    return {
      period,
      metrics,
      insights: validatedInsights,
      recommendations: validatedRecommendations,
      dataLimitations: combinedLimitations,
    };
  }

  /**
   * Validates raw Gemini question response against backend fact sheet.
   */
  validateQuestionResponse(
    id: string,
    question: string,
    rawResponse: RawAIQuestionResponse,
    factSheetLimitations: string[],
  ): ValidatedQuestionResult {
    const answer =
      typeof rawResponse.answer === 'string' &&
      rawResponse.answer.trim().length > 0
        ? rawResponse.answer.trim()
        : 'Unable to formulate an answer from the permitted analytics context.';

    const combinedLimitations = Array.from(
      new Set([
        ...factSheetLimitations,
        ...(Array.isArray(rawResponse.dataLimitations)
          ? rawResponse.dataLimitations
          : []),
      ]),
    );

    return {
      id,
      question,
      answer,
      status: QuestionStatus.COMPLETED,
      dataLimitations: combinedLimitations,
      createdAt: new Date(),
    };
  }
}
