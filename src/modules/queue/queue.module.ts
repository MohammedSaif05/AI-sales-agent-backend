import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CustomerImportsModule } from '../customer-imports/customer-imports.module';
import { CustomerImportProcessor } from './customer-import.processor';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsAppProcessor } from './whatsapp.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') || 'localhost',
          port: config.get<number>('REDIS_PORT') || 6379,
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue(
      {
        name: 'customer-imports',
      },
      {
        name: 'business-analysis',
      },
      {
        name: 'whatsapp-communication',
      },
    ),
    forwardRef(() => CustomerImportsModule),
    forwardRef(() => WhatsAppModule),
  ],
  providers: [CustomerImportProcessor, WhatsAppProcessor],
  exports: [BullModule, CustomerImportProcessor, WhatsAppProcessor],
})
export class AppQueueModule {}
