import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CustomerImportsModule } from '../customer-imports/customer-imports.module';
import { CustomerImportProcessor } from './customer-import.processor';

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
    BullModule.registerQueue({
      name: 'customer-imports',
    }),
    forwardRef(() => CustomerImportsModule),
  ],
  providers: [CustomerImportProcessor],
  exports: [BullModule, CustomerImportProcessor],
})
export class AppQueueModule {}
