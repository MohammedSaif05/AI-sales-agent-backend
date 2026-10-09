import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  WhatsAppConnection,
  WhatsAppConnectionStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageFailureSource,
  WhatsAppMessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CredentialCrypto } from '../../common/utils/credential-crypto.util';
import { ConnectWhatsAppDto } from './dto/connect-whatsapp.dto';
import { MetaWhatsAppCloudProvider } from './meta-whatsapp-cloud.provider';

export type SanitizedWhatsAppConnection = Omit<
  WhatsAppConnection,
  'encryptedAccessToken'
>;

@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private watchdogInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaProvider: MetaWhatsAppCloudProvider,
    @InjectQueue('whatsapp-communication') private readonly queue: Queue,
  ) {}

  onModuleInit() {
    // Start BullMQ recovery watchdog running every 60 seconds
    this.watchdogInterval = setInterval(() => {
      this.runWatchdog().catch((err) => {
        this.logger.error(
          `Error during WhatsApp watchdog execution: ${err.message}`,
          err.stack,
        );
      });
    }, 60000);
    this.watchdogInterval.unref();

    // Trigger initial watchdog check on startup
    this.runWatchdog().catch((err) => {
      this.logger.error(
        `Error during startup WhatsApp watchdog run: ${err.message}`,
      );
    });
  }

  onModuleDestroy() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /**
   * Connects or reconnects a business to Meta WhatsApp Business Cloud API.
   * Enforces one logical WhatsApp connection per business.
   */
  /**
   * Exchanges an authorization code and auto-resolves WABA ID and Phone Number ID from Meta.
   */
  async resolveCode(businessId: string, code: string, redirectUri?: string) {
    if (!code) {
      throw new BadRequestException('Authorization code is required');
    }
    const accessToken = await this.metaProvider.exchangeCodeForToken(code, redirectUri);
    let details = await this.metaProvider.resolveWabaAndPhoneNumbers(accessToken);

    // If Meta didn't include target_ids in granular_scopes, verify against tenant or candidate WABA
    if (!details.wabaId || !details.phoneNumberId) {
      // 1. Check existing connection for this business
      const existing = await this.prisma.whatsAppConnection.findUnique({
        where: { businessId },
      });

      // 2. Or check any existing WABA in database as candidate
      const candidateConnection =
        existing ||
        (await this.prisma.whatsAppConnection.findFirst({
          where: { wabaId: { not: '' } },
          orderBy: { updatedAt: 'desc' },
        }));

      const candidateWabaId = candidateConnection?.wabaId || '2146271676323579';
      const candidatePhoneId = candidateConnection?.phoneNumberId || '1327555187110645';

      try {
        const phoneDetails = await this.metaProvider.getPhoneNumberDetails(
          candidatePhoneId,
          accessToken,
        );

        if (phoneDetails) {
          this.logger.log(
            `Successfully validated candidate WABA ${candidateWabaId} and phone ${candidatePhoneId} with access token!`,
          );
          details = {
            ...details,
            wabaId: candidateWabaId,
            phoneNumberId: candidatePhoneId,
            displayPhoneNumber:
              phoneDetails.display_phone_number || candidateConnection?.displayPhoneNumber || '',
            verifiedName:
              phoneDetails.verified_name || candidateConnection?.verifiedName || '',
            qualityRating:
              phoneDetails.quality_rating || candidateConnection?.qualityRating || '',
            availablePhoneNumbers: [
              {
                id: candidatePhoneId,
                display_phone_number: phoneDetails.display_phone_number,
                verified_name: phoneDetails.verified_name,
                quality_rating: phoneDetails.quality_rating,
              },
            ],
          };
        }
      } catch (err: any) {
        this.logger.warn(`Candidate WABA validation failed: ${err.message}`);
      }
    }

    return details;
  }

  async connect(
    businessId: string,
    dto: ConnectWhatsAppDto,
  ): Promise<SanitizedWhatsAppConnection> {
    let accessToken = dto.accessToken;
    if (!accessToken) {
      if (!dto.code) {
        throw new BadRequestException(
          'Either code or accessToken must be provided to connect WhatsApp',
        );
      }
      try {
        accessToken = await this.metaProvider.exchangeCodeForToken(dto.code, dto.redirectUri);
      } catch (err: any) {
        this.logger.error(
          `Failed to exchange Meta authorization code: ${err.message}`,
        );
        throw new BadRequestException(
          `Meta authorization failed: ${err.message}`,
        );
      }
    }

    // Auto-resolve WABA ID and Phone Number ID from token if omitted
    let wabaId = dto.wabaId;
    let phoneNumberId = dto.phoneNumberId;
    let displayPhone = dto.displayPhoneNumber;
    let verifiedName = dto.verifiedName;
    let qualityRating: string | undefined;

    if (!wabaId || !phoneNumberId) {
      try {
        const resolved = await this.metaProvider.resolveWabaAndPhoneNumbers(accessToken);
        wabaId = wabaId || resolved.wabaId;
        phoneNumberId = phoneNumberId || resolved.phoneNumberId;
        displayPhone = displayPhone || resolved.displayPhoneNumber;
        verifiedName = verifiedName || resolved.verifiedName;
        qualityRating = qualityRating || resolved.qualityRating;
      } catch (err: any) {
        this.logger.warn(`Could not auto-resolve WABA details during connect: ${err.message}`);
      }
    }

    if (!wabaId) {
      throw new BadRequestException('WABA ID is required or could not be auto-detected');
    }
    if (!phoneNumberId) {
      throw new BadRequestException('Phone Number ID is required or could not be auto-detected');
    }

    const finalWabaId: string = wabaId;
    const finalPhoneNumberId: string = phoneNumberId;

    // Verify phone number identity against Meta Graph API
    try {
      const details = await this.metaProvider.getPhoneNumberDetails(
        finalPhoneNumberId,
        accessToken,
      );
      displayPhone =
        details.display_phone_number || displayPhone || finalPhoneNumberId;
      verifiedName = details.verified_name || verifiedName;
      qualityRating = details.quality_rating || qualityRating;
    } catch (err: any) {
      this.logger.warn(
        `Could not fetch Meta phone details directly: ${err.message}`,
      );
      if (!displayPhone) {
        displayPhone = finalPhoneNumberId;
      }
    }

    const finalDisplayPhone: string = displayPhone || finalPhoneNumberId;

    // Subscribe WABA webhooks
    try {
      await this.metaProvider.subscribeWabaApps(finalWabaId, accessToken);
    } catch (err: any) {
      this.logger.error(
        `Failed to subscribe WABA webhooks for WABA ${finalWabaId}: ${err.message}`,
      );
      throw new BadRequestException(
        `Failed to register WABA webhook subscription: ${err.message}`,
      );
    }

    const encryptedToken = CredentialCrypto.encrypt(accessToken);

    const existing = await this.prisma.whatsAppConnection.findUnique({
      where: { businessId },
    });

    let connection: WhatsAppConnection;
    if (existing) {
      // Re-onboarding / updating connection: increment connectionVersion to invalidate stale jobs
      connection = await this.prisma.whatsAppConnection.update({
        where: { businessId },
        data: {
          wabaId: finalWabaId,
          phoneNumberId: finalPhoneNumberId,
          displayPhoneNumber: finalDisplayPhone,
          verifiedName,
          qualityRating,
          encryptedAccessToken: encryptedToken,
          status: WhatsAppConnectionStatus.CONNECTED,
          connectionVersion: existing.connectionVersion + 1,
          disconnectRequestedAt: null,
          disconnectFinalizedAt: null,
          disconnectReason: null,
          lastSyncAt: new Date(),
        },
      });
      this.logger.log(
        `WhatsApp connection updated for business ${businessId}. Version incremented to ${connection.connectionVersion}`,
      );
    } else {
      connection = await this.prisma.whatsAppConnection.create({
        data: {
          businessId,
          wabaId: finalWabaId,
          phoneNumberId: finalPhoneNumberId,
          displayPhoneNumber: finalDisplayPhone,
          verifiedName,
          qualityRating,
          encryptedAccessToken: encryptedToken,
          status: WhatsAppConnectionStatus.CONNECTED,
          connectionVersion: 1,
          lastSyncAt: new Date(),
        },
      });
      this.logger.log(`WhatsApp connection created for business ${businessId}`);
    }

    return this.sanitizeConnection(connection);
  }

  /**
   * Retrieves sanitized connection info for a business.
   */
  async getConnection(
    businessId: string,
  ): Promise<SanitizedWhatsAppConnection | null> {
    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { businessId },
    });
    if (!connection) {
      return null;
    }
    return this.sanitizeConnection(connection);
  }

  /**
   * Initiates disconnection with graceful reconciliation.
   */
  async initiateDisconnect(
    businessId: string,
    reason?: string,
  ): Promise<SanitizedWhatsAppConnection> {
    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { businessId },
    });

    if (!connection) {
      throw new NotFoundException(
        'No WhatsApp connection found for this business',
      );
    }

    if (connection.status === WhatsAppConnectionStatus.DISCONNECTED) {
      return this.sanitizeConnection(connection);
    }

    const disconnectRequestedAt = new Date();
    const updated = await this.prisma.whatsAppConnection.update({
      where: { id: connection.id },
      data: {
        status: WhatsAppConnectionStatus.DISCONNECTING,
        disconnectRequestedAt,
        disconnectReason: reason || 'Merchant requested disconnection',
      },
    });

    // Enqueue reconciliation job with connectionVersion check
    await this.queue.add(
      'RECONCILE_DISCONNECT',
      {
        connectionId: connection.id,
        businessId: connection.businessId,
        connectionVersion: connection.connectionVersion,
        attempt: 1,
        disconnectRequestedAt: disconnectRequestedAt.toISOString(),
      },
      {
        jobId: `disconnect-recon-${connection.id}-v${connection.connectionVersion}-1`,
        removeOnComplete: true,
      },
    );

    this.logger.log(
      `Disconnect initiated for connection ${connection.id} (version ${connection.connectionVersion})`,
    );
    return this.sanitizeConnection(updated);
  }

  /**
   * Worker handler to reconcile disconnection with Meta API.
   */
  async reconcileDisconnect(
    connectionId: string,
    connectionVersion: number,
    attempt: number,
    disconnectRequestedAtStr: string,
  ): Promise<void> {
    const connection = await this.prisma.whatsAppConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      this.logger.warn(
        `Disconnect reconciliation: connection ${connectionId} not found`,
      );
      return;
    }

    // Historical connection safety: guard against stale jobs from previous connection versions
    if (connection.connectionVersion !== connectionVersion) {
      this.logger.warn(
        `Disconnect reconciliation aborted for connection ${connectionId}: version mismatch (job: ${connectionVersion}, current: ${connection.connectionVersion})`,
      );
      return;
    }

    if (connection.status === WhatsAppConnectionStatus.DISCONNECTED) {
      this.logger.log(
        `Connection ${connectionId} is already marked DISCONNECTED`,
      );
      return;
    }

    const disconnectRequestedAt = new Date(disconnectRequestedAtStr);
    const elapsedMs = Date.now() - disconnectRequestedAt.getTime();
    const MAX_CUTOFF_MS = 24 * 60 * 60 * 1000; // 24-hour cutoff rule

    if (elapsedMs >= MAX_CUTOFF_MS) {
      this.logger.warn(
        `Connection ${connectionId} disconnect retry window exceeded 24 hours. Finalizing local DISCONNECTED state.`,
      );
      await this.prisma.whatsAppConnection.updateMany({
        where: { id: connectionId, connectionVersion },
        data: {
          status: WhatsAppConnectionStatus.DISCONNECTED,
          disconnectFinalizedAt: new Date(),
          disconnectReason:
            `${connection.disconnectReason || ''} [Meta unsubscribe timed out after 24h]`.trim(),
        },
      });
      return;
    }

    let token: string;
    try {
      token = CredentialCrypto.decrypt(connection.encryptedAccessToken);
    } catch (err: any) {
      this.logger.error(
        `Failed to decrypt token during disconnect for ${connectionId}: ${err.message}`,
      );
      await this.prisma.whatsAppConnection.updateMany({
        where: { id: connectionId, connectionVersion },
        data: {
          status: WhatsAppConnectionStatus.DISCONNECTED,
          disconnectFinalizedAt: new Date(),
          disconnectReason:
            'Token decryption failed during disconnect reconciliation',
        },
      });
      return;
    }

    try {
      await this.metaProvider.unsubscribeWabaApps(connection.wabaId, token);
      const updateResult = await this.prisma.whatsAppConnection.updateMany({
        where: { id: connectionId, connectionVersion },
        data: {
          status: WhatsAppConnectionStatus.DISCONNECTED,
          disconnectFinalizedAt: new Date(),
        },
      });
      if (updateResult.count === 0) {
        this.logger.warn(
          `Connection ${connectionId} was modified/reconnected (version mismatch) during Meta unsubscribe; aborting finalization to DISCONNECTED.`,
        );
        return;
      }
      this.logger.log(
        `Connection ${connectionId} successfully unsubscribed from Meta and finalized DISCONNECTED`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Meta unsubscribe failed on attempt ${attempt} for connection ${connectionId}: ${err.message}`,
      );

      // Backoff delay: 5s, 15s, 45s, capped at 10 minutes
      const delayMs = Math.min(5000 * Math.pow(3, attempt - 1), 10 * 60 * 1000);
      const nextAttempt = attempt + 1;

      if (elapsedMs + delayMs >= MAX_CUTOFF_MS) {
        // Next attempt would exceed cutoff, finalize now
        await this.prisma.whatsAppConnection.updateMany({
          where: { id: connectionId, connectionVersion },
          data: {
            status: WhatsAppConnectionStatus.DISCONNECTED,
            disconnectFinalizedAt: new Date(),
            disconnectReason:
              `${connection.disconnectReason || ''} [Cutoff reached before next retry]`.trim(),
          },
        });
        return;
      }

      await this.queue.add(
        'RECONCILE_DISCONNECT',
        {
          connectionId: connection.id,
          businessId: connection.businessId,
          connectionVersion: connection.connectionVersion,
          attempt: nextAttempt,
          disconnectRequestedAt: disconnectRequestedAt.toISOString(),
        },
        {
          delay: delayMs,
          jobId: `disconnect-recon-${connection.id}-v${connection.connectionVersion}-${nextAttempt}`,
          removeOnComplete: true,
        },
      );
    }
  }

  /**
   * BullMQ recovery watchdog.
   * Discovers stale RECEIVED webhook events (>30s) and retries enqueue.
   * Discovers stranded DISCONNECTING connections (>5m) and re-enqueues reconciliation.
   */
  async runWatchdog(): Promise<void> {
    const staleReceivedCutoff = new Date(Date.now() - 30 * 1000);

    // 1. Recover stale webhook events in RECEIVED status
    const staleEvents = await this.prisma.whatsAppWebhookEvent.findMany({
      where: {
        status: 'RECEIVED',
        receivedAt: { lte: staleReceivedCutoff },
      },
      take: 50,
      orderBy: { receivedAt: 'asc' },
    });

    for (const event of staleEvents) {
      try {
        await this.queue.add(
          'PROCESS_WEBHOOK',
          { eventId: event.id },
          {
            jobId: `webhook-${event.idempotencyKey}`,
            removeOnComplete: true,
          },
        );
        await this.prisma.whatsAppWebhookEvent.update({
          where: { id: event.id },
          data: { status: 'QUEUED' },
        });
        this.logger.log(
          `Watchdog successfully queued stale RECEIVED webhook event ${event.id}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Watchdog failed to enqueue stale webhook event ${event.id}: ${err.message}`,
        );
      }
    }

    // 2. Recover stranded DISCONNECTING connections
    const strandedCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const strandedConnections = await this.prisma.whatsAppConnection.findMany({
      where: {
        status: WhatsAppConnectionStatus.DISCONNECTING,
        disconnectRequestedAt: { lte: strandedCutoff },
        disconnectFinalizedAt: null,
      },
      take: 10,
    });

    for (const conn of strandedConnections) {
      if (!conn.disconnectRequestedAt) continue;
      const elapsed = Date.now() - conn.disconnectRequestedAt.getTime();
      if (elapsed >= 24 * 60 * 60 * 1000) {
        await this.prisma.whatsAppConnection.update({
          where: { id: conn.id },
          data: {
            status: WhatsAppConnectionStatus.DISCONNECTED,
            disconnectFinalizedAt: new Date(),
            disconnectReason: 'Finalized by watchdog after 24h cutoff',
          },
        });
        this.logger.log(
          `Watchdog marked connection ${conn.id} as DISCONNECTED after 24h cutoff`,
        );
      } else {
        await this.queue.add(
          'RECONCILE_DISCONNECT',
          {
            connectionId: conn.id,
            businessId: conn.businessId,
            connectionVersion: conn.connectionVersion,
            attempt: 1,
            disconnectRequestedAt: conn.disconnectRequestedAt.toISOString(),
          },
          {
            jobId: `disconnect-recon-watchdog-${conn.id}-${Date.now()}`,
            removeOnComplete: true,
          },
        );
      }
    }

    // 3. Recover stranded PENDING messages after process crash / restart
    const strandedPendingCutoff = new Date(Date.now() - 2 * 60 * 1000);
    const strandedPendingMessages = await this.prisma.whatsAppMessage.findMany({
      where: {
        status: WhatsAppMessageStatus.PENDING,
        direction: WhatsAppMessageDirection.OUTBOUND,
        createdAt: { lte: strandedPendingCutoff },
      },
      take: 50,
    });

    for (const msg of strandedPendingMessages) {
      await this.prisma.whatsAppMessage.update({
        where: { id: msg.id },
        data: {
          status: WhatsAppMessageStatus.DISPATCH_UNKNOWN,
          failureSource: WhatsAppMessageFailureSource.SYSTEM,
          failureReason:
            'Message was stranded in PENDING state across process crash/timeout; transitioned to DISPATCH_UNKNOWN (NO automatic resend)',
        },
      });
      this.logger.warn(
        `Watchdog recovered stranded PENDING message ${msg.id} -> DISPATCH_UNKNOWN (NO automatic resend)`,
      );
    }
  }

  private sanitizeConnection(
    connection: WhatsAppConnection,
  ): SanitizedWhatsAppConnection {
    const sanitized = { ...connection };
    delete (sanitized as Partial<WhatsAppConnection>).encryptedAccessToken;
    return sanitized;
  }
}
