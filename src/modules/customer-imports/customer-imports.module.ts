import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CustomerImportsController } from './customer-imports.controller';
import { CustomerImportsService } from './customer-imports.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'customer-imports',
    }),
  ],
  controllers: [CustomerImportsController],
  providers: [CustomerImportsService],
  exports: [CustomerImportsService],
})
export class CustomerImportsModule {}
