import { forwardRef, Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaModule } from '../../database/prisma.module';
import { AppQueueModule } from '../queue/queue.module';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppMessagingService } from './whatsapp-messaging.service';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { MetaWhatsAppCloudProvider } from './meta-whatsapp-cloud.provider';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { AdminWhatsAppController } from './admin-whatsapp.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    BullModule.registerQueue({
      name: 'whatsapp-communication',
    }),
    forwardRef(() => AppQueueModule),
  ],
  controllers: [
    WhatsAppController,
    WhatsAppWebhookController,
    AdminWhatsAppController,
  ],
  providers: [
    WhatsAppService,
    WhatsAppMessagingService,
    WhatsAppWebhookService,
    MetaWhatsAppCloudProvider,
  ],
  exports: [
    WhatsAppService,
    WhatsAppMessagingService,
    WhatsAppWebhookService,
    MetaWhatsAppCloudProvider,
  ],
})
export class WhatsAppModule implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppModule.name);

  constructor(
    @InjectQueue('whatsapp-communication') private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    try {
      // Modern BullMQ 6.x Job Scheduler API for daily event pruning
      await this.queue.upsertJobScheduler(
        'whatsapp-cleanup-scheduler',
        { pattern: '0 3 * * *' }, // Daily at 03:00 UTC
        {
          name: 'CLEANUP_WEBHOOK_EVENTS',
          data: {},
          opts: { removeOnComplete: true, removeOnFail: 50 },
        },
      );
      this.logger.log('WhatsApp daily event cleanup scheduler registered');
    } catch (err: any) {
      this.logger.warn(
        `Could not register WhatsApp cleanup job scheduler: ${err.message}`,
      );
    }
  }
}
