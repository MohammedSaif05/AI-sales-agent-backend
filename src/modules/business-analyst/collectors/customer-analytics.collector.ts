import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  CollectorOptions,
  CollectorResult,
  IAnalyticsCollector,
} from './collector.interface';

export interface CustomerAnalyticsData {
  totalActiveCustomers: number;
  baselineCustomers: number;
  newCustomersInPeriod: number;
  cohortExpansionRatePercentage: number | null;
  expansionStatus: 'INITIAL_ONBOARDING' | 'STEADY_EXPANSION' | 'NO_ACTIVITY';
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
}

@Injectable()
export class CustomerAnalyticsCollector implements IAnalyticsCollector<CustomerAnalyticsData> {
  private readonly logger = new Logger(CustomerAnalyticsCollector.name);

  constructor(private readonly prisma: PrismaService) {}

  async collect(
    businessId: string,
    periodFrom: Date,
    periodTo: Date,
    _timezone?: string,
    options?: CollectorOptions,
  ): Promise<CollectorResult<CustomerAnalyticsData>> {
    this.logger.log(
      `Collecting customer analytics for businessId=${businessId}, period=[${periodFrom.toISOString()} - ${periodTo.toISOString()})`,
    );

    const limitations: string[] = [];

    // 1. Total Active Customers (Zero PII loaded into Node memory)
    const totalActiveCustomers = await this.prisma.customer.count({
      where: { businessId, deletedAt: null },
    });

    // 2. Baseline Customers created strictly before periodFrom
    const baselineCustomers = await this.prisma.customer.count({
      where: {
        businessId,
        deletedAt: null,
        createdAt: { lt: periodFrom },
      },
    });

    // 3. New Customers created in period [periodFrom, periodTo)
    const newCustomersInPeriod = await this.prisma.customer.count({
      where: {
        businessId,
        deletedAt: null,
        createdAt: {
          gte: periodFrom,
          lt: periodTo,
        },
      },
    });

    // 4. Cohort Expansion Rate calculation with edge case handling
    let cohortExpansionRatePercentage: number | null = null;
    let expansionStatus:
      'INITIAL_ONBOARDING' | 'STEADY_EXPANSION' | 'NO_ACTIVITY' = 'NO_ACTIVITY';

    if (baselineCustomers > 0) {
      cohortExpansionRatePercentage = Number(
        ((newCustomersInPeriod / baselineCustomers) * 100).toFixed(2),
      );
      expansionStatus = 'STEADY_EXPANSION';
    } else if (newCustomersInPeriod > 0) {
      cohortExpansionRatePercentage = null;
      expansionStatus = 'INITIAL_ONBOARDING';
      limitations.push(
        'Prior customer baseline was zero; cohort expansion rate is mathematically undefined and recorded as initial onboarding.',
      );
    } else {
      cohortExpansionRatePercentage = 0.0;
      expansionStatus = 'NO_ACTIVITY';
    }

    // 5. Acquisition Velocity (Customers per calendar day)
    const durationDays = Math.max(
      1,
      Math.ceil(
        (periodTo.getTime() - periodFrom.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );
    const acquisitionVelocity = Number(
      (newCustomersInPeriod / durationDays).toFixed(2),
    );

    // 6. Channel Consent & Do Not Contact Aggregations (DNC takes strict precedence)
    const [
      rawWhatsappConsentCount,
      rawVoiceConsentCount,
      rawEmailConsentCount,
      doNotContactCount,
      effectiveWhatsappEligibleCount,
      effectiveVoiceEligibleCount,
      effectiveEmailEligibleCount,
    ] = await Promise.all([
      this.prisma.customerCommunicationPreferences.count({
        where: {
          customer: { businessId, deletedAt: null },
          whatsappMarketing: true,
        },
      }),
      this.prisma.customerCommunicationPreferences.count({
        where: {
          customer: { businessId, deletedAt: null },
          voiceMarketing: true,
        },
      }),
      this.prisma.customerCommunicationPreferences.count({
        where: {
          customer: { businessId, deletedAt: null },
          emailMarketing: true,
        },
      }),
      this.prisma.customerCommunicationPreferences.count({
        where: {
          customer: { businessId, deletedAt: null },
          doNotContact: true,
        },
      }),
      this.prisma.customerCommunicationPreferences.count({
        where: {
          customer: { businessId, deletedAt: null },
          whatsappMarketing: true,
          doNotContact: false,
        },
      }),
      this.prisma.customerCommunicationPreferences.count({
        where: {
          customer: { businessId, deletedAt: null },
          voiceMarketing: true,
          doNotContact: false,
        },
      }),
      this.prisma.customerCommunicationPreferences.count({
        where: {
          customer: { businessId, deletedAt: null },
          emailMarketing: true,
          doNotContact: false,
        },
      }),
    ]);

    const denominator = totalActiveCustomers > 0 ? totalActiveCustomers : 1;
    const whatsappMarketingOptInPercentage =
      totalActiveCustomers > 0
        ? Number(((rawWhatsappConsentCount / denominator) * 100).toFixed(2))
        : 0.0;
    const voiceMarketingOptInPercentage =
      totalActiveCustomers > 0
        ? Number(((rawVoiceConsentCount / denominator) * 100).toFixed(2))
        : 0.0;
    const emailMarketingOptInPercentage =
      totalActiveCustomers > 0
        ? Number(((rawEmailConsentCount / denominator) * 100).toFixed(2))
        : 0.0;
    const doNotContactPercentage =
      totalActiveCustomers > 0
        ? Number(((doNotContactCount / denominator) * 100).toFixed(2))
        : 0.0;

    // 7. GroupBy Demographics (Gender & Source)
    const [genderGroups, sourceGroups, customersWithDobCount] =
      await Promise.all([
        this.prisma.customer.groupBy({
          by: ['gender'],
          where: { businessId, deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.customer.groupBy({
          by: ['source'],
          where: { businessId, deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.customer.count({
          where: {
            businessId,
            deletedAt: null,
            dob: { not: null },
          },
        }),
      ]);

    const genderDistribution: Record<string, number> = {};
    for (const g of genderGroups) {
      genderDistribution[g.gender || 'UNSPECIFIED'] = g._count._all;
    }

    const acquisitionSourceDistribution: Record<string, number> = {};
    for (const s of sourceGroups) {
      acquisitionSourceDistribution[s.source] = s._count._all;
    }

    // 8. Conditional limitation on DOB coverage: only include when age-demographic analysis is requested and DOB coverage is insufficient
    if (
      options?.isDemographicRequested &&
      totalActiveCustomers > 0 &&
      customersWithDobCount / totalActiveCustomers < 0.3
    ) {
      limitations.push(
        'Customer date-of-birth coverage is low; demographic age cohort analysis is omitted.',
      );
    }

    return {
      isAvailable: true,
      data: {
        totalActiveCustomers,
        baselineCustomers,
        newCustomersInPeriod,
        cohortExpansionRatePercentage,
        expansionStatus,
        acquisitionVelocity,
        whatsappMarketingOptInPercentage,
        voiceMarketingOptInPercentage,
        emailMarketingOptInPercentage,
        doNotContactPercentage,
        effectiveWhatsappEligibleCount,
        effectiveVoiceEligibleCount,
        effectiveEmailEligibleCount,
        genderDistribution,
        acquisitionSourceDistribution,
      },
      limitations,
    };
  }
}
