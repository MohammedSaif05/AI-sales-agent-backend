import { Injectable } from '@nestjs/common';
import { CollectorResult, IAnalyticsCollector } from './collector.interface';

export interface SalesMetricsData {
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  salesGrowthPercentage: number | null;
  currency: string;
}

@Injectable()
export class SalesAnalyticsCollector implements IAnalyticsCollector<SalesMetricsData> {
  async collect(
    _businessId: string,
    _periodFrom: Date,
    _periodTo: Date,
    _timezone?: string,
    _options?: any,
  ): Promise<CollectorResult<SalesMetricsData>> {
    return {
      isAvailable: false,
      data: null,
      limitations: [
        'Sales transactions, orders, and revenue data are not yet integrated into the trusted database. Ingestion pipeline will connect to this collector in future sales modules.',
      ],
    };
  }
}
