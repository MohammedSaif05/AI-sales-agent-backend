import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BusinessAnalyticsFactSheet,
  MetricFactItem,
} from '../../ai/ai.interface';
import { SnapshotMetadata } from '../business-analyst.types';
import { CampaignAnalyticsCollector } from '../collectors/campaign-analytics.collector';
import { CustomerAnalyticsCollector } from '../collectors/customer-analytics.collector';
import { ProductAnalyticsCollector } from '../collectors/product-analytics.collector';
import { SalesAnalyticsCollector } from '../collectors/sales-analytics.collector';

@Injectable()
export class AnalyticsDataService {
  private readonly logger = new Logger(AnalyticsDataService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly customerCollector: CustomerAnalyticsCollector,
    private readonly salesCollector: SalesAnalyticsCollector,
    private readonly productCollector: ProductAnalyticsCollector,
    private readonly campaignCollector: CampaignAnalyticsCollector,
  ) {}

  /**
   * Orchestrates modular collectors to produce an authoritative, PII-free Analytics Fact Sheet.
   */
  async buildFactSheet(
    businessId: string,
    periodFrom: Date,
    periodTo: Date,
    timezone?: string,
    options?: { isDemographicRequested?: boolean },
  ): Promise<{
    factSheet: BusinessAnalyticsFactSheet;
    metadata: SnapshotMetadata;
    metricValueMap: Map<string, number | string | null>;
  }> {
    const tz =
      timezone ||
      this.configService.get<string>('DEFAULT_TIMEZONE') ||
      'Asia/Kolkata';

    this.logger.log(
      `Building analytics fact sheet for businessId=${businessId}, tz=${tz}`,
    );

    // 1. Run all collectors concurrently
    const [customerRes, salesRes, productRes, campaignRes] = await Promise.all([
      this.customerCollector.collect(
        businessId,
        periodFrom,
        periodTo,
        tz,
        options,
      ),
      this.salesCollector.collect(
        businessId,
        periodFrom,
        periodTo,
        tz,
        options,
      ),
      this.productCollector.collect(
        businessId,
        periodFrom,
        periodTo,
        tz,
        options,
      ),
      this.campaignCollector.collect(
        businessId,
        periodFrom,
        periodTo,
        tz,
        options,
      ),
    ]);

    // 2. Compile pre-computed metric facts (authoritative numbers)
    const metrics: MetricFactItem[] = [];
    const metricValueMap = new Map<string, number | string | null>();

    if (customerRes.data) {
      const cd = customerRes.data;

      const addMetric = (
        key: string,
        name: string,
        value: number | null,
        unit: string,
        description?: string,
      ) => {
        metrics.push({ key, name, value, unit, description });
        metricValueMap.set(key, value);
      };

      addMetric(
        'totalActiveCustomers',
        'Total Active Customers',
        cd.totalActiveCustomers,
        'count',
        'Total non-deleted registered customer profiles in store directory',
      );
      addMetric(
        'baselineCustomers',
        'Baseline Prior Customers',
        cd.baselineCustomers,
        'count',
        'Active customer profiles created prior to period start',
      );
      addMetric(
        'newCustomersInPeriod',
        'New Customers in Period',
        cd.newCustomersInPeriod,
        'count',
        'Active customer profiles registered within the selected period',
      );
      addMetric(
        'cohortExpansionRatePercentage',
        'Cohort Expansion Rate',
        cd.cohortExpansionRatePercentage,
        '%',
        'Active customer base relative growth over baseline registrations',
      );
      addMetric(
        'acquisitionVelocity',
        'Customer Acquisition Velocity',
        cd.acquisitionVelocity,
        'customers/day',
        'Average new customers acquired per calendar day',
      );
      addMetric(
        'whatsappMarketingOptInPercentage',
        'WhatsApp Marketing Opt-In Rate',
        cd.whatsappMarketingOptInPercentage,
        '%',
        'Percentage of active customers opted-in to WhatsApp marketing',
      );
      addMetric(
        'voiceMarketingOptInPercentage',
        'Voice Marketing Opt-In Rate',
        cd.voiceMarketingOptInPercentage,
        '%',
        'Percentage of active customers opted-in to voice marketing',
      );
      addMetric(
        'emailMarketingOptInPercentage',
        'Email Marketing Opt-In Rate',
        cd.emailMarketingOptInPercentage,
        '%',
        'Percentage of active customers opted-in to email marketing',
      );
      addMetric(
        'doNotContactPercentage',
        'Do Not Contact Rate',
        cd.doNotContactPercentage,
        '%',
        'Percentage of active customers marked as Do Not Contact (overrides marketing consent)',
      );
      addMetric(
        'effectiveWhatsappEligibleCount',
        'Effective WhatsApp Outreach Reach',
        cd.effectiveWhatsappEligibleCount,
        'count',
        'Active customers with WhatsApp opt-in and DNC=false',
      );
      addMetric(
        'effectiveVoiceEligibleCount',
        'Effective Voice Outreach Reach',
        cd.effectiveVoiceEligibleCount,
        'count',
        'Active customers with Voice opt-in and DNC=false',
      );
      addMetric(
        'effectiveEmailEligibleCount',
        'Effective Email Outreach Reach',
        cd.effectiveEmailEligibleCount,
        'count',
        'Active customers with Email opt-in and DNC=false',
      );

      // Add gender and source distributions to map
      for (const [gKey, gVal] of Object.entries(cd.genderDistribution)) {
        metricValueMap.set(`genderDistribution.${gKey}`, gVal);
      }
      for (const [sKey, sVal] of Object.entries(
        cd.acquisitionSourceDistribution,
      )) {
        metricValueMap.set(`acquisitionSourceDistribution.${sKey}`, sVal);
      }
    }

    // 3. Aggregate all explicit data limitations
    const allLimitations = [
      ...customerRes.limitations,
      ...salesRes.limitations,
      ...productRes.limitations,
      ...campaignRes.limitations,
    ];

    // 4. Construct snapshot metadata (Omits businessId per directive)
    const metadata: SnapshotMetadata = {
      schemaVersion: '1.0',
      collectorVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      timezone: tz,
      period: {
        from: periodFrom.toISOString(),
        to: periodTo.toISOString(),
      },
    };

    const factSheet: BusinessAnalyticsFactSheet = {
      period: {
        from: periodFrom.toISOString(),
        to: periodTo.toISOString(),
      },
      metrics,
      customerMetrics: customerRes.data || undefined,
      salesMetrics: {
        isAvailable: salesRes.isAvailable,
        data: salesRes.data,
      },
      productMetrics: {
        isAvailable: productRes.isAvailable,
        data: productRes.data,
      },
      campaignMetrics: {
        isAvailable: campaignRes.isAvailable,
        data: campaignRes.data,
      },
      dataLimitations: allLimitations,
    };

    return {
      factSheet,
      metadata,
      metricValueMap,
    };
  }
}
