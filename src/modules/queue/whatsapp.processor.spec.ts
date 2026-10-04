import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppProcessor } from './whatsapp.processor';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppMessageStatus } from '@prisma/client';

describe('WhatsAppProcessor', () => {
  let processor: WhatsAppProcessor;
  let prisma: any;
  let whatsappService: any;

  beforeEach(async () => {
    prisma = {
      whatsAppWebhookEvent: {
        findUnique: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      whatsAppConnection: {
        findFirst: jest.fn(),
      },
      customer: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      whatsAppMessage: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    whatsappService = {
      reconcileDisconnect: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: WhatsAppService, useValue: whatsappService },
      ],
    }).compile();

    processor = module.get<WhatsAppProcessor>(WhatsAppProcessor);
  });

  describe('handleProcessWebhook - Inbound Messages', () => {
    it('should process inbound text message, link customer, and persist message with canonical wamid', async () => {
      const wamid =
        'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzQTFERUZDQzEzNDg2NUM4AA==';
      const event = {
        id: 'event-inbound-1',
        status: 'RECEIVED',
        eventOriginTimestamp: new Date('2026-10-04T10:00:00Z'),
        rawPayload: {
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: {
                      phone_number_id: '100345678901234',
                      display_phone_number: '+1 555-0100',
                    },
                    contacts: [{ profile: { name: 'John Doe' } }],
                    messages: [
                      {
                        from: '919876543210',
                        id: wamid,
                        timestamp: '1728036000',
                        type: 'text',
                        text: { body: 'Hello merchant!' },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };

      prisma.whatsAppWebhookEvent.findUnique.mockResolvedValue(event);
      prisma.whatsAppConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        businessId: 'biz-1',
        phoneNumberId: '100345678901234',
        displayPhoneNumber: '+1 555-0100',
      });
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust-1',
        businessId: 'biz-1',
      });
      prisma.whatsAppMessage.findUnique.mockResolvedValue(null); // Not duplicate

      await processor.process({
        name: 'PROCESS_WEBHOOK',
        data: { eventId: 'event-inbound-1' },
      } as any);

      expect(prisma.whatsAppMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          businessId: 'biz-1',
          connectionId: 'conn-1',
          customerId: 'cust-1',
          providerPhoneNumberId: '100345678901234',
          direction: 'INBOUND',
          status: WhatsAppMessageStatus.DELIVERED,
          body: 'Hello merchant!',
          providerMessageId: wamid,
        }),
      });

      expect(prisma.whatsAppWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-inbound-1' },
        data: expect.objectContaining({ status: 'PROCESSED' }),
      });
    });
  });

  describe('handleProcessWebhook - Outbound Status Webhook & Correlation Security', () => {
    it('should correlate status webhook using canonical providerMessageId and advance status monotonically', async () => {
      const canonicalWamid = 'wamid.HBgLCANONICAL_WAMID_12345';
      const event = {
        id: 'event-status-1',
        status: 'RECEIVED',
        rawPayload: {
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: '100345678901234' },
                    statuses: [
                      {
                        id: canonicalWamid,
                        status: 'delivered',
                        timestamp: '1728036010',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };

      prisma.whatsAppWebhookEvent.findUnique.mockResolvedValue(event);
      prisma.whatsAppConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        phoneNumberId: '100345678901234',
      });

      // Existing message in SENT status
      prisma.whatsAppMessage.findFirst.mockResolvedValue({
        id: 'msg-out-1',
        status: WhatsAppMessageStatus.SENT,
        providerMessageId: canonicalWamid,
      });

      await processor.process({
        name: 'PROCESS_WEBHOOK',
        data: { eventId: 'event-status-1' },
      } as any);

      // Correlation strictly checks canonical providerMessageId and providerPhoneNumberId
      expect(prisma.whatsAppMessage.findFirst).toHaveBeenCalledWith({
        where: {
          providerMessageId: canonicalWamid,
          providerPhoneNumberId: '100345678901234',
        },
      });

      expect(prisma.whatsAppMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-out-1' },
        data: { status: WhatsAppMessageStatus.DELIVERED },
      });
    });

    it('MANDATORY SECURITY INVARIANT: manualResolutionProviderMessageId MUST NEVER correlate with status webhooks', async () => {
      const operatorAssertedWamid = 'wamid.HBgLOPERATOR_ASSERTED_WAMID_99999';
      const event = {
        id: 'event-status-manual',
        status: 'RECEIVED',
        rawPayload: {
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: '100345678901234' },
                    statuses: [
                      {
                        id: operatorAssertedWamid,
                        status: 'delivered',
                        timestamp: '1728036010',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };

      prisma.whatsAppWebhookEvent.findUnique.mockResolvedValue(event);
      prisma.whatsAppConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        phoneNumberId: '100345678901234',
      });

      // Query looking for canonical providerMessageId finds NOTHING,
      // because manual wamid is only stored in manualResolutionProviderMessageId!
      prisma.whatsAppMessage.findFirst.mockResolvedValue(null);

      await processor.process({
        name: 'PROCESS_WEBHOOK',
        data: { eventId: 'event-status-manual' },
      } as any);

      // Verify the lookup only queried providerMessageId
      expect(prisma.whatsAppMessage.findFirst).toHaveBeenCalledWith({
        where: {
          providerMessageId: operatorAssertedWamid,
          providerPhoneNumberId: '100345678901234',
        },
      });

      // No message update was performed!
      expect(prisma.whatsAppMessage.update).not.toHaveBeenCalled();
    });

    it('should NOT downgrade monotonic status (e.g. READ cannot be demoted to DELIVERED)', async () => {
      const canonicalWamid = 'wamid.HBgLCANONICAL_READ_WAMID';
      const event = {
        id: 'event-status-delayed',
        status: 'RECEIVED',
        rawPayload: {
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: '100345678901234' },
                    statuses: [
                      {
                        id: canonicalWamid,
                        status: 'delivered', // Delayed out-of-order 'delivered' event
                        timestamp: '1728036015',
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      };

      prisma.whatsAppWebhookEvent.findUnique.mockResolvedValue(event);
      prisma.whatsAppConnection.findFirst.mockResolvedValue({
        id: 'conn-1',
        phoneNumberId: '100345678901234',
      });

      // Message is already in READ status!
      prisma.whatsAppMessage.findFirst.mockResolvedValue({
        id: 'msg-already-read',
        status: WhatsAppMessageStatus.READ,
        providerMessageId: canonicalWamid,
      });

      await processor.process({
        name: 'PROCESS_WEBHOOK',
        data: { eventId: 'event-status-delayed' },
      } as any);

      // Message status must NOT be updated (READ rank 3 > DELIVERED rank 2)
      expect(prisma.whatsAppMessage.update).not.toHaveBeenCalled();
    });

    it('should mark event IGNORED if providerPhoneNumberId does not match any connection', async () => {
      const event = {
        id: 'event-unknown-phone',
        status: 'RECEIVED',
        rawPayload: {
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { phone_number_id: 'unknown-phone-id' },
                  },
                },
              ],
            },
          ],
        },
      };

      prisma.whatsAppWebhookEvent.findUnique.mockResolvedValue(event);
      prisma.whatsAppConnection.findFirst.mockResolvedValue(null);

      await processor.process({
        name: 'PROCESS_WEBHOOK',
        data: { eventId: 'event-unknown-phone' },
      } as any);

      expect(prisma.whatsAppWebhookEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-unknown-phone' },
        data: expect.objectContaining({ status: 'IGNORED' }),
      });
    });
  });
});
