export interface RawExtractedCustomer {
  rawName: string;
  rawPhone: string;
  rawEmail?: string | null;
  rawGender?: string | null;
  rawDob?: string | null;
  rawCity?: string | null;
  rawAddress?: string | null;
}

export interface MetricFactItem {
  key: string;
  name: string;
  value: number | null;
  unit: string;
  description?: string;
}

export interface BusinessAnalyticsFactSheet {
  period: {
    from: string; // ISO-8601 UTC (inclusive)
    to: string; // ISO-8601 UTC (exclusive)
  };
  metrics: MetricFactItem[];
  customerMetrics?: {
    totalActiveCustomers: number;
    baselineCustomers: number;
    newCustomersInPeriod: number;
    cohortExpansionRatePercentage: number | null;
    expansionStatus: string;
    acquisitionVelocity: number;
    whatsappMarketingOptInPercentage: number;
    voiceMarketingOptInPercentage: number;
    emailMarketingOptInPercentage: number;
    doNotContactPercentage: number;
    effectiveWhatsappEligibleCount: number;
    effectiveVoiceEligibleCount: number;
    effectiveEmailEligibleCount: number;
    genderDistribution: Record<string, number>;
    acquisitionSourceDistribution: Record<string, number>;
  };
  salesMetrics?: {
    isAvailable: boolean;
    data: any | null;
  };
  productMetrics?: {
    isAvailable: boolean;
    data: any | null;
  };
  campaignMetrics?: {
    isAvailable: boolean;
    data: any | null;
  };
  dataLimitations: string[];
}

export interface RawAIInsightItem {
  title: string;
  description: string;
  category: string;
  referencedMetricKey: string;
  severity: 'POSITIVE' | 'NEUTRAL' | 'ATTENTION';
}

export interface RawAIRecommendationItem {
  title: string;
  action: string;
  rationale: string;
  referencedMetricKey: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface RawAIAnalysisResponse {
  summary: string;
  insights: RawAIInsightItem[];
  recommendations: RawAIRecommendationItem[];
  dataLimitations: string[];
}

export interface RawAIQuestionResponse {
  answer: string;
  referencedMetricKeys: string[];
  dataLimitations: string[];
}

export interface IAIProvider {
  extractCustomersFromImage(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<RawExtractedCustomer[]>;

  generateBusinessAnalysis(
    factSheet: BusinessAnalyticsFactSheet,
    analysisType: string,
  ): Promise<RawAIAnalysisResponse>;

  answerBusinessQuestion(
    question: string,
    contextFactSheet: BusinessAnalyticsFactSheet,
  ): Promise<RawAIQuestionResponse>;
}
