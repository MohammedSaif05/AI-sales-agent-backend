import { Injectable } from '@nestjs/common';
import { CollectorResult, IAnalyticsCollector } from './collector.interface';

export interface CampaignMetricsData {
  totalCampaigns: number;
  activeCampaigns: number;
  totalDelivered: number;
  totalConversions: number;
}

@Injectable()
export class CampaignAnalyticsCollector implements IAnalyticsCollector<CampaignMetricsData> {
  async collect(
    _businessId: string,
    _periodFrom: Date,
    _periodTo: Date,
    _timezone?: string,
    _options?: any,
  ): Promise<CollectorResult<CampaignMetricsData>> {
    return {
      isAvailable: false,
      data: null,
      limitations: [
        'Marketing campaign execution engine and outreach delivery metrics are not yet connected.',
      ],
    };
  }
}
