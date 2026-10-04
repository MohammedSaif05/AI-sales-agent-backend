import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';

describe('WhatsAppWebhookService', () => {
  let service: WhatsAppWebhookService;
  let prisma: any;
  let queue: any;

  const testVerifyToken = 'test_webhook_verify_token_secure';
  const testAppSecret = 'test_meta_app_secret_1234567890abcdef';

  beforeEach(async () => {
    prisma = {
      whatsAppWebhookEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppWebhookService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'META_WEBHOOK_VERIFY_TOKEN') return testVerifyToken;
              if (key === 'META_APP_SECRET') return testAppSecret;
              return null;
            }),
          },
        },
        { provide: 'BullQueue_whatsapp-communication', useValue: queue },
      ],
    }).compile();

    service = module.get<WhatsAppWebhookService>(WhatsAppWebhookService);
  });

  describe('verifyWebhookChallenge', () => {
    it('should return challenge on valid mode and token', () => {
      const challenge = '1158201444';
      const result = service.verifyWebhookChallenge(
        'subscribe',
        testVerifyToken,
        challenge,
      );
      expect(result).toBe(challenge);
    });

    it('should throw ForbiddenException if token does not match', () => {
      expect(() =>
        service.verifyWebhookChallenge(
          'subscribe',
          'wrong-token',
          '1158201444',
        ),
      ).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if mode is not subscribe', () => {
      expect(() =>
        service.verifyWebhookChallenge(
          'unsubscribe',
          testVerifyToken,
          '1158201444',
        ),
      ).toThrow(ForbiddenException);
    });
  });

  describe('handleIncomingWebhook - HMAC Signature Verification', () => {
    const payload = { entry: [{ id: '123' }] };
    const payloadStr = JSON.stringify(payload);
    const validSignature =
      'sha256=' +
      crypto
        .createHmac('sha256', testAppSecret)
        .update(payloadStr)
        .digest('hex');

    it('should accept webhook with valid HMAC signature', async () => {
      prisma.whatsAppWebhookEvent.findUnique.mockResolvedValue(null);
      prisma.whatsAppWebhookEvent.create.mockResolvedValue({ id: 'event-1' });

      const result = await service.handleIncomingWebhook(
        payload,
        validSignature,
      );
      expect(result.status).toBe('QUEUED');
    });

    it('should reject webhook with invalid HMAC signature', async () => {
      const invalidSignature =
        'sha256=invalidhash00000000000000000000000000000000000000000000000000000000';

      await expect(
        service.handleIncomingWebhook(payload, invalidSignature),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('handleIncomingWebhook - Durable Staging & Recovery Lifecycle', () => {
    const samplePayload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '100345678901234' },
                messages: [{ id: 'wamid.123', timestamp: '1728036000' }],
              },
            },
          ],
        },
      ],
    };

    it('should create event in RECEIVED status and advance to QUEUED after BullMQ enqueue', async () => {
      prisma.whatsAppWebhookEvent.findUnique.mockResolvedValue(null);
      prisma.whatsAppWebhookEvent.create.mockResolvedValue({ id: 'event-10' });

      const result = await service.handleIncomingWebhook(samplePayload);

      expect(prisma.whatsAppWebhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'RECEIVED',
          providerPhoneNumberId: '100345678901234',
          eventOriginTimestamp: new Date(1728036000 * 1000),
        }),
      });

      expect(queue.add).toHaveBeenCalledWith(
        'PROCESS_WEBHOOK',
        { eventId: 'event-10' },
        expect.any(Object),
      );

      expect(prisma.whatsAppWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-10' },
        data: { status: 'QUEUED' },
      });

      expect(result.status).toBe('QUEUED');
    });

    it('CRITICAL: if BullMQ enqueue fails, status must remain RECEIVED for recovery watchdog', async () => {
      prisma.whatsAppWebhookEvent.findUnique.mockResolvedValue(null);
      prisma.whatsAppWebhookEvent.create.mockResolvedValue({
        id: 'event-stuck',
      });
      queue.add.mockRejectedValue(new Error('Redis connection failure'));

      const result = await service.handleIncomingWebhook(samplePayload);

      // Event remains in RECEIVED state!
      expect(prisma.whatsAppWebhookEvent.update).not.toHaveBeenCalled();
      expect(result.status).toBe('RECEIVED');
    });

    it('should return DUPLICATE_IGNORED if idempotencyKey already exists', async () => {
      prisma.whatsAppWebhookEvent.findUnique.mockResolvedValue({
        id: 'event-existing',
      });

      const result = await service.handleIncomingWebhook(samplePayload);

      expect(result.status).toBe('DUPLICATE_IGNORED');
      expect(prisma.whatsAppWebhookEvent.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('should leave eventOriginTimestamp as null if timestamp is missing or malformed', async () => {
      const payloadWithoutTimestamp = {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '100345678901234' },
                  messages: [{ id: 'wamid.123', timestamp: 'invalid-string' }],
                },
              },
            ],
          },
        ],
      };

      prisma.whatsAppWebhookEvent.findUnique.mockResolvedValue(null);
      prisma.whatsAppWebhookEvent.create.mockResolvedValue({
        id: 'event-no-time',
      });

      await service.handleIncomingWebhook(payloadWithoutTimestamp);

      expect(prisma.whatsAppWebhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventOriginTimestamp: null, // Critical: not server arrival time!
        }),
      });
    });
  });
});
