import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { MetaWhatsAppCloudProvider } from '../src/modules/whatsapp/meta-whatsapp-cloud.provider';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import {
  WhatsAppConnectionStatus,
  WhatsAppMessageStatus,
} from '@prisma/client';

describe('Feature 03: Meta WhatsApp Business Cloud API (E2E Verification)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerAToken: string;
  let staffAToken: string;
  let ownerBToken: string;
  let superAdminToken: string;

  let businessAId: string;

  const mockMetaProvider = {
    exchangeCodeForToken: jest
      .fn()
      .mockResolvedValue('EAAX_MOCK_ACCESS_TOKEN_12345'),
    getPhoneNumberDetails: jest.fn().mockResolvedValue({
      display_phone_number: '+1 555-0199',
      verified_name: 'Acme Superstore',
      quality_rating: 'GREEN',
    }),
    subscribeWabaApps: jest.fn().mockResolvedValue(true),
    unsubscribeWabaApps: jest.fn().mockResolvedValue(true),
    sendTextMessage: jest.fn().mockResolvedValue({
      messageId:
        'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzQTFERUZDQzEzNDg2NUM4AA==',
    }),
  };

  const ts = Date.now().toString().slice(-5);
  const ownerAPhone = `98111${ts}`;
  const staffAPhone = `98222${ts}`;
  const ownerBPhone = `98333${ts}`;

  beforeAll(async () => {
    process.env.WHATSAPP_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'test_webhook_verify_token_secure';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MetaWhatsAppCloudProvider)
      .useValue(mockMetaProvider)
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

    // Setup Test Tenants and Users
    // 1. Business Owner A
    const resA = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        phone: ownerAPhone,
        password: 'Password123!',
        name: 'Owner A',
        businessName: 'Business A Store',
        businessAddress: '123 Market St',
        businessCity: 'Mumbai',
        businessPincode: '400001',
      })
      .expect(201);

    ownerAToken = resA.body.data.tokens.accessToken;
    businessAId = resA.body.data.business.id;

    // 2. Staff for Business A
    const resStaffRegister = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        phone: staffAPhone,
        password: 'Password123!',
        name: 'Staff A',
        businessName: 'Temp Store',
        businessAddress: '123 Market St',
        businessCity: 'Mumbai',
        businessPincode: '400001',
      })
      .expect(201);

    await prisma.businessUser.update({
      where: {
        businessId_userId: {
          businessId: resStaffRegister.body.data.business.id,
          userId: resStaffRegister.body.data.user.id,
        },
      },
      data: { businessId: businessAId, role: 'STAFF' },
    });

    const resStaffLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        phone: staffAPhone,
        password: 'Password123!',
      })
      .expect(200);

    staffAToken = resStaffLogin.body.data.tokens.accessToken;

    // 3. Business Owner B
    const resB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        phone: ownerBPhone,
        password: 'Password123!',
        name: 'Owner B',
        businessName: 'Business B Store',
        businessAddress: '456 Commercial Rd',
        businessCity: 'Delhi',
        businessPincode: '110001',
      })
      .expect(201);

    ownerBToken = resB.body.data.tokens.accessToken;

    // 4. Super Admin
    const resAdminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        phone: process.env.SUPER_ADMIN_PHONE || '+918148387156',
        password: process.env.SUPER_ADMIN_PASSWORD || 'saif@2005',
      })
      .expect(200);

    superAdminToken = resAdminLogin.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    // Teardown
    await prisma.whatsAppMessage.deleteMany({});
    await prisma.whatsAppWebhookEvent.deleteMany({});
    await prisma.whatsAppConnection.deleteMany({});
    await app.close();
  });

  describe('1. Webhook Challenge Handshake (GET /api/v1/whatsapp/webhook)', () => {
    it('should return challenge plain text when hub.verify_token matches', async () => {
      const challenge = '987654321';
      const res = await request(app.getHttpServer())
        .get('/api/v1/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test_webhook_verify_token_secure',
          'hub.challenge': challenge,
        })
        .expect(200);

      expect(res.text).toBe(challenge);
    });

    it('should return 403 Forbidden when hub.verify_token is incorrect', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'invalid_token_123',
          'hub.challenge': '12345',
        })
        .expect(403);
    });
  });

  describe('2. WhatsApp Connection Lifecycle', () => {
    it('Owner A should connect WhatsApp account successfully', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/connect')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          wabaId: '109876543210987',
          phoneNumberId: '100345678901234',
          accessToken: 'EAAX_TEST_TOKEN',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.businessId).toBe(businessAId);
      expect(res.body.data.status).toBe(WhatsAppConnectionStatus.CONNECTED);
      expect(res.body.data.connectionVersion).toBe(1);
      expect(res.body.data).not.toHaveProperty('encryptedAccessToken'); // Token must be redacted!
    });

    it('Staff A cannot connect WhatsApp (RolesGuard: OWNER only)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/connect')
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({
          wabaId: '109876543210987',
          phoneNumberId: '100345678901234',
          accessToken: 'EAAX_TEST_TOKEN',
        })
        .expect(403);
    });

    it('Owner A should retrieve connection details without exposing access token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/whatsapp/connection')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.wabaId).toBe('109876543210987');
      expect(res.body.data.phoneNumberId).toBe('100345678901234');
      expect(res.body.data).not.toHaveProperty('encryptedAccessToken');
    });

    it('Tenant Isolation: Owner B should see no WhatsApp connection for their business', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/whatsapp/connection')
        .set('Authorization', `Bearer ${ownerBToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it('Re-connecting should increment connectionVersion', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/connect')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          wabaId: '109876543210987',
          phoneNumberId: '100345678901234',
          accessToken: 'EAAX_NEW_TOKEN',
        })
        .expect(201);

      expect(res.body.data.connectionVersion).toBe(2);
    });

    it('Owner A initiates disconnect -> transitions to DISCONNECTING', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/disconnect')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ reason: 'Upgrading provider credentials' })
        .expect(200);

      expect(res.body.data.status).toBe(WhatsAppConnectionStatus.DISCONNECTING);

      // Reconnect so subsequent messaging tests have an active connection
      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/connect')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          wabaId: '109876543210987',
          phoneNumberId: '100345678901234',
          accessToken: 'EAAX_RECONNECT_TOKEN',
        })
        .expect(201);
    });
  });

  describe('3. Webhook Ingress & Idempotency (POST /api/v1/whatsapp/webhook)', () => {
    const webhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '109876543210987',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+1 555-0199',
                  phone_number_id: '100345678901234',
                },
                contacts: [
                  { profile: { name: 'Alice Smith' }, wa_id: '919876543210' },
                ],
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.HBgLINBOUND_MSG_1',
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    text: { body: 'Inquiry about store products' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    it('should stage webhook event and enqueue to BullMQ', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/webhook')
        .send(webhookPayload)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(['QUEUED', 'RECEIVED']).toContain(res.body.data.status);
    });

    it('Duplicate webhook event should return DUPLICATE_IGNORED', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/webhook')
        .send(webhookPayload)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('DUPLICATE_IGNORED');
    });
  });

  describe('4. Outbound Messaging & 24-Hour Service Window', () => {
    const customerPhone = '+919123456780';

    it('should reject outbound send with 400 when no inbound message exists for customer', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/messages')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          recipientPhone: customerPhone,
          body: 'Hello without service window',
        })
        .expect(400);

      expect(res.body.message).toContain('Customer service window is closed');
    });

    it('should send outbound message within valid 24h window', async () => {
      // Connect connection and seed inbound message from customerPhone within last 2 hours
      const conn = await prisma.whatsAppConnection.findUnique({
        where: { businessId: businessAId },
      });

      await prisma.whatsAppMessage.create({
        data: {
          businessId: businessAId,
          connectionId: conn!.id,
          providerPhoneNumberId: conn!.phoneNumberId,
          direction: 'INBOUND',
          status: WhatsAppMessageStatus.DELIVERED,
          body: 'Hi, are you open today?',
          senderPhone: customerPhone,
          recipientPhone: conn!.displayPhoneNumber,
          eventOriginTimestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
          providerMessageId: 'wamid.HBgLSEEDED_INBOUND_1',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/messages')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          recipientPhone: customerPhone,
          body: 'Yes, we are open until 9 PM!',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(WhatsAppMessageStatus.SENT);
      expect(res.body.data.providerMessageId).toBe(
        'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzQTFERUZDQzEzNDg2NUM4AA==',
      );
    });

    it('should reject outbound send when >24 hours have elapsed', async () => {
      const expiredCustomerPhone = '+919123456789';
      const conn = await prisma.whatsAppConnection.findUnique({
        where: { businessId: businessAId },
      });

      // Inbound message 26 hours ago
      await prisma.whatsAppMessage.create({
        data: {
          businessId: businessAId,
          connectionId: conn!.id,
          providerPhoneNumberId: conn!.phoneNumberId,
          direction: 'INBOUND',
          status: WhatsAppMessageStatus.DELIVERED,
          body: 'Hi from 26 hours ago',
          senderPhone: expiredCustomerPhone,
          recipientPhone: conn!.displayPhoneNumber,
          eventOriginTimestamp: new Date(Date.now() - 26 * 60 * 60 * 1000),
          providerMessageId: 'wamid.HBgLSEEDED_EXPIRED_1',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/messages')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          recipientPhone: expiredCustomerPhone,
          body: 'Testing expired service window',
        })
        .expect(400);

      expect(res.body.message).toContain('Customer service window expired');
    });
  });

  describe('5. Provider Identity Trust Boundary & Ambiguous Resolution', () => {
    let ambiguousMessageId: string;

    beforeEach(async () => {
      const conn = await prisma.whatsAppConnection.findUnique({
        where: { businessId: businessAId },
      });

      const ambig = await prisma.whatsAppMessage.create({
        data: {
          businessId: businessAId,
          connectionId: conn!.id,
          providerPhoneNumberId: conn!.phoneNumberId,
          direction: 'OUTBOUND',
          status: WhatsAppMessageStatus.DISPATCH_UNKNOWN,
          body: 'Important order update that encountered network drop',
          senderPhone: conn!.displayPhoneNumber,
          recipientPhone: '+919123456780',
          failureSource: 'SYSTEM',
          failureReason: 'Ambiguous transport timeout (HTTP 504)',
        },
      });
      ambiguousMessageId = ambig.id;
    });

    it('CRITICAL TRUST BOUNDARY: Client cannot send hasAuthoritativeProviderEvidence (ValidationPipe forbids)', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/whatsapp/messages/${ambiguousMessageId}/resolve-ambiguous`,
        )
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          action: 'MARK_SENT',
          providerMessageId: 'wamid.HBgLFORBIDDEN_FIELD_TEST',
          reason: 'Attempting client-side provenance override',
          hasAuthoritativeProviderEvidence: true, // MUST BE FORBIDDEN
        })
        .expect(400);

      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body.details)).toContain(
        'property hasAuthoritativeProviderEvidence should not exist',
      );
    });

    it('MARK_SENT with operator wamid must NOT populate canonical providerMessageId', async () => {
      const operatorWamid = 'wamid.HBgLOPERATOR_SUPPLIED_WAMID_12345';

      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/whatsapp/messages/${ambiguousMessageId}/resolve-ambiguous`,
        )
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          action: 'MARK_SENT',
          providerMessageId: operatorWamid,
          reason:
            'Verified in Meta WhatsApp Manager logs that message was dispatched successfully',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(WhatsAppMessageStatus.SENT);
      // Canonical ID is NULL
      expect(res.body.data.providerMessageId).toBeNull();
      // Operator wamid is stored in manualResolutionProviderMessageId
      expect(res.body.data.manualResolutionProviderMessageId).toBe(
        operatorWamid,
      );
      // Provenance set to MANUAL_OPERATOR_ASSERTION
      expect(res.body.data.resolutionSource).toBe('MANUAL_OPERATOR_ASSERTION');
    });

    it('MARK_FAILED resolves message to FAILED with MANUAL_RESOLUTION', async () => {
      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/whatsapp/messages/${ambiguousMessageId}/resolve-ambiguous`,
        )
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          action: 'MARK_FAILED',
          reason: 'Confirmed with recipient that message was not delivered',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(WhatsAppMessageStatus.FAILED);
      expect(res.body.data.failureSource).toBe('MANUAL_RESOLUTION');
    });

    it('Cross-tenant resolution blocked: Owner B cannot resolve Owner A message', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/whatsapp/messages/${ambiguousMessageId}/resolve-ambiguous`,
        )
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({
          action: 'MARK_FAILED',
          reason: 'Cross-tenant attempt',
        })
        .expect(404);
    });

    it('Staff A cannot resolve ambiguous message (OWNER only)', async () => {
      await request(app.getHttpServer())
        .post(
          `/api/v1/whatsapp/messages/${ambiguousMessageId}/resolve-ambiguous`,
        )
        .set('Authorization', `Bearer ${staffAToken}`)
        .send({
          action: 'MARK_FAILED',
          reason: 'Staff attempt',
        })
        .expect(403);
    });

    it('Crash recovery watchdog: Stranded PENDING messages transition to DISPATCH_UNKNOWN without resend', async () => {
      const conn = await prisma.whatsAppConnection.findUnique({
        where: { businessId: businessAId },
      });

      const strandedPending = await prisma.whatsAppMessage.create({
        data: {
          businessId: businessAId,
          connectionId: conn!.id,
          providerPhoneNumberId: conn!.phoneNumberId,
          direction: 'OUTBOUND',
          status: WhatsAppMessageStatus.PENDING,
          body: 'Message in flight during server power loss',
          senderPhone: conn!.displayPhoneNumber,
          recipientPhone: '+919123456780',
          createdAt: new Date(Date.now() - 3 * 60 * 1000), // 3 mins ago (stranded)
        },
      });

      const whatsappService = app.get(WhatsAppService);
      await whatsappService.runWatchdog();

      const recovered = await prisma.whatsAppMessage.findUnique({
        where: { id: strandedPending.id },
      });

      expect(recovered!.status).toBe(WhatsAppMessageStatus.DISPATCH_UNKNOWN);
      expect(recovered!.failureSource).toBe('SYSTEM');
    });
  });

  describe('6. Super Admin Overview', () => {
    it('Super Admin can list platform-wide WhatsApp connections', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/whatsapp/connections')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const connA = res.body.data.find(
        (c: any) => c.businessId === businessAId,
      );
      expect(connA).toBeDefined();
      expect(connA).not.toHaveProperty('encryptedAccessToken');
    });
  });
});
