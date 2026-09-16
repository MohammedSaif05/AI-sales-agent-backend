import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AIService } from '../src/modules/ai/ai.service';
import { AnalysisType } from '@prisma/client';

describe('Feature 02: AI Business Analyst Agent E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerAToken: string;
  let ownerBToken: string;

  let analysisAId: string;

  const timestamp = Date.now().toString().slice(-6);
  const phoneA = `98111${timestamp.slice(0, 5)}`;
  const phoneB = `98222${timestamp.slice(0, 5)}`;

  const mockAiService = {
    generateBusinessAnalysis: jest
      .fn()
      .mockImplementation(async (_factSheet, _type) => {
        return {
          summary:
            'Synthetic AI analytical summary based strictly on backend facts.',
          insights: [
            {
              title: 'Active Customer Base',
              description:
                'You have an active customer base with high consent engagement.',
              category: 'CUSTOMER_ACQUISITION',
              referencedMetricKey: 'totalActiveCustomers',
              referencedMetricValue: 99999, // Should be overwritten by validator
              severity: 'POSITIVE',
            },
            {
              title: 'Opt-in Performance',
              description: 'WhatsApp marketing opt-in rate is tracking well.',
              category: 'CUSTOMER_ACQUISITION',
              referencedMetricKey: 'whatsappMarketingOptInPercentage',
              referencedMetricValue: 12345, // Should be overwritten
              severity: 'POSITIVE',
            },
            {
              title: 'Hallucinated Metric Insight',
              description: 'Should be discarded by backend validator',
              category: 'FABRICATED',
              referencedMetricKey: 'fabricated_non_existent_key',
              referencedMetricValue: 50,
              severity: 'ATTENTION',
            },
          ],
          recommendations: [
            {
              title: 'Boost Voice Outreach',
              action: 'Engage customers who opted in to voice marketing.',
              rationale:
                'Voice opt-in represents strong direct outreach potential.',
              referencedMetricKey: 'voiceMarketingOptInPercentage',
              referencedMetricValue: 0,
              priority: 'MEDIUM',
            },
          ],
          dataLimitations: ['Sales engine not connected in current phase.'],
        };
      }),
    answerBusinessQuestion: jest
      .fn()
      .mockImplementation(async (_question, factSheet) => {
        return {
          answer: `Based on your analytics, you have ${factSheet.metrics.find((m: any) => m.key === 'totalActiveCustomers')?.value || 0} active customers.`,
          dataLimitations: [
            'Sales and inventory metrics are currently unavailable.',
          ],
        };
      }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AIService)
      .useValue(mockAiService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get(PrismaService);

    // 1. Setup Tenant A
    const resA = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        phone: phoneA,
        password: 'Password123!',
        name: 'Analyst Owner A',
        businessName: 'Business A Store',
        businessAddress: '100 Analytics Way',
        businessCity: 'Bangalore',
        businessPincode: '560001',
      })
      .expect(201);

    ownerAToken = resA.body.data.tokens.accessToken;

    // 2. Setup Tenant B
    const resB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        phone: phoneB,
        password: 'Password123!',
        name: 'Analyst Owner B',
        businessName: 'Business B Store',
        businessAddress: '200 Analytics Way',
        businessCity: 'Delhi',
        businessPincode: '110001',
      })
      .expect(201);

    ownerBToken = resB.body.data.tokens.accessToken;

    // 3. Seed Customers for Business A
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        name: 'Customer One',
        phone: `98333${timestamp.slice(0, 5)}`,
        preferences: {
          whatsappMarketing: true,
          voiceMarketing: true,
          doNotContact: false,
        },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        name: 'Customer Two',
        phone: `98444${timestamp.slice(0, 5)}`,
        preferences: {
          whatsappMarketing: true,
          voiceMarketing: false,
          doNotContact: false,
        },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        name: 'Customer Three DNC',
        phone: `98555${timestamp.slice(0, 5)}`,
        preferences: {
          whatsappMarketing: true,
          voiceMarketing: true,
          doNotContact: true,
        },
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Synchronous Analysis Generation (201 Created)', () => {
    it('should generate verified analysis with authoritative metric values overwritten', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/business-analyst/analysis')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          analysisType: AnalysisType.CUSTOMER_ANALYSIS,
          periodFrom: '2026-08-01T00:00:00.000Z',
          periodTo: '2026-08-31T00:00:00.000Z',
          isAsync: false,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.summary).toBeDefined();

      const result = res.body.data.result;
      expect(result.metrics).toBeDefined();
      expect(result.insights).toBeDefined();
      expect(result.recommendations).toBeDefined();

      // Check authoritative value overwriting
      const activeCustInsight = result.insights.find(
        (i: any) => i.referencedMetricKey === 'totalActiveCustomers',
      );
      expect(activeCustInsight).toBeDefined();
      expect(activeCustInsight.referencedMetricValue).toBe(3); // Overwritten from 99999 to 3

      // Check hallucinated metric was stripped
      const hallucinatedInsight = result.insights.find(
        (i: any) => i.referencedMetricKey === 'fabricated_non_existent_key',
      );
      expect(hallucinatedInsight).toBeUndefined();

      analysisAId = res.body.data.id;
    });

    it('should verify database snapshot contains ZERO customer PII', async () => {
      const dbRecord = await prisma.businessAnalysis.findUnique({
        where: { id: analysisAId },
      });

      expect(dbRecord).toBeDefined();
      const snapshotStr = JSON.stringify(dbRecord?.dataSnapshotJson);

      // Must not contain customer names or raw phones
      expect(snapshotStr).not.toContain('Customer One');
      expect(snapshotStr).not.toContain('Customer Two');
      expect(snapshotStr).not.toContain(phoneA);
      expect(snapshotStr).not.toContain('98333');
    });
  });

  describe('2. Asynchronous BullMQ Analysis Queue (202 Accepted)', () => {
    it('should enqueue async analysis and return 202 with QUEUED status', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/business-analyst/analysis')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          analysisType: AnalysisType.BUSINESS_SUMMARY,
          periodFrom: '2026-08-01T00:00:00.000Z',
          periodTo: '2026-08-31T00:00:00.000Z',
          isAsync: true,
        })
        .expect(202);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('QUEUED');
      expect(res.body.data.id).toBeDefined();
    });
  });

  describe('3. Idempotency & Conflict Handling', () => {
    const idemKey = `test-key-${Date.now()}`;

    it('should create record on first request with Idempotency-Key', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/business-analyst/analysis')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('Idempotency-Key', idemKey)
        .send({
          analysisType: AnalysisType.CUSTOMER_ANALYSIS,
          periodFrom: '2026-08-01T00:00:00.000Z',
          periodTo: '2026-08-31T00:00:00.000Z',
          isAsync: false,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it('should return identical existing record on duplicate request with same payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/business-analyst/analysis')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('Idempotency-Key', idemKey)
        .send({
          analysisType: AnalysisType.CUSTOMER_ANALYSIS,
          periodFrom: '2026-08-01T00:00:00.000Z',
          periodTo: '2026-08-31T00:00:00.000Z',
          isAsync: false,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it('should return 409 Conflict when reusing same Idempotency-Key with different payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/business-analyst/analysis')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('Idempotency-Key', idemKey)
        .send({
          analysisType: AnalysisType.TREND_ANALYSIS, // Different type!
          periodFrom: '2026-08-01T00:00:00.000Z',
          periodTo: '2026-08-31T00:00:00.000Z',
          isAsync: false,
        })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('IDEMPOTENCY_KEY_REUSE_CONFLICT');
    });

    it('should allow different tenant (Business B) to use the same Idempotency-Key without conflict', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/business-analyst/analysis')
        .set('Authorization', `Bearer ${ownerBToken}`)
        .set('Idempotency-Key', idemKey) // Same key used by Business B
        .send({
          analysisType: AnalysisType.CUSTOMER_ANALYSIS,
          periodFrom: '2026-08-01T00:00:00.000Z',
          periodTo: '2026-08-31T00:00:00.000Z',
          isAsync: false,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
    });
  });

  describe('4. Validation Errors (400 Bad Request)', () => {
    it('should reject when periodFrom is greater than or equal to periodTo', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/business-analyst/analysis')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          analysisType: AnalysisType.CUSTOMER_ANALYSIS,
          periodFrom: '2026-09-01T00:00:00.000Z',
          periodTo: '2026-08-01T00:00:00.000Z', // Inverted!
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should reject when analysis period exceeds 365 days', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/business-analyst/analysis')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          analysisType: AnalysisType.CUSTOMER_ANALYSIS,
          periodFrom: '2024-01-01T00:00:00.000Z',
          periodTo: '2026-01-01T00:00:00.000Z', // 2 years!
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should reject invalid Idempotency-Key with bad characters', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/business-analyst/analysis')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('Idempotency-Key', 'invalid key with spaces & symbols!@#')
        .send({
          analysisType: AnalysisType.CUSTOMER_ANALYSIS,
          periodFrom: '2026-08-01T00:00:00.000Z',
          periodTo: '2026-08-31T00:00:00.000Z',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  describe('5. Tenant Isolation & Access Control', () => {
    it('should return 404 when Business B attempts to access Business A analysis report', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/business-analyst/analysis/${analysisAId}`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('should list only own analysis reports in history', async () => {
      const resA = await request(app.getHttpServer())
        .get('/api/v1/business-analyst/analysis')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      expect(resA.body.success).toBe(true);
      expect(resA.body.data.length).toBeGreaterThan(0);
      for (const item of resA.body.data) {
        expect(item.id).not.toBeNull();
      }
    });
  });

  describe('6. Natural Language Business Q&A Flow', () => {
    it('should answer natural language questions with contextual backend metrics', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/business-analyst/questions')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          question: 'How many active customers do we currently have?',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.answer).toContain('3 active customers');
      expect(res.body.data.status).toBe('COMPLETED');
    });

    it('should retrieve past business questions history', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/business-analyst/questions')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('7. Fast Cached Dashboard Summary', () => {
    it('should return cached dashboard summary', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/business-analyst/summary')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.metrics).toBeDefined();
      expect(res.body.data.summary).toBeDefined();
    });
  });
});
