import { QuestionStatus } from '@prisma/client';

export interface SnapshotMetadata {
  schemaVersion: '1.0';
  collectorVersion: '1.0.0';
  generatedAt: string; // ISO-8601 UTC
  timezone: string; // e.g. "Asia/Kolkata"
  period: {
    from: string; // ISO-8601 UTC (inclusive)
    to: string; // ISO-8601 UTC (exclusive)
  };
}

export const ALLOWED_METRIC_KEYS = [
  'totalActiveCustomers',
  'baselineCustomers',
  'newCustomersInPeriod',
  'cohortExpansionRatePercentage',
  'acquisitionVelocity',
  'whatsappMarketingOptInPercentage',
  'voiceMarketingOptInPercentage',
  'emailMarketingOptInPercentage',
  'doNotContactPercentage',
  'effectiveWhatsappEligibleCount',
  'effectiveVoiceEligibleCount',
  'effectiveEmailEligibleCount',
  'genderDistribution.MALE',
  'genderDistribution.FEMALE',
  'genderDistribution.OTHER',
  'genderDistribution.UNSPECIFIED',
  'acquisitionSourceDistribution.MANUAL',
  'acquisitionSourceDistribution.CSV',
  'acquisitionSourceDistribution.EXCEL',
  'acquisitionSourceDistribution.IMAGE',
  'acquisitionSourceDistribution.IMPORT',
  'acquisitionSourceDistribution.WHATSAPP',
  'acquisitionSourceDistribution.CAMPAIGN',
] as const;

export type AllowedMetricKey = (typeof ALLOWED_METRIC_KEYS)[number];

export interface ValidatedInsightItem {
  title: string;
  description: string;
  category: string;
  referencedMetricKey: string;
  referencedMetricValue: number | string | null;
  severity: 'POSITIVE' | 'NEUTRAL' | 'ATTENTION';
}

export interface ValidatedRecommendationItem {
  title: string;
  action: string;
  rationale: string;
  referencedMetricKey: string;
  referencedMetricValue: number | string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ValidatedAnalysisResult {
  period: {
    from: string;
    to: string;
  };
  metrics: Array<{
    key: string;
    name: string;
    value: number | null;
    unit: string;
    description?: string;
  }>;
  insights: ValidatedInsightItem[];
  recommendations: ValidatedRecommendationItem[];
  dataLimitations: string[];
}

export interface ValidatedQuestionResult {
  id: string;
  question: string;
  answer: string;
  status: QuestionStatus;
  dataLimitations: string[];
  createdAt: Date;
}
