import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppMessageStatus } from '@prisma/client';

export interface WebhookJobData {
  eventId: string;
}

export interface ReconcileDisconnectJobData {
  connectionId: string;
  businessId: string;
  connectionVersion: number;
  attempt: number;
  disconnectRequestedAt: string;
}

const STATUS_RANK: Record<WhatsAppMessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
  DISPATCH_UNKNOWN: 0,
};

@Injectable()
@Processor('whatsapp-communication')
export class WhatsAppProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsAppProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsappService: WhatsAppService,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<void> {
    switch (job.name) {
      case 'PROCESS_WEBHOOK':
        await this.handleProcessWebhook(job.data as WebhookJobData);
        break;

      case 'RECONCILE_DISCONNECT':
        await this.handleReconcileDisconnect(
          job.data as ReconcileDisconnectJobData,
        );
        break;

      case 'CLEANUP_WEBHOOK_EVENTS':
        await this.handleCleanupWebhookEvents();
        break;

      default:
        this.logger.warn(`Unknown job name: ${job.name} (Job ID ${job.id})`);
    }
  }

  private async handleProcessWebhook(data: WebhookJobData): Promise<void> {
    const { eventId } = data;
    const event = await this.prisma.whatsAppWebhookEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      this.logger.warn(`Webhook event ${eventId} not found`);
      return;
    }

    if (event.status === 'PROCESSED') {
      return;
    }

    try {
      const payload: any = event.rawPayload;
      const entry = payload?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;

      if (!phoneNumberId) {
        await this.prisma.whatsAppWebhookEvent.update({
          where: { id: event.id },
          data: {
            status: 'IGNORED',
            errorMessage: 'Payload missing metadata.phone_number_id',
            processedAt: new Date(),
          },
        });
        return;
      }

      // Find connection associated with this phoneNumberId
      const connection = await this.prisma.whatsAppConnection.findFirst({
        where: { phoneNumberId },
      });

      if (!connection) {
        this.logger.warn(
          `No connection found for provider phoneNumberId: ${phoneNumberId}`,
        );
        await this.prisma.whatsAppWebhookEvent.update({
          where: { id: event.id },
          data: {
            status: 'IGNORED',
            errorMessage: `No active or historical connection found for phoneNumberId ${phoneNumberId}`,
            processedAt: new Date(),
          },
        });
        return;
      }

      // 1. Process Inbound Messages
      if (Array.isArray(value.messages)) {
        for (const msg of value.messages) {
          if (msg.type !== 'text') {
            // Out of scope for Phase 1 text MVP (media/interactive), ignore gracefully
            this.logger.log(
              `Ignoring non-text message type ${msg.type} on message ${msg.id}`,
            );
            continue;
          }

          const rawSender = msg.from;
          const norm = PhoneNormalizer.normalize(rawSender);
          const normalizedSender =
            norm.isValid && norm.normalized
              ? norm.normalized
              : `+${rawSender.replace(/\D/g, '')}`;

          // Find or create customer
          let customer = await this.prisma.customer.findFirst({
            where: {
              businessId: connection.businessId,
              normalizedPhone: normalizedSender,
              deletedAt: null,
            },
          });

          if (!customer) {
            customer = await this.prisma.customer.create({
              data: {
                businessId: connection.businessId,
                name: value.contacts?.[0]?.profile?.name || normalizedSender,
                rawPhone: rawSender,
                normalizedPhone: normalizedSender,
                source: 'WHATSAPP',
              },
            });
          }

          // Idempotent insertion check on canonical providerMessageId
          const existingMsg = await this.prisma.whatsAppMessage.findUnique({
            where: { providerMessageId: msg.id },
          });

          if (!existingMsg) {
            await this.prisma.whatsAppMessage.create({
              data: {
                businessId: connection.businessId,
                connectionId: connection.id,
                customerId: customer.id,
                providerPhoneNumberId: phoneNumberId,
                direction: 'INBOUND',
                type: 'TEXT',
                status: WhatsAppMessageStatus.DELIVERED,
                body: msg.text?.body || '',
                providerMessageId: msg.id, // Canonical provider wamid
                senderPhone: normalizedSender,
                recipientPhone: connection.displayPhoneNumber,
                eventOriginTimestamp: event.eventOriginTimestamp,
              },
            });
            this.logger.log(
              `Inbound WhatsApp message ${msg.id} persisted for business ${connection.businessId}`,
            );
          }
        }
      }

      // 2. Process Outbound Message Status Updates
      if (Array.isArray(value.statuses)) {
        for (const st of value.statuses) {
          const wamid = st.id;
          const rawStatus = st.status?.toLowerCase();

          // CRITICAL SECURITY REQUIREMENT:
          // Automatic provider webhook correlation MUST use canonical provider identity only.
          // manualResolutionProviderMessageId MUST NEVER be used for automatic correlation.
          const message = await this.prisma.whatsAppMessage.findFirst({
            where: {
              providerMessageId: wamid,
              providerPhoneNumberId: phoneNumberId,
            },
          });

          if (!message) {
            this.logger.warn(
              `Webhook status update received for uncorrelatable wamid ${wamid} on phone ${phoneNumberId}`,
            );
            continue;
          }

          // Map Meta status to enum
          let targetStatus: WhatsAppMessageStatus | null = null;
          if (rawStatus === 'sent') targetStatus = WhatsAppMessageStatus.SENT;
          else if (rawStatus === 'delivered')
            targetStatus = WhatsAppMessageStatus.DELIVERED;
          else if (rawStatus === 'read')
            targetStatus = WhatsAppMessageStatus.READ;
          else if (rawStatus === 'failed')
            targetStatus = WhatsAppMessageStatus.FAILED;

          if (!targetStatus) {
            this.logger.warn(`Unrecognized provider status: ${rawStatus}`);
            continue;
          }

          // Monotonic state progression check
          const currentRank = STATUS_RANK[message.status] || 0;
          const targetRank = STATUS_RANK[targetStatus] || 0;

          if (targetStatus === WhatsAppMessageStatus.FAILED) {
            const failureReason =
              st.errors?.[0]?.title ||
              st.errors?.[0]?.message ||
              'Meta provider delivery failure';
            await this.prisma.whatsAppMessage.update({
              where: { id: message.id },
              data: {
                status: WhatsAppMessageStatus.FAILED,
                failureSource: 'PROVIDER',
                failureReason,
              },
            });
            this.logger.log(
              `Message ${message.id} marked as FAILED via provider status webhook`,
            );
          } else if (targetRank > currentRank) {
            await this.prisma.whatsAppMessage.update({
              where: { id: message.id },
              data: {
                status: targetStatus,
              },
            });
            this.logger.log(
              `Message ${message.id} transitioned ${message.status} -> ${targetStatus}`,
            );
          }
        }
      }

      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      });
    } catch (err: any) {
      this.logger.error(
        `Error processing webhook event ${eventId}: ${err.message}`,
        err.stack,
      );
      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'FAILED',
          errorMessage: err.message,
          attempts: { increment: 1 },
        },
      });
      throw err;
    }
  }

  private async handleReconcileDisconnect(
    data: ReconcileDisconnectJobData,
  ): Promise<void> {
    const { connectionId, connectionVersion, attempt, disconnectRequestedAt } =
      data;
    await this.whatsappService.reconcileDisconnect(
      connectionId,
      connectionVersion,
      attempt,
      disconnectRequestedAt,
    );
  }

  private async handleCleanupWebhookEvents(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const deletedProcessed = await this.prisma.whatsAppWebhookEvent.deleteMany({
      where: {
        status: { in: ['PROCESSED', 'IGNORED'] },
        receivedAt: { lte: thirtyDaysAgo },
      },
    });

    const deletedFailed = await this.prisma.whatsAppWebhookEvent.deleteMany({
      where: {
        status: 'FAILED',
        receivedAt: { lte: ninetyDaysAgo },
      },
    });

    this.logger.log(
      `Cleanup job purged ${deletedProcessed.count} processed/ignored and ${deletedFailed.count} failed webhook events`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<any>, err: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) failed: ${err.message}`);
  }
}
