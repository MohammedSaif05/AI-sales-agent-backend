import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CredentialCrypto } from '../../common/utils/credential-crypto.util';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';
import { SendWhatsAppMessageDto } from './dto/send-whatsapp-message.dto';
import { ResolveAmbiguousMessageDto } from './dto/resolve-ambiguous-message.dto';
import { WhatsAppMessagesQueryDto } from './dto/whatsapp-query.dto';
import {
  MetaClientError,
  MetaWhatsAppCloudProvider,
} from './meta-whatsapp-cloud.provider';
import {
  WhatsAppConnectionStatus,
  WhatsAppMessage,
  WhatsAppMessageStatus,
} from '@prisma/client';

@Injectable()
export class WhatsAppMessagingService {
  private readonly logger = new Logger(WhatsAppMessagingService.name);
  private readonly SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaProvider: MetaWhatsAppCloudProvider,
  ) {}

  /**
   * Sends an outbound text message within 24-hour service window.
   */
  async sendMessage(
    businessId: string,
    dto: SendWhatsAppMessageDto,
    _userId?: string,
  ): Promise<WhatsAppMessage> {
    // 1. Phone number normalization
    const norm = PhoneNormalizer.normalize(dto.recipientPhone);
    if (!norm.isValid || !norm.normalized) {
      throw new BadRequestException(
        `Invalid recipient phone number: ${norm.error || 'Check country code and digits'}`,
      );
    }
    const recipientPhone = norm.normalized;

    // 2. Active WhatsApp connection verification
    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { businessId },
    });
    if (
      !connection ||
      connection.status !== WhatsAppConnectionStatus.CONNECTED
    ) {
      throw new BadRequestException(
        'Active WhatsApp connection required. Current status: ' +
          (connection?.status || 'NOT_CONNECTED'),
      );
    }

    // 3. Customer lookup and communication preferences check
    const customer = dto.customerId
      ? await this.prisma.customer.findFirst({
          where: { id: dto.customerId, businessId, deletedAt: null },
          include: { preferences: true },
        })
      : await this.prisma.customer.findFirst({
          where: {
            businessId,
            normalizedPhone: recipientPhone,
            deletedAt: null,
          },
          include: { preferences: true },
        });

    if (customer?.preferences?.doNotContact) {
      throw new BadRequestException(
        `Communication blocked: Customer ${customer.name || recipientPhone} has opted out of messages (doNotContact=true)`,
      );
    }

    // 4. Authoritative 24-Hour Customer Service Window check
    // Per Plan V2.8: must use provider eventOriginTimestamp, NOT server insertion time
    const lastInbound = await this.prisma.whatsAppMessage.findFirst({
      where: {
        businessId,
        senderPhone: recipientPhone,
        direction: 'INBOUND',
      },
      orderBy: { eventOriginTimestamp: 'desc' },
    });

    if (!lastInbound || !lastInbound.eventOriginTimestamp) {
      throw new BadRequestException(
        'Customer service window is closed: No inbound message with authoritative provider timestamp found for this recipient. Outbound template messaging required.',
      );
    }

    const elapsedMs = Date.now() - lastInbound.eventOriginTimestamp.getTime();
    if (elapsedMs > this.SERVICE_WINDOW_MS) {
      throw new BadRequestException(
        `Customer service window expired (${Math.round(elapsedMs / (1000 * 60 * 60))} hours elapsed since last inbound message). Outbound template messaging required.`,
      );
    }

    // 5. Pre-flight message insertion in PENDING state
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        businessId,
        connectionId: connection.id,
        customerId: customer?.id || null,
        providerPhoneNumberId: connection.phoneNumberId,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: WhatsAppMessageStatus.PENDING,
        body: dto.body,
        senderPhone: connection.displayPhoneNumber,
        recipientPhone,
      },
    });

    // 6. Decrypt token safely
    let token: string;
    try {
      token = CredentialCrypto.decrypt(connection.encryptedAccessToken);
    } catch (err: any) {
      this.logger.error(
        `Token decryption failed for connection ${connection.id}: ${err.message}`,
      );
      return await this.prisma.whatsAppMessage.update({
        where: { id: message.id },
        data: {
          status: WhatsAppMessageStatus.FAILED,
          failureSource: 'SYSTEM',
          failureReason: 'Internal token decryption failure',
        },
      });
    }

    // 7. Provider dispatch with crash/ambiguity handling
    try {
      const sendResult = await this.metaProvider.sendTextMessage(
        connection.phoneNumberId,
        token,
        recipientPhone,
        dto.body,
      );

      // Definitive provider acceptance + canonical wamid
      return await this.prisma.whatsAppMessage.update({
        where: { id: message.id },
        data: {
          status: WhatsAppMessageStatus.SENT,
          providerMessageId: sendResult.messageId, // Canonical wamid
          eventOriginTimestamp: new Date(),
        },
      });
    } catch (err: any) {
      if (err instanceof MetaClientError) {
        // Definitive provider rejection (4xx)
        this.logger.warn(
          `Meta rejected WhatsApp message ${message.id} (HTTP ${err.statusCode}, error ${err.errorCode}): ${err.message}`,
        );

        const updated = await this.prisma.whatsAppMessage.update({
          where: { id: message.id },
          data: {
            status: WhatsAppMessageStatus.FAILED,
            failureSource: 'PROVIDER',
            failureReason: `Meta HTTP ${err.statusCode}: ${err.message}`,
          },
        });

        // If authentication/token revoked by Meta
        if (err.statusCode === 401 || err.errorCode === 190) {
          await this.prisma.whatsAppConnection.update({
            where: { id: connection.id },
            data: { status: WhatsAppConnectionStatus.FAILED },
          });
        }

        return updated;
      }

      // Ambiguous outcome (5xx, network timeout, transport reset, parsing crash)
      // MANDATORY RULE: PENDING -> DISPATCH_UNKNOWN. NO AUTOMATIC RESEND.
      this.logger.error(
        `Ambiguous outcome for message ${message.id}: ${err.message}. Transitioning to DISPATCH_UNKNOWN.`,
      );

      return await this.prisma.whatsAppMessage.update({
        where: { id: message.id },
        data: {
          status: WhatsAppMessageStatus.DISPATCH_UNKNOWN,
          failureSource: 'SYSTEM',
          failureReason: `Ambiguous dispatch outcome: ${err.message}`,
        },
      });
    }
  }

  /**
   * Manually resolves an ambiguous message in DISPATCH_UNKNOWN state.
   * Enforces Provider Identity Trust Boundary:
   * Operator-asserted wamid is stored in manualResolutionProviderMessageId, NEVER in providerMessageId.
   */
  async resolveAmbiguousMessage(
    businessId: string,
    messageId: string,
    dto: ResolveAmbiguousMessageDto,
    userId: string,
  ): Promise<WhatsAppMessage> {
    const message = await this.prisma.whatsAppMessage.findFirst({
      where: { id: messageId, businessId },
    });

    if (!message) {
      throw new NotFoundException('Message not found for this business');
    }

    if (message.status !== WhatsAppMessageStatus.DISPATCH_UNKNOWN) {
      throw new BadRequestException(
        `Only messages in DISPATCH_UNKNOWN status can be manually resolved. Current status is ${message.status}`,
      );
    }

    if (dto.action === 'MARK_FAILED') {
      return await this.prisma.whatsAppMessage.update({
        where: { id: message.id },
        data: {
          status: WhatsAppMessageStatus.FAILED,
          failureSource: 'MANUAL_RESOLUTION',
          resolutionReason: dto.reason,
          resolvedByUserId: userId,
          resolvedAt: new Date(),
        },
      });
    }

    // action === 'MARK_SENT'
    if (!dto.providerMessageId) {
      throw new BadRequestException(
        'providerMessageId is required when marking an ambiguous message as SENT',
      );
    }

    // Verify providerPhoneNumberId consistency if supplied
    if (
      dto.providerPhoneNumberId &&
      dto.providerPhoneNumberId !== message.providerPhoneNumberId
    ) {
      throw new BadRequestException(
        `providerPhoneNumberId ${dto.providerPhoneNumberId} does not match message sender phone identity ${message.providerPhoneNumberId}`,
      );
    }

    // Check canonical uniqueness: operator wamid cannot collide with existing canonical wamid
    const existingCanonical = await this.prisma.whatsAppMessage.findUnique({
      where: { providerMessageId: dto.providerMessageId },
    });
    if (existingCanonical && existingCanonical.id !== message.id) {
      throw new ConflictException(
        `The supplied wamid is already registered as canonical provider identity on message ${existingCanonical.id}`,
      );
    }

    // CRITICAL SECURITY INVARIANT:
    // Operator-asserted wamid MUST NOT become canonical providerMessageId.
    // Must be placed in manualResolutionProviderMessageId.
    // providerMessageId MUST remain null.
    // resolutionSource MUST be MANUAL_OPERATOR_ASSERTION.
    return await this.prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status: WhatsAppMessageStatus.SENT,
        providerMessageId: null, // Strictly null!
        manualResolutionProviderMessageId: dto.providerMessageId,
        resolutionSource: 'MANUAL_OPERATOR_ASSERTION',
        resolutionReason: dto.reason,
        resolvedByUserId: userId,
        resolvedAt: new Date(),
      },
    });
  }

  /**
   * Retrieves messages for a business with pagination and filters.
   */
  async getMessages(businessId: string, query: WhatsAppMessagesQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { businessId };
    if (query.status) {
      where.status = query.status;
    }
    if (query.direction) {
      where.direction = query.direction;
    }
    if (query.customerId) {
      where.customerId = query.customerId;
    }
    if (query.searchPhone) {
      where.OR = [
        { senderPhone: { contains: query.searchPhone } },
        { recipientPhone: { contains: query.searchPhone } },
      ];
    }

    const [total, messages] = await Promise.all([
      this.prisma.whatsAppMessage.count({ where }),
      this.prisma.whatsAppMessage.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      data: messages,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves a single message by ID.
   */
  async getMessageById(
    businessId: string,
    messageId: string,
  ): Promise<WhatsAppMessage> {
    const message = await this.prisma.whatsAppMessage.findFirst({
      where: { id: messageId, businessId },
      include: { customer: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found for this business');
    }

    return message;
  }
}
