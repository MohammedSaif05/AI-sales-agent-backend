import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AIService } from '../src/modules/ai/ai.service';
import { AnalysisType } from '@prisma/client';

describe('Feature 02: Super Admin Backend APIs E2E Tests (Phase 1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let superAdminToken: string;
  let ownerAToken: string;
  let businessAId: string;
  let businessBId: string;
  let analysisAId: string;
  let questionAId: string;

  const timestamp = Date.now().toString().slice(-6);
  const phoneAdmin = process.env.SUPER_ADMIN_PHONE || '+918148387156';
  const passwordAdmin = process.env.SUPER_ADMIN_PASSWORD || 'saif@2005';
  const phoneA = `98333${timestamp.slice(0, 5)}`;
  const phoneB = `98444${timestamp.slice(0, 5)}`;

  const mockAiService = {
    generateBusinessAnalysis: jest
      .fn()
      .mockImplementation(async (_factSheet, _type) => {
        return {
          summary: 'Super Admin test analytical summary grounded in metrics.',
          insights: [
            {
              title: 'Customer Acquisition Health',
              description: 'Active customer base growing steadily.',
              category: 'CUSTOMER_ACQUISITION',
              referencedMetricKey: 'totalActiveCustomers',
              referencedMetricValue: 100,
              severity: 'POSITIVE',
            },
          ],
          recommendations: [
            {
              title: 'WhatsApp Broadcast',
              action: 'Engage WhatsApp consented customers.',
              rationale: 'High consent reachability.',
              referencedMetricKey: 'effectiveWhatsappEligibleCount',
              referencedMetricValue: 50,
              priority: 'HIGH',
            },
          ],
          dataLimitations: ['Sales engine not connected.'],
        };
      }),
    answerBusinessQuestion: jest
      .fn()
      .mockImplementation(async (question, factSheet) => {
        return {
          answer: `Based on current analytics, your store has ${factSheet.metrics.find((m: any) => m.key === 'totalActiveCustomers')?.value || 0} active customers.`,
          dataLimitations: [],
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

    // 1. Authenticate Super Admin
    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        phone: phoneAdmin,
        password: passwordAdmin,
      });

    if (adminLoginRes.status === 200) {
      superAdminToken = adminLoginRes.body.data.tokens.accessToken;
    }

    // 2. Register Business A (with customers, analysis, question)
    const resA = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        phone: phoneA,
        password: 'Password123!',
        name: 'Store Owner A',
        businessName: 'Admin Test Boutique A',
        businessAddress: '101 Admin Road',
        businessCity: 'Mumbai',
        businessPincode: '400001',
      })
      .expect(201);

    ownerAToken = resA.body.data.tokens.accessToken;
    businessAId = resA.body.data.business.id;

    // Create customers for Business A
    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        name: 'Admin Test Customer 1',
        phone: '9876540001',
        preferences: {
          whatsappMarketing: true,
          doNotContact: false,
        },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        name: 'Admin Test Customer 2',
        phone: '9876540002',
        preferences: {
          whatsappMarketing: false,
          doNotContact: true,
        },
      })
      .expect(201);

    // Generate an analysis for Business A
    const analysisRes = await request(app.getHttpServer())
      .post('/api/v1/business-analyst/analysis')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        analysisType: AnalysisType.CUSTOMER_ANALYSIS,
        periodFrom: '2026-08-01T00:00:00.000Z',
        periodTo: '2026-09-01T00:00:00.000Z',
        isAsync: false,
      })
      .expect(201);

    analysisAId = analysisRes.body.data.id;

    // Ask a question for Business A
    const questionRes = await request(app.getHttpServer())
      .post('/api/v1/business-analyst/questions')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        question: 'What is our current customer opt-in rate?',
      })
      .expect(201);

    questionAId = questionRes.body.data.id;

    // 3. Register Business B (Empty store with 0 customers)
    const resB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        phone: phoneB,
        password: 'Password123!',
        name: 'Store Owner B',
        businessName: 'Admin Test Boutique B (Empty)',
        businessAddress: '202 Admin Road',
        businessCity: 'Pune',
        businessPincode: '411001',
      })
      .expect(201);

    businessBId = resB.body.data.business.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Security & RBAC Guards', () => {
    it('should reject unauthenticated request with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/businesses/${businessAId}/analyst-summary`)
        .expect(401);
    });

    it('should reject regular store owner with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/businesses/${businessAId}/analyst-summary`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(403);
    });

    it('should reject regular store owner from accessing analyses history with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/businesses/${businessAId}/analyses`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(403);
    });

    it('should reject regular store owner from accessing questions history with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/businesses/${businessAId}/questions`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(403);
    });
  });

  describe('2. GET /api/v1/admin/businesses/:id/analyst-summary', () => {
    it('Super Admin should retrieve business analyst summary for Business A', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/businesses/${businessAId}/analyst-summary`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.summary).toBeDefined();
      expect(res.body.data.metrics).toBeInstanceOf(Array);
      expect(res.body.data.insights).toBeInstanceOf(Array);
      expect(res.body.data.recommendations).toBeInstanceOf(Array);

      const activeMetric = res.body.data.metrics.find(
        (m: any) => m.key === 'totalActiveCustomers',
      );
      expect(activeMetric).toBeDefined();
      expect(activeMetric.value).toBe(2);
    });

    it('Super Admin should retrieve empty summary with limitations for Business B (0 customers)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/businesses/${businessBId}/analyst-summary`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.metrics).toBeInstanceOf(Array);
      const activeMetric = res.body.data.metrics.find(
        (m: any) => m.key === 'totalActiveCustomers',
      );
      expect(activeMetric.value).toBe(0);
    });

    it('should return 404 BUSINESS_NOT_FOUND for non-existent business ID', async () => {
      const res = await request(app.getHttpServer())
        .get(
          '/api/v1/admin/businesses/00000000-0000-0000-0000-000000000000/analyst-summary',
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('BUSINESS_NOT_FOUND');
    });
  });

  describe('3. GET /api/v1/admin/businesses/:id/analyses', () => {
    it('Super Admin should list paginated historical analyses for Business A', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/businesses/${businessAId}/analyses?page=1&limit=10`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);

      const item = res.body.data[0];
      expect(item.id).toBe(analysisAId);
      expect(item.analysisType).toBe(AnalysisType.CUSTOMER_ANALYSIS);
      expect(item.status).toBe('COMPLETED');
    });

    it('Super Admin should filter analyses by status', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/admin/businesses/${businessAId}/analyses?status=COMPLETED`,
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(
        res.body.data.every((a: any) => a.status === 'COMPLETED'),
      ).toBe(true);
    });

    it('should return 404 BUSINESS_NOT_FOUND for invalid business ID', async () => {
      await request(app.getHttpServer())
        .get(
          '/api/v1/admin/businesses/00000000-0000-0000-0000-000000000000/analyses',
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(404);
    });
  });

  describe('4. GET /api/v1/admin/businesses/:id/analyses/:analysisId', () => {
    it('Super Admin should inspect specific analysis report detail', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/admin/businesses/${businessAId}/analyses/${analysisAId}`,
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(analysisAId);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.result).toBeDefined();
      expect(res.body.data.result.metrics).toBeInstanceOf(Array);
    });

    it('CROSS-TENANT ISOLATION: Super Admin requesting Analysis A under Business B URL must return 404', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/admin/businesses/${businessBId}/analyses/${analysisAId}`,
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.errorCode).toBe('ANALYSIS_NOT_FOUND');
    });

    it('should return 404 for non-existent analysis ID', async () => {
      await request(app.getHttpServer())
        .get(
          `/api/v1/admin/businesses/${businessAId}/analyses/00000000-0000-0000-0000-000000000000`,
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(404);
    });
  });

  describe('5. GET /api/v1/admin/businesses/:id/questions', () => {
    it('Super Admin should retrieve paginated questions history for Business A', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/businesses/${businessAId}/questions`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const q = res.body.data.find((item: any) => item.id === questionAId);
      expect(q).toBeDefined();
      expect(q.question).toBe('What is our current customer opt-in rate?');
      expect(q.answer).toBeDefined();
      expect(q.status).toBe('COMPLETED');
    });

    it('Super Admin should get empty questions array for Business B (no questions asked)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/businesses/${businessBId}/questions`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });

    it('should return 404 BUSINESS_NOT_FOUND for invalid business ID', async () => {
      await request(app.getHttpServer())
        .get(
          '/api/v1/admin/businesses/00000000-0000-0000-0000-000000000000/questions',
        )
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(404);
    });
  });

  describe('6. Zero PII Exposure Verification', () => {
    it('should guarantee no customer phone numbers or names leak into admin analyst responses', async () => {
      const [summaryRes, analysesRes, detailRes, questionsRes] =
        await Promise.all([
          request(app.getHttpServer())
            .get(`/api/v1/admin/businesses/${businessAId}/analyst-summary`)
            .set('Authorization', `Bearer ${superAdminToken}`),
          request(app.getHttpServer())
            .get(`/api/v1/admin/businesses/${businessAId}/analyses`)
            .set('Authorization', `Bearer ${superAdminToken}`),
          request(app.getHttpServer())
            .get(
              `/api/v1/admin/businesses/${businessAId}/analyses/${analysisAId}`,
            )
            .set('Authorization', `Bearer ${superAdminToken}`),
          request(app.getHttpServer())
            .get(`/api/v1/admin/businesses/${businessAId}/questions`)
            .set('Authorization', `Bearer ${superAdminToken}`),
        ]);

      const responsesText = JSON.stringify([
        summaryRes.body,
        analysesRes.body,
        detailRes.body,
        questionsRes.body,
      ]);

      // Verify customer phone numbers and names do not leak
      expect(responsesText).not.toContain('9876540001');
      expect(responsesText).not.toContain('9876540002');
      expect(responsesText).not.toContain('Admin Test Customer 1');
      expect(responsesText).not.toContain('Admin Test Customer 2');
    });
  });
});
