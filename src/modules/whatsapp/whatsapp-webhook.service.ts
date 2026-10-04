import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);
  private readonly verifyToken: string;
  private readonly appSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue('whatsapp-communication') private readonly queue: Queue,
  ) {
    this.verifyToken =
      this.configService.get<string>('META_WEBHOOK_VERIFY_TOKEN') ||
      'test_webhook_verify_token_secure';
    this.appSecret = this.configService.get<string>('META_APP_SECRET') || '';
  }

  /**
   * Handles GET /webhook challenge handshake from Meta.
   */
  verifyWebhookChallenge(
    mode?: string,
    token?: string,
    challenge?: string,
  ): string {
    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('Meta webhook verification handshake succeeded');
      return challenge || '';
    }

    this.logger.warn(
      `Meta webhook verification failed. Mode: ${mode}, token match: ${token === this.verifyToken}`,
    );
    throw new ForbiddenException(
      'Webhook verification failed: token mismatch or invalid mode',
    );
  }

  /**
   * Handles POST /webhook incoming event from Meta.
   * Staged with durable RECEIVED -> QUEUED lifecycle.
   */
  async handleIncomingWebhook(
    rawPayload: any,
    signatureHeader?: string,
  ): Promise<{ status: string; eventId?: string }> {
    // 1. Verify HMAC-SHA256 signature if secret and header are available
    if (this.appSecret && signatureHeader) {
      const isValid = this.verifySignature(rawPayload, signatureHeader);
      if (!isValid) {
        this.logger.error('Meta webhook signature verification failed');
        throw new UnauthorizedException('Invalid Meta webhook signature');
      }
    }

    // 2. Extract provider metadata & timestamp
    const extracted = this.extractEventMetadata(rawPayload);

    // 3. Compute deterministic idempotency key
    const payloadStr =
      typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
    const idempotencyKey = crypto
      .createHash('sha256')
      .update(payloadStr)
      .digest('hex');

    // 4. Check for duplicate webhook event
    const existing = await this.prisma.whatsAppWebhookEvent.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      this.logger.log(
        `Duplicate webhook event ignored (idempotencyKey: ${idempotencyKey})`,
      );
      return { status: 'DUPLICATE_IGNORED', eventId: existing.id };
    }

    // 5. Durable Staging: Create event in RECEIVED status
    const webhookEvent = await this.prisma.whatsAppWebhookEvent.create({
      data: {
        idempotencyKey,
        providerPhoneNumberId: extracted.providerPhoneNumberId,
        rawPayload: rawPayload,
        eventOriginTimestamp: extracted.eventOriginTimestamp,
        status: 'RECEIVED',
      },
    });

    // 6. BullMQ Enqueue: only transition RECEIVED -> QUEUED on successful enqueue
    try {
      await this.queue.add(
        'PROCESS_WEBHOOK',
        { eventId: webhookEvent.id },
        {
          jobId: `webhook-${idempotencyKey}`,
          removeOnComplete: true,
        },
      );

      await this.prisma.whatsAppWebhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'QUEUED' },
      });

      return { status: 'QUEUED', eventId: webhookEvent.id };
    } catch (queueErr: any) {
      // Event remains in RECEIVED status. The recovery watchdog will discover and retry it.
      this.logger.error(
        `Failed to enqueue webhook ${webhookEvent.id} into BullMQ: ${queueErr.message}. Event remains in RECEIVED state.`,
      );
      return { status: 'RECEIVED', eventId: webhookEvent.id };
    }
  }

  private verifySignature(payload: any, signatureHeader: string): boolean {
    try {
      const payloadStr =
        typeof payload === 'string' ? payload : JSON.stringify(payload);
      const expectedSignature = crypto
        .createHmac('sha256', this.appSecret)
        .update(payloadStr)
        .digest('hex');
      const providedSignature = signatureHeader.replace(/^sha256=/, '');

      if (expectedSignature.length !== providedSignature.length) {
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(providedSignature, 'utf8'),
      );
    } catch (err: any) {
      this.logger.error(`Signature verification error: ${err.message}`);
      return false;
    }
  }

  private extractEventMetadata(payload: any): {
    providerPhoneNumberId: string | null;
    eventOriginTimestamp: Date | null;
  } {
    try {
      const entry = payload?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      const providerPhoneNumberId = value?.metadata?.phone_number_id || null;

      // Extract provider timestamp from message or status object
      const rawTimestamp =
        value?.messages?.[0]?.timestamp ||
        value?.statuses?.[0]?.timestamp ||
        null;

      let eventOriginTimestamp: Date | null = null;
      if (rawTimestamp) {
        const parsedSeconds = parseInt(rawTimestamp, 10);
        if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
          eventOriginTimestamp = new Date(parsedSeconds * 1000);
        }
      }

      // INVARIANT: If rawTimestamp is missing or invalid, eventOriginTimestamp remains null.
      // Server arrival time is NEVER substituted for provider event timestamp.
      return {
        providerPhoneNumberId,
        eventOriginTimestamp,
      };
    } catch {
      return {
        providerPhoneNumberId: null,
        eventOriginTimestamp: null,
      };
    }
  }
}
