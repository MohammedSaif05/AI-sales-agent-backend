import { Injectable } from '@nestjs/common';
import { CollectorResult, IAnalyticsCollector } from './collector.interface';

export interface ProductMetricsData {
  totalCatalogProducts: number;
  topPerformingProducts: Array<{ name: string; quantitySold: number }>;
  decliningProducts: Array<{ name: string; dropPercentage: number }>;
}

@Injectable()
export class ProductAnalyticsCollector implements IAnalyticsCollector<ProductMetricsData> {
  async collect(
    _businessId: string,
    _periodFrom: Date,
    _periodTo: Date,
    _timezone?: string,
    _options?: any,
  ): Promise<CollectorResult<ProductMetricsData>> {
    return {
      isAvailable: false,
      data: null,
      limitations: [
        'Product catalog, SKU stock levels, and inventory movement data are not yet integrated into the trusted database.',
      ],
    };
  }
}
