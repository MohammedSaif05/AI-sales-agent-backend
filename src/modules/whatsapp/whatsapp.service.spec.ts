import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../../database/prisma.service';
import { MetaWhatsAppCloudProvider } from './meta-whatsapp-cloud.provider';
import { CredentialCrypto } from '../../common/utils/credential-crypto.util';
import { WhatsAppConnectionStatus } from '@prisma/client';

describe('WhatsAppService', () => {
  let service: WhatsAppService;
  let prisma: any;
  let metaProvider: any;
  let queue: any;

  const testKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeAll(() => {
    process.env.WHATSAPP_ENCRYPTION_KEY = testKey;
  });

  beforeEach(async () => {
    prisma = {
      whatsAppConnection: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      whatsAppWebhookEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      whatsAppMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };

    metaProvider = {
      exchangeCodeForToken: jest.fn(),
      getPhoneNumberDetails: jest.fn().mockResolvedValue({
        display_phone_number: '+1 555-0100',
        verified_name: 'Test Business',
        quality_rating: 'GREEN',
      }),
      subscribeWabaApps: jest.fn().mockResolvedValue(true),
      unsubscribeWabaApps: jest.fn().mockResolvedValue(true),
    };

    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      upsertJobScheduler: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetaWhatsAppCloudProvider, useValue: metaProvider },
        { provide: 'BullQueue_whatsapp-communication', useValue: queue },
      ],
    }).compile();

    service = module.get<WhatsAppService>(WhatsAppService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('connect', () => {
    it('should create new connection with version 1 and encrypted token', async () => {
      prisma.whatsAppConnection.findUnique.mockResolvedValue(null);
      prisma.whatsAppConnection.create.mockImplementation(({ data }: any) => ({
        id: 'conn-1',
        ...data,
      }));

      const result = await service.connect('biz-1', {
        wabaId: 'waba-100',
        phoneNumberId: 'phone-100',
        accessToken: 'EAAB12345',
      });

      expect(result.id).toBe('conn-1');
      expect(result.connectionVersion).toBe(1);
      expect(result.status).toBe(WhatsAppConnectionStatus.CONNECTED);
      expect(result).not.toHaveProperty('encryptedAccessToken');
      expect(prisma.whatsAppConnection.create).toHaveBeenCalled();
    });

    it('should increment connectionVersion when reconnecting existing connection', async () => {
      prisma.whatsAppConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        businessId: 'biz-1',
        connectionVersion: 2,
        status: WhatsAppConnectionStatus.DISCONNECTED,
      });

      prisma.whatsAppConnection.update.mockImplementation(({ data }: any) => ({
        id: 'conn-1',
        businessId: 'biz-1',
        ...data,
      }));

      const result = await service.connect('biz-1', {
        wabaId: 'waba-100',
        phoneNumberId: 'phone-100',
        accessToken: 'EAAB12345',
      });

      expect(result.connectionVersion).toBe(3);
      expect(result.status).toBe(WhatsAppConnectionStatus.CONNECTED);
      expect(prisma.whatsAppConnection.update).toHaveBeenCalled();
    });

    it('should throw BadRequestException if neither accessToken nor code is provided', async () => {
      await expect(
        service.connect('biz-1', {
          wabaId: 'waba-100',
          phoneNumberId: 'phone-100',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('initiateDisconnect', () => {
    it('should transition to DISCONNECTING and enqueue reconciliation job', async () => {
      prisma.whatsAppConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        businessId: 'biz-1',
        connectionVersion: 1,
        status: WhatsAppConnectionStatus.CONNECTED,
      });

      prisma.whatsAppConnection.update.mockResolvedValue({
        id: 'conn-1',
        businessId: 'biz-1',
        status: WhatsAppConnectionStatus.DISCONNECTING,
        connectionVersion: 1,
      });

      const result = await service.initiateDisconnect(
        'biz-1',
        'User clicked disconnect',
      );

      expect(result.status).toBe(WhatsAppConnectionStatus.DISCONNECTING);
      expect(queue.add).toHaveBeenCalledWith(
        'RECONCILE_DISCONNECT',
        expect.objectContaining({
          connectionId: 'conn-1',
          connectionVersion: 1,
        }),
        expect.any(Object),
      );
    });

    it('should throw NotFoundException if connection does not exist', async () => {
      prisma.whatsAppConnection.findUnique.mockResolvedValue(null);

      await expect(service.initiateDisconnect('biz-unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reconcileDisconnect & Stale Job Protection', () => {
    it('should abort reconciliation if connectionVersion does not match current version', async () => {
      // Job has connectionVersion = 1, but connection in DB is now version = 2 (re-onboarded)
      prisma.whatsAppConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        businessId: 'biz-1',
        connectionVersion: 2,
        status: WhatsAppConnectionStatus.CONNECTED,
      });

      await service.reconcileDisconnect(
        'conn-1',
        1,
        1,
        new Date().toISOString(),
      );

      // Should NOT call unsubscribe or mutate database
      expect(metaProvider.unsubscribeWabaApps).not.toHaveBeenCalled();
      expect(prisma.whatsAppConnection.update).not.toHaveBeenCalled();
    });

    it('should finalize DISCONNECTED state when 24-hour cutoff is exceeded', async () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      prisma.whatsAppConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        businessId: 'biz-1',
        connectionVersion: 1,
        status: WhatsAppConnectionStatus.DISCONNECTING,
        encryptedAccessToken: CredentialCrypto.encrypt('sample-token'),
      });

      await service.reconcileDisconnect(
        'conn-1',
        1,
        1,
        twentyFiveHoursAgo.toISOString(),
      );

      expect(prisma.whatsAppConnection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conn-1', connectionVersion: 1 },
          data: expect.objectContaining({
            status: WhatsAppConnectionStatus.DISCONNECTED,
            disconnectFinalizedAt: expect.any(Date),
          }),
        }),
      );
      // Meta API is skipped once cutoff is exceeded
      expect(metaProvider.unsubscribeWabaApps).not.toHaveBeenCalled();
    });

    it('should successfully unsubscribe from Meta and mark DISCONNECTED', async () => {
      const recent = new Date(Date.now() - 5000);
      prisma.whatsAppConnection.findUnique.mockResolvedValue({
        id: 'conn-1',
        businessId: 'biz-1',
        wabaId: 'waba-1',
        connectionVersion: 1,
        status: WhatsAppConnectionStatus.DISCONNECTING,
        encryptedAccessToken: CredentialCrypto.encrypt('sample-token'),
      });

      await service.reconcileDisconnect('conn-1', 1, 1, recent.toISOString());

      expect(metaProvider.unsubscribeWabaApps).toHaveBeenCalledWith(
        'waba-1',
        'sample-token',
      );
      expect(prisma.whatsAppConnection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conn-1', connectionVersion: 1 },
          data: expect.objectContaining({
            status: WhatsAppConnectionStatus.DISCONNECTED,
          }),
        }),
      );
    });
  });

  describe('runWatchdog', () => {
    it('should discover stale RECEIVED webhook events and retry enqueue', async () => {
      prisma.whatsAppWebhookEvent.findMany.mockResolvedValue([
        { id: 'event-stale-1', idempotencyKey: 'key-1' },
      ]);
      prisma.whatsAppConnection.findMany.mockResolvedValue([]);

      await service.runWatchdog();

      expect(queue.add).toHaveBeenCalledWith(
        'PROCESS_WEBHOOK',
        { eventId: 'event-stale-1' },
        expect.objectContaining({ jobId: 'webhook-key-1' }),
      );
      expect(prisma.whatsAppWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-stale-1' },
        data: { status: 'QUEUED' },
      });
    });

    it('CRITICAL CRASH SAFETY: should discover stranded PENDING outbound messages after crash and transition to DISPATCH_UNKNOWN without resend', async () => {
      prisma.whatsAppWebhookEvent.findMany.mockResolvedValue([]);
      prisma.whatsAppConnection.findMany.mockResolvedValue([]);
      prisma.whatsAppMessage.findMany.mockResolvedValue([
        { id: 'msg-stranded-pending-1' },
      ]);

      await service.runWatchdog();

      expect(prisma.whatsAppMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-stranded-pending-1' },
        data: expect.objectContaining({
          status: 'DISPATCH_UNKNOWN',
          failureSource: 'SYSTEM',
        }),
      });

      // Crucial: queue should NOT have any send message jobs added!
      expect(queue.add).not.toHaveBeenCalledWith(
        expect.stringMatching(/send/i),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
