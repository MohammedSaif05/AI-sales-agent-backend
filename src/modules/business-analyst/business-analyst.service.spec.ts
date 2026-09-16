import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisStatus, AnalysisType, QuestionStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { AIService } from '../ai/ai.service';
import { BusinessAnalystService } from './business-analyst.service';
import { CustomerAnalyticsCollector } from './collectors/customer-analytics.collector';
import { AiResponseValidatorService } from './services/ai-response-validator.service';
import { AnalyticsDataService } from './services/analytics-data.service';

describe('Feature 02: AI Business Analyst Agent Unit Tests', () => {
  describe('CustomerAnalyticsCollector', () => {
    let collector: CustomerAnalyticsCollector;
    let mockPrisma: any;

    beforeEach(async () => {
      mockPrisma = {
        customer: {
          count: jest.fn(),
          groupBy: jest.fn(),
        },
        customerCommunicationPreferences: {
          count: jest.fn(),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CustomerAnalyticsCollector,
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      collector = module.get<CustomerAnalyticsCollector>(
        CustomerAnalyticsCollector,
      );
    });

    it('should handle zero baseline customer edge case (INITIAL_ONBOARDING)', async () => {
      // Setup counts
      mockPrisma.customer.count
        .mockResolvedValueOnce(15) // totalActiveCustomers
        .mockResolvedValueOnce(0) // baselineCustomers
        .mockResolvedValueOnce(15) // newCustomersInPeriod
        .mockResolvedValueOnce(2); // customersWithDobCount (2/15 = 13.3%)

      // Preferences counts
      mockPrisma.customerCommunicationPreferences.count
        .mockResolvedValueOnce(10) // rawWhatsapp
        .mockResolvedValueOnce(5) // rawVoice
        .mockResolvedValueOnce(8) // rawEmail
        .mockResolvedValueOnce(2) // doNotContact
        .mockResolvedValueOnce(9) // effectiveWhatsapp
        .mockResolvedValueOnce(4) // effectiveVoice
        .mockResolvedValueOnce(7); // effectiveEmail

      // GroupBy mocks
      mockPrisma.customer.groupBy
        .mockResolvedValueOnce([{ gender: 'MALE', _count: { _all: 10 } }])
        .mockResolvedValueOnce([{ source: 'MANUAL', _count: { _all: 15 } }]);

      const periodFrom = new Date('2026-08-01T00:00:00.000Z');
      const periodTo = new Date('2026-08-31T00:00:00.000Z');

      const result = await collector.collect(
        'biz-1',
        periodFrom,
        periodTo,
        'Asia/Kolkata',
      );

      expect(result.isAvailable).toBe(true);
      expect(result.data?.baselineCustomers).toBe(0);
      expect(result.data?.newCustomersInPeriod).toBe(15);
      expect(result.data?.cohortExpansionRatePercentage).toBeNull();
      expect(result.data?.expansionStatus).toBe('INITIAL_ONBOARDING');
      expect(
        result.limitations.some((l) => l.includes('initial onboarding')),
      ).toBe(true);
    });

    it('should calculate cohort expansion rate accurately when baseline > 0', async () => {
      mockPrisma.customer.count
        .mockResolvedValueOnce(50) // totalActiveCustomers
        .mockResolvedValueOnce(40) // baselineCustomers
        .mockResolvedValueOnce(10) // newCustomersInPeriod
        .mockResolvedValueOnce(40); // customersWithDobCount

      mockPrisma.customerCommunicationPreferences.count
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(25)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(28)
        .mockResolvedValueOnce(18)
        .mockResolvedValueOnce(22);

      mockPrisma.customer.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const periodFrom = new Date('2026-08-01T00:00:00.000Z');
      const periodTo = new Date('2026-08-31T00:00:00.000Z');

      const result = await collector.collect('biz-1', periodFrom, periodTo);

      expect(result.data?.cohortExpansionRatePercentage).toBe(25.0); // (10 / 40) * 100 = 25%
      expect(result.data?.expansionStatus).toBe('STEADY_EXPANSION');
      expect(result.data?.acquisitionVelocity).toBe(0.33); // 10 / 30 days ≈ 0.33/day
    });

    it('should enforce DNC precedence over marketing preferences', async () => {
      mockPrisma.customer.count
        .mockResolvedValueOnce(100) // totalActiveCustomers
        .mockResolvedValueOnce(80) // baselineCustomers
        .mockResolvedValueOnce(20) // newCustomersInPeriod
        .mockResolvedValueOnce(80); // customersWithDobCount

      mockPrisma.customerCommunicationPreferences.count
        .mockResolvedValueOnce(80) // raw whatsapp opt-in (80%)
        .mockResolvedValueOnce(60) // raw voice opt-in (60%)
        .mockResolvedValueOnce(70) // raw email opt-in (70%)
        .mockResolvedValueOnce(15) // doNotContact count (15%)
        .mockResolvedValueOnce(68) // effective whatsapp (excluding DNC)
        .mockResolvedValueOnce(50) // effective voice (excluding DNC)
        .mockResolvedValueOnce(60); // effective email (excluding DNC)

      mockPrisma.customer.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await collector.collect(
        'biz-1',
        new Date('2026-08-01T00:00:00.000Z'),
        new Date('2026-08-31T00:00:00.000Z'),
      );

      expect(result.data?.whatsappMarketingOptInPercentage).toBe(80.0);
      expect(result.data?.doNotContactPercentage).toBe(15.0);
      expect(result.data?.effectiveWhatsappEligibleCount).toBe(68);
      expect(result.data?.effectiveWhatsappEligibleCount).toBeLessThan(80);
    });

    it('should conditionally add DOB limitation only when demographic analysis is requested', async () => {
      mockPrisma.customer.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(10); // DOB coverage 10% (< 30%)

      mockPrisma.customerCommunicationPreferences.count.mockResolvedValue(0);
      mockPrisma.customer.groupBy.mockResolvedValue([]);

      // 1. Without demographic requested -> No DOB limitation
      const resNoDemo = await collector.collect(
        'biz-1',
        new Date('2026-08-01T00:00:00.000Z'),
        new Date('2026-08-31T00:00:00.000Z'),
        'Asia/Kolkata',
        { isDemographicRequested: false },
      );
      expect(
        resNoDemo.limitations.some((l) => l.includes('date-of-birth')),
      ).toBe(false);

      // 2. With demographic requested -> DOB limitation included
      mockPrisma.customer.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(10);

      const resWithDemo = await collector.collect(
        'biz-1',
        new Date('2026-08-01T00:00:00.000Z'),
        new Date('2026-08-31T00:00:00.000Z'),
        'Asia/Kolkata',
        { isDemographicRequested: true },
      );
      expect(
        resWithDemo.limitations.some((l) => l.includes('date-of-birth')),
      ).toBe(true);
    });
  });

  describe('AiResponseValidatorService', () => {
    let validator: AiResponseValidatorService;

    beforeEach(() => {
      validator = new AiResponseValidatorService();
    });

    it('should reject unknown metric keys not in strict allowlist', () => {
      const rawAiResponse: any = {
        summary: 'Test summary',
        insights: [
          {
            title: 'Fabricated metric insight',
            description: 'AI hallucinates some metric',
            referencedMetricKey: 'fabricated_nonexistent_metric_key',
            referencedMetricValue: 9999,
            severity: 'POSITIVE',
          },
          {
            title: 'Valid insight',
            description: 'Customer count is healthy',
            referencedMetricKey: 'totalActiveCustomers',
            referencedMetricValue: 12345, // AI hallucinated number
            severity: 'POSITIVE',
          },
        ],
        recommendations: [
          {
            title: 'Invalid recommendation',
            action: 'Action',
            rationale: 'Rationale',
            referencedMetricKey: 'unknown_recommendation_metric',
            priority: 'HIGH',
          },
        ],
        dataLimitations: [],
      };

      const metricValueMap = new Map<string, any>([
        ['totalActiveCustomers', 42], // Authoritative backend value
      ]);

      const validated = validator.validateAnalysisResponse(
        rawAiResponse,
        { from: '2026-08-01', to: '2026-08-31' },
        [],
        metricValueMap,
        ['Backend limitation'],
      );

      // Only 1 insight allowed, unknown rejected
      expect(validated.insights.length).toBe(1);
      expect(validated.insights[0].referencedMetricKey).toBe(
        'totalActiveCustomers',
      );
      // Overwritten with backend authoritative value
      expect(validated.insights[0].referencedMetricValue).toBe(42);

      // Invalid recommendation rejected
      expect(validated.recommendations.length).toBe(0);
    });

    it('should support valid empty insights and recommendations when data is limited', () => {
      const rawAiResponse: any = {
        summary: 'No data to evaluate',
        insights: [],
        recommendations: [],
        dataLimitations: ['Sales engine not connected'],
      };

      const validated = validator.validateAnalysisResponse(
        rawAiResponse,
        { from: '2026-08-01', to: '2026-08-31' },
        [],
        new Map(),
        ['Backend limitation'],
      );

      expect(validated.insights).toHaveLength(0);
      expect(validated.recommendations).toHaveLength(0);
      expect(validated.dataLimitations).toContain('Sales engine not connected');
      expect(validated.dataLimitations).toContain('Backend limitation');
    });
  });

  describe('BusinessAnalystService', () => {
    let service: BusinessAnalystService;
    let mockPrisma: any;
    let mockAiService: any;
    let mockAnalyticsDataService: any;
    let mockQueue: any;

    beforeEach(async () => {
      mockPrisma = {
        businessAnalysis: {
          findFirst: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn(),
        },
        businessQuestion: {
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn(),
        },
      };

      mockAiService = {
        generateBusinessAnalysis: jest.fn(),
        answerBusinessQuestion: jest.fn(),
      };

      mockAnalyticsDataService = {
        buildFactSheet: jest.fn().mockResolvedValue({
          factSheet: {
            period: { from: '2026-08-01', to: '2026-08-31' },
            metrics: [],
            dataLimitations: [],
          },
          metadata: {
            snapshotVersion: '1.0',
            dataSources: ['POSTGRES_DB'],
            generatedAt: new Date().toISOString(),
          },
          metricValueMap: new Map(),
        }),
      };

      mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          BusinessAnalystService,
          AiResponseValidatorService,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'BUSINESS_ANALYST_CACHE_TTL') return 900;
                if (key === 'REDIS_HOST') return 'localhost';
                if (key === 'REDIS_PORT') return 6379;
                return null;
              }),
            },
          },
          { provide: AIService, useValue: mockAiService },
          { provide: AnalyticsDataService, useValue: mockAnalyticsDataService },
          { provide: 'BullQueue_business-analysis', useValue: mockQueue },
        ],
      }).compile();

      service = module.get<BusinessAnalystService>(BusinessAnalystService);
    });

    afterEach(async () => {
      await service.onModuleDestroy();
    });

    it('should return existing record on duplicate idempotency request with matching payload', async () => {
      const existingAnalysis = {
        id: 'analysis-1',
        businessId: 'biz-1',
        requestedByUserId: 'user-1',
        analysisType: AnalysisType.CUSTOMER_ANALYSIS,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-31T00:00:00.000Z'),
        status: AnalysisStatus.COMPLETED,
        summary: 'Cached analysis summary',
        resultJson: { metrics: [] },
        idempotencyKey: 'idem-key-1',
        requestHash:
          'f40c7657ad517ba60ffbb8df0d00f77bf64e9a66d03cf1c02ff853924f7df5ca', // computed from same dto
        createdAt: new Date(),
        completedAt: new Date(),
      };

      // Mock findUnique to return existing
      mockPrisma.businessAnalysis.findUnique.mockResolvedValue(
        existingAnalysis,
      );

      // Force computeHash to match existingAnalysis.requestHash
      jest
        .spyOn(service as any, 'computeHash')
        .mockReturnValue(existingAnalysis.requestHash);

      const result = await service.generateAnalysis(
        'biz-1',
        'user-1',
        {
          analysisType: AnalysisType.CUSTOMER_ANALYSIS,
          periodFrom: new Date('2026-08-01T00:00:00.000Z'),
          periodTo: new Date('2026-08-31T00:00:00.000Z'),
          isAsync: false,
        },
        'idem-key-1',
      );

      expect(result.id).toBe('analysis-1');
      expect((result as any).summary).toBe('Cached analysis summary');
      expect(mockAiService.generateBusinessAnalysis).not.toHaveBeenCalled();
    });

    it('should throw 409 ConflictException on idempotency key reuse with different payload', async () => {
      const existingAnalysis = {
        id: 'analysis-1',
        businessId: 'biz-1',
        idempotencyKey: 'idem-key-1',
        requestHash: 'hash-abc',
      };

      mockPrisma.businessAnalysis.findUnique.mockResolvedValue(
        existingAnalysis,
      );
      jest
        .spyOn(service as any, 'computeHash')
        .mockReturnValue('different-hash-xyz');

      await expect(
        service.generateAnalysis(
          'biz-1',
          'user-1',
          {
            analysisType: AnalysisType.CUSTOMER_ANALYSIS,
            periodFrom: new Date('2026-08-01T00:00:00.000Z'),
            periodTo: new Date('2026-08-31T00:00:00.000Z'),
          },
          'idem-key-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should enqueue async requests to BullMQ with QUEUED status', async () => {
      mockPrisma.businessAnalysis.findUnique.mockResolvedValue(null);
      mockPrisma.businessAnalysis.create.mockResolvedValue({
        id: 'async-analysis-id',
        businessId: 'biz-1',
        status: AnalysisStatus.QUEUED,
        analysisType: AnalysisType.CUSTOMER_ANALYSIS,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-31T00:00:00.000Z'),
        createdAt: new Date(),
      });

      const result = await service.generateAnalysis('biz-1', 'user-1', {
        analysisType: AnalysisType.CUSTOMER_ANALYSIS,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-31T00:00:00.000Z'),
        isAsync: true,
      });

      expect(result.status).toBe(AnalysisStatus.QUEUED);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-analysis',
        expect.objectContaining({
          analysisId: 'async-analysis-id',
          businessId: 'biz-1',
        }),
        expect.objectContaining({
          jobId: 'business-analysis:biz-1:async-analysis-id',
        }),
      );
    });

    it('should recover stale jobs stuck in PROCESSING for over 5 minutes', async () => {
      mockPrisma.businessAnalysis.updateMany.mockResolvedValue({ count: 3 });

      const recovered = await service.recoverStaleProcessingJobs(5);

      expect(recovered).toBe(3);
      expect(mockPrisma.businessAnalysis.updateMany).toHaveBeenCalledWith({
        where: {
          status: AnalysisStatus.PROCESSING,
          updatedAt: {
            lt: expect.any(Date),
          },
        },
        data: {
          status: AnalysisStatus.FAILED,
          errorMessage:
            'Analysis processing timed out and was recovered by watchdog.',
        },
      });
    });

    it('should enforce tenant isolation when fetching analysis by id', async () => {
      // Trying to fetch an analysis belonging to biz-2 while authenticated as biz-1
      mockPrisma.businessAnalysis.findFirst.mockResolvedValue(null);

      await expect(
        service.getAnalysis('biz-1', 'analysis-belonging-to-biz-2'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
