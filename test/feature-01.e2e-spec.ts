import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Feature 01: Full Production E2E Verification', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Trackers
  let ownerAToken: string;
  let ownerARefreshToken: string;
  let ownerBToken: string;
  let superAdminToken: string;
  let businessAId: string;
  let businessBId: string;
  let customerAId: string;
  let importAId: string;

  const timestamp = Date.now().toString().slice(-6);
  const phoneA = `98765${timestamp.slice(0, 5)}`;
  const phoneB = `98766${timestamp.slice(0, 5)}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Health Check', () => {
    it('/api/v1/health (GET) should return 200 ok', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
    });
  });

  describe('2. Authentication & Sessions Flow', () => {
    it('should register Business Owner A and initialize 7-day hours', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          phone: phoneA,
          password: 'Password123!',
          name: 'Owner Alice',
          businessName: 'Alice Boutique',
          businessAddress: '100 Fashion Street',
          businessCity: 'Mumbai',
          businessPincode: '400001',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.phone).toBe(`+91${phoneA}`);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();

      ownerAToken = res.body.data.tokens.accessToken;
      ownerARefreshToken = res.body.data.tokens.refreshToken;
      businessAId = res.body.data.business.id;

      // Verify default 7 days hours exist in database
      const hours = await prisma.businessHours.findMany({
        where: { businessId: businessAId },
      });
      expect(hours).toHaveLength(7);
    });

    it('should fail registration if phone already registered', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          phone: phoneA,
          password: 'Password123!',
          name: 'Duplicate Alice',
          businessName: 'Duplicate Store',
          businessAddress: '100 St',
          businessCity: 'Mumbai',
          businessPincode: '400001',
        })
        .expect(409);
    });

    it('should login Owner A and return tokens with new session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          phone: phoneA,
          password: 'Password123!',
          deviceInfo: 'Test Device iOS',
        })
        .expect(200);

      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.business.id).toBe(businessAId);
    });

    it('should reject login with wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          phone: phoneA,
          password: 'WrongPassword!',
        })
        .expect(401);
    });

    it('should rotate tokens on /auth/refresh', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: ownerARefreshToken })
        .expect(200);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();

      // Update to rotated tokens
      ownerAToken = res.body.data.accessToken;
      ownerARefreshToken = res.body.data.refreshToken;
    });

    it('should logout and revoke session', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      // Attempting to refresh with revoked token must now fail
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: ownerARefreshToken })
        .expect(401);
    });

    it('should re-login Owner A to continue testing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          phone: phoneA,
          password: 'Password123!',
        })
        .expect(200);

      ownerAToken = res.body.data.tokens.accessToken;
    });

    it('should register Business Owner B for tenant isolation testing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          phone: phoneB,
          password: 'Password123!',
          name: 'Owner Bob',
          businessName: 'Bob Menswear',
          businessAddress: '200 Retail Road',
          businessCity: 'Delhi',
          businessPincode: '110001',
        })
        .expect(201);

      ownerBToken = res.body.data.tokens.accessToken;
      businessBId = res.body.data.business.id;
    });

    it('should authenticate Super Admin with seeded credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          phone: process.env.SUPER_ADMIN_PHONE || '+918148387156',
          password: process.env.SUPER_ADMIN_PASSWORD || 'saif@2005',
        })
        .expect(200);

      expect(res.body.data.user.systemRole).toBe('SUPER_ADMIN');
      superAdminToken = res.body.data.tokens.accessToken;
    });
  });

  describe('3. Business Profile & Hours', () => {
    it('Owner A should retrieve own business profile', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/business')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(businessAId);
      expect(res.body.data.name).toBe('Alice Boutique');
    });

    it('Owner A should update business profile', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/business')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          description: 'Updated boutique description',
          website: 'https://aliceboutique.example.com',
        })
        .expect(200);

      expect(res.body.data.description).toBe('Updated boutique description');
    });

    it('Owner A should retrieve and update 7-day operating hours', async () => {
      const getRes = await request(app.getHttpServer())
        .get('/api/v1/business/hours')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      expect(getRes.body.data).toHaveLength(7);

      // Update hours
      const newHours = getRes.body.data.map((h: any) => ({
        dayOfWeek: h.dayOfWeek,
        openTime: h.isClosed ? null : '11:00',
        closeTime: h.isClosed ? null : '20:00',
        isClosed: h.isClosed,
      }));

      const putRes = await request(app.getHttpServer())
        .put('/api/v1/business/hours')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ hours: newHours })
        .expect(200);

      expect(putRes.body.data[1].openTime).toBe('11:00');
    });
  });

  describe('4. Customer Management & Multi-Tenancy', () => {
    const custPhone = `987654${timestamp.slice(0, 4)}`;

    it('Owner A should create a customer with phone normalization and false consent defaults', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          name: 'Karan Mehra',
          phone: custPhone,
          city: 'Mumbai',
        })
        .expect(201);

      expect(res.body.data.normalizedPhone).toBe(`+91${custPhone}`);
      expect(res.body.data.preferences.whatsappMarketing).toBe(false);
      expect(res.body.data.preferences.voiceMarketing).toBe(false);
      expect(res.body.data.preferences.emailMarketing).toBe(false);
      expect(res.body.data.preferences.doNotContact).toBe(false);

      customerAId = res.body.data.id;
    });

    it('Owner A attempting to duplicate active customer in same business must fail with 409', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          name: 'Duplicate Karan',
          phone: `+91 ${custPhone}`,
        })
        .expect(409);
    });

    it('Owner B should be able to create customer with same phone in DIFFERENT business (Multi-Tenancy)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({
          name: 'Karan in Store B',
          phone: custPhone,
        })
        .expect(201);

      expect(res.body.data.businessId).toBe(businessBId);
    });

    it('TENANT ISOLATION: Owner B cannot read Owner A customer', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerAId}`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .expect(404);
    });

    it('TENANT ISOLATION: Owner B cannot update Owner A customer', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerAId}`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({ name: 'Hacked Name' })
        .expect(404);
    });

    it('TENANT ISOLATION: Owner B cannot delete Owner A customer', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customerAId}`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .expect(404);
    });

    it('Owner A should soft-delete customer', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customerAId}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      // Customer should not appear in active list
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      const found = listRes.body.data.items?.find((c: any) => c.id === customerAId);
      expect(found).toBeUndefined();
    });

    it('Owner A should be able to re-add customer with same phone after soft-deletion (Restoration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          name: 'Karan Restored',
          phone: custPhone,
        })
        .expect(201);

      expect(res.body.data.id).toBe(customerAId);
      expect(res.body.data.deletedAt).toBeNull();
      expect(res.body.data.name).toBe('Karan Restored');
    });
  });

  describe('5. Staged Import Pipeline & Idempotent Confirmation', () => {
    it('should upload CSV sheet and stage rows with phone normalization and intra-file duplicate detection', async () => {
      const csvData = `Name,Mobile,Email,City
Rohit Sharma,9876599901,rohit@example.com,Mumbai
Pooja Hegde,+91 98765 99901,pooja@example.com,Bangalore
Deepak Hooda,919876599902,deepak@example.com,Delhi
Invalid Entry,12345,,`;

      const uploadRes = await request(app.getHttpServer())
        .post('/api/v1/customers/import/file')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .attach('file', Buffer.from(csvData, 'utf-8'), 'customers_test.csv')
        .expect(202);

      expect(uploadRes.body.data.importId).toBeDefined();
      importAId = uploadRes.body.data.importId;

      // Allow background worker a moment to finish staging
      await new Promise((r) => setTimeout(r, 1500));

      // Inspect staged status
      const statusRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/import/${importAId}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      expect(statusRes.body.data.totalRows).toBe(4);
      expect(statusRes.body.data.validRows).toBe(2);
      expect(statusRes.body.data.duplicateRows).toBe(1);
      expect(statusRes.body.data.invalidRows).toBe(1);
      expect(statusRes.body.data.status).toBe('PREVIEW_READY');

      // Inspect staged rows
      const rowsRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/import/${importAId}/rows`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      expect(rowsRes.body.data).toHaveLength(4);
    });

    it('TENANT ISOLATION: Owner B cannot inspect Owner A import', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/customers/import/${importAId}`)
        .set('Authorization', `Bearer ${ownerBToken}`)
        .expect(404);
    });

    it('should confirm import and insert valid rows into Customer table', async () => {
      const confirmRes = await request(app.getHttpServer())
        .post(`/api/v1/customers/import/${importAId}/confirm`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('Idempotency-Key', `idemp-${importAId}`)
        .send({ skipDuplicates: true })
        .expect(200);

      expect(confirmRes.body.data.status).toBe('COMPLETED');
      expect(confirmRes.body.data.importedCount).toBe(2);
    });

    it('IDEMPOTENCY: Repeated confirmation call must return 200 without creating duplicates', async () => {
      const retryRes = await request(app.getHttpServer())
        .post(`/api/v1/customers/import/${importAId}/confirm`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('Idempotency-Key', `idemp-${importAId}`)
        .send({ skipDuplicates: true })
        .expect(200);

      expect(retryRes.body.data.status).toBe('COMPLETED');
      expect(retryRes.body.data.alreadyCompleted).toBe(true);
    });
  });

  describe('6. Super Admin Cross-Tenant Inspection & RBAC', () => {
    it('Super Admin should access platform dashboard stats', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.data.totalBusinesses).toBeGreaterThanOrEqual(2);
      expect(res.body.data.totalCustomers).toBeGreaterThanOrEqual(2);
    });

    it('Super Admin should inspect Business A customer records', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/businesses/${businessAId}/customers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('RBAC: Regular Owner A attempting to access /admin/dashboard must be rejected with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(403);
    });
  });
});
