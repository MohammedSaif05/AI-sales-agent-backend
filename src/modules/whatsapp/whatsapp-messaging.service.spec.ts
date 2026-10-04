import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { WhatsAppMessagingService } from './whatsapp-messaging.service';
import { PrismaService } from '../../database/prisma.service';
import {
  MetaAmbiguousError,
  MetaClientError,
  MetaWhatsAppCloudProvider,
} from './meta-whatsapp-cloud.provider';
import { CredentialCrypto } from '../../common/utils/credential-crypto.util';
import {
  WhatsAppConnectionStatus,
  WhatsAppMessageStatus,
} from '@prisma/client';

describe('WhatsAppMessagingService', () => {
  let service: WhatsAppMessagingService;
  let prisma: any;
  let metaProvider: any;

  const testKey =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeAll(() => {
    process.env.WHATSAPP_ENCRYPTION_KEY = testKey;
  });

  beforeEach(async () => {
    prisma = {
      whatsAppConnection: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      whatsAppMessage: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        findFirst: jest.fn(),
      },
    };

    metaProvider = {
      sendTextMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppMessagingService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetaWhatsAppCloudProvider, useValue: metaProvider },
      ],
    }).compile();

    service = module.get<WhatsAppMessagingService>(WhatsAppMessagingService);
  });

  describe('sendMessage - 24-Hour Service Window', () => {
    const validConnection = {
      id: 'conn-1',
      businessId: 'biz-1',
      phoneNumberId: 'phone-100',
      displayPhoneNumber: '+919999999999',
      encryptedAccessToken: CredentialCrypto.encrypt('sample-token'),
      status: WhatsAppConnectionStatus.CONNECTED,
    };

    it('should successfully send message when inside 24-hour service window', async () => {
      prisma.whatsAppConnection.findUnique.mockResolvedValue(validConnection);
      prisma.customer.findFirst.mockResolvedValue(null);

      // Inbound customer message received 2 hours ago with authoritative eventOriginTimestamp
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      prisma.whatsAppMessage.findFirst.mockResolvedValue({
        id: 'msg-inbound-1',
        eventOriginTimestamp: twoHoursAgo,
        direction: 'INBOUND',
      });

      prisma.whatsAppMessage.create.mockResolvedValue({
        id: 'msg-out-1',
        status: WhatsAppMessageStatus.PENDING,
      });

      metaProvider.sendTextMessage.mockResolvedValue({
        messageId:
          'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzQTFERUZDQzEzNDg2NUM4AA==',
      });

      prisma.whatsAppMessage.update.mockImplementation(({ data }: any) => ({
        id: 'msg-out-1',
        ...data,
      }));

      const result = await service.sendMessage('biz-1', {
        recipientPhone: '+919876543210',
        body: 'Hello inside 24h window',
      });

      expect(result.status).toBe(WhatsAppMessageStatus.SENT);
      expect(result.providerMessageId).toBe(
        'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzQTFERUZDQzEzNDg2NUM4AA==',
      );
    });

    it('should reject outbound send when >24 hours elapsed since last inbound customer message', async () => {
      prisma.whatsAppConnection.findUnique.mockResolvedValue(validConnection);
      prisma.customer.findFirst.mockResolvedValue(null);

      // Inbound message 25 hours ago
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      prisma.whatsAppMessage.findFirst.mockResolvedValue({
        id: 'msg-inbound-old',
        eventOriginTimestamp: twentyFiveHoursAgo,
        direction: 'INBOUND',
      });

      await expect(
        service.sendMessage('biz-1', {
          recipientPhone: '+919876543210',
          body: 'Hello expired window',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(metaProvider.sendTextMessage).not.toHaveBeenCalled();
    });

    it('should reject outbound send when no inbound message exists for recipient', async () => {
      prisma.whatsAppConnection.findUnique.mockResolvedValue(validConnection);
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.whatsAppMessage.findFirst.mockResolvedValue(null);

      await expect(
        service.sendMessage('biz-1', {
          recipientPhone: '+919876543210',
          body: 'Hello no window',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject outbound send when inbound message exists but eventOriginTimestamp is null', async () => {
      prisma.whatsAppConnection.findUnique.mockResolvedValue(validConnection);
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.whatsAppMessage.findFirst.mockResolvedValue({
        id: 'msg-inbound-no-time',
        eventOriginTimestamp: null, // Missing authoritative timestamp
        direction: 'INBOUND',
      });

      await expect(
        service.sendMessage('biz-1', {
          recipientPhone: '+919876543210',
          body: 'Hello null timestamp',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject outbound send if customer has opted out (doNotContact=true)', async () => {
      prisma.whatsAppConnection.findUnique.mockResolvedValue(validConnection);
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust-1',
        preferences: { doNotContact: true },
      });

      await expect(
        service.sendMessage('biz-1', {
          recipientPhone: '+919876543210',
          body: 'Hello opted out',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendMessage - Ambiguity & Crash Handling', () => {
    const validConnection = {
      id: 'conn-1',
      businessId: 'biz-1',
      phoneNumberId: 'phone-100',
      displayPhoneNumber: '+919999999999',
      encryptedAccessToken: CredentialCrypto.encrypt('sample-token'),
      status: WhatsAppConnectionStatus.CONNECTED,
    };

    beforeEach(() => {
      prisma.whatsAppConnection.findUnique.mockResolvedValue(validConnection);
      prisma.customer.findFirst.mockResolvedValue(null);
      prisma.whatsAppMessage.findFirst.mockResolvedValue({
        id: 'msg-inbound-1',
        eventOriginTimestamp: new Date(),
        direction: 'INBOUND',
      });
      prisma.whatsAppMessage.create.mockResolvedValue({
        id: 'msg-out-1',
        status: WhatsAppMessageStatus.PENDING,
      });
    });

    it('should transition to FAILED on definitive 4xx provider rejection', async () => {
      metaProvider.sendTextMessage.mockRejectedValue(
        new MetaClientError(
          400,
          100,
          undefined,
          'Invalid recipient phone number',
        ),
      );

      prisma.whatsAppMessage.update.mockImplementation(({ data }: any) => ({
        id: 'msg-out-1',
        ...data,
      }));

      const result = await service.sendMessage('biz-1', {
        recipientPhone: '+919876543210',
        body: 'Hello rejected',
      });

      expect(result.status).toBe(WhatsAppMessageStatus.FAILED);
      expect(result.failureSource).toBe('PROVIDER');
    });

    it('should transition to DISPATCH_UNKNOWN on ambiguous 5xx server error (NO automatic resend)', async () => {
      metaProvider.sendTextMessage.mockRejectedValue(
        new MetaAmbiguousError(
          new Error('Gateway Timeout'),
          'Meta API server error (HTTP 504)',
        ),
      );

      prisma.whatsAppMessage.update.mockImplementation(({ data }: any) => ({
        id: 'msg-out-1',
        ...data,
      }));

      const result = await service.sendMessage('biz-1', {
        recipientPhone: '+919876543210',
        body: 'Hello ambiguous 504',
      });

      expect(result.status).toBe(WhatsAppMessageStatus.DISPATCH_UNKNOWN);
      expect(result.failureSource).toBe('SYSTEM');
      expect(metaProvider.sendTextMessage).toHaveBeenCalledTimes(1); // STRICT: NO resend!
    });

    it('should transition to DISPATCH_UNKNOWN on socket timeout / connection drop (NO automatic resend)', async () => {
      metaProvider.sendTextMessage.mockRejectedValue(
        new MetaAmbiguousError(
          new Error('ECONNRESET'),
          'Ambiguous transport error: socket hang up',
        ),
      );

      prisma.whatsAppMessage.update.mockImplementation(({ data }: any) => ({
        id: 'msg-out-1',
        ...data,
      }));

      const result = await service.sendMessage('biz-1', {
        recipientPhone: '+919876543210',
        body: 'Hello connection dropped',
      });

      expect(result.status).toBe(WhatsAppMessageStatus.DISPATCH_UNKNOWN);
      expect(metaProvider.sendTextMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveAmbiguousMessage - Provider Identity Trust Boundary', () => {
    it('should mark FAILED with MANUAL_RESOLUTION when action is MARK_FAILED', async () => {
      prisma.whatsAppMessage.findFirst.mockResolvedValue({
        id: 'msg-ambig-1',
        businessId: 'biz-1',
        status: WhatsAppMessageStatus.DISPATCH_UNKNOWN,
      });

      prisma.whatsAppMessage.update.mockImplementation(({ data }: any) => ({
        id: 'msg-ambig-1',
        ...data,
      }));

      const result = await service.resolveAmbiguousMessage(
        'biz-1',
        'msg-ambig-1',
        {
          action: 'MARK_FAILED',
          reason: 'Customer reported they never received the message',
        },
        'user-1',
      );

      expect(result.status).toBe(WhatsAppMessageStatus.FAILED);
      expect(result.failureSource).toBe('MANUAL_RESOLUTION');
      expect(result.resolvedByUserId).toBe('user-1');
    });

    it('CRITICAL: MARK_SENT with operator wamid must NOT populate canonical providerMessageId', async () => {
      const operatorWamid =
        'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzQTFERUZDQzEzNDg2NUM4AA==';

      prisma.whatsAppMessage.findFirst.mockResolvedValue({
        id: 'msg-ambig-1',
        businessId: 'biz-1',
        providerPhoneNumberId: 'phone-100',
        status: WhatsAppMessageStatus.DISPATCH_UNKNOWN,
      });

      prisma.whatsAppMessage.findUnique.mockResolvedValue(null); // No collision

      prisma.whatsAppMessage.update.mockImplementation(({ data }: any) => ({
        id: 'msg-ambig-1',
        ...data,
      }));

      const result = await service.resolveAmbiguousMessage(
        'biz-1',
        'msg-ambig-1',
        {
          action: 'MARK_SENT',
          providerMessageId: operatorWamid,
          providerPhoneNumberId: 'phone-100',
          reason:
            'Verified in Meta WhatsApp Manager logs that message was dispatched',
        },
        'user-1',
      );

      // MANDATORY SECURITY INVARIANTS:
      expect(result.status).toBe(WhatsAppMessageStatus.SENT);
      expect(result.providerMessageId).toBeNull(); // Canonical ID is strictly NULL!
      expect(result.manualResolutionProviderMessageId).toBe(operatorWamid); // Operator wamid stored separately
      expect(result.resolutionSource).toBe('MANUAL_OPERATOR_ASSERTION'); // Server sets provenance
      expect(result.resolvedByUserId).toBe('user-1');
    });

    it('should reject MARK_SENT if operator wamid collides with an existing canonical wamid', async () => {
      const collidingWamid =
        'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzQTFERUZDQzEzNDg2NUM4AA==';

      prisma.whatsAppMessage.findFirst.mockResolvedValue({
        id: 'msg-ambig-1',
        businessId: 'biz-1',
        providerPhoneNumberId: 'phone-100',
        status: WhatsAppMessageStatus.DISPATCH_UNKNOWN,
      });

      // Existing message already has this canonical wamid!
      prisma.whatsAppMessage.findUnique.mockResolvedValue({
        id: 'msg-canonical-other',
        providerMessageId: collidingWamid,
      });

      await expect(
        service.resolveAmbiguousMessage(
          'biz-1',
          'msg-ambig-1',
          {
            action: 'MARK_SENT',
            providerMessageId: collidingWamid,
            reason: 'Testing collision',
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject resolution if message is not in DISPATCH_UNKNOWN status', async () => {
      prisma.whatsAppMessage.findFirst.mockResolvedValue({
        id: 'msg-already-sent',
        businessId: 'biz-1',
        status: WhatsAppMessageStatus.SENT,
      });

      await expect(
        service.resolveAmbiguousMessage(
          'biz-1',
          'msg-already-sent',
          {
            action: 'MARK_FAILED',
            reason: 'Already sent',
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject resolution if message belongs to another business (cross-tenant protection)', async () => {
      prisma.whatsAppMessage.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveAmbiguousMessage(
          'biz-1',
          'msg-of-biz-2',
          {
            action: 'MARK_FAILED',
            reason: 'Cross-tenant attack test',
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
