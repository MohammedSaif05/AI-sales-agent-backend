import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../database/prisma.module';
import { AiModule } from '../ai/ai.module';
import { BusinessAnalystController } from './business-analyst.controller';
import { BusinessAnalystProcessor } from './business-analyst.processor';
import { BusinessAnalystService } from './business-analyst.service';
import { CampaignAnalyticsCollector } from './collectors/campaign-analytics.collector';
import { CustomerAnalyticsCollector } from './collectors/customer-analytics.collector';
import { SalesAnalyticsCollector } from './collectors/sales-analytics.collector';
import { ProductAnalyticsCollector } from './collectors/product-analytics.collector';
import { AnalyticsCacheService } from '../../common/services/analytics-cache.service';
import { AiResponseValidatorService } from './services/ai-response-validator.service';
import { AnalyticsDataService } from './services/analytics-data.service';

@Module({
  imports: [
    PrismaModule,
    AiModule,
    ConfigModule,
    BullModule.registerQueue({
      name: 'business-analysis',
    }),
  ],
  controllers: [BusinessAnalystController],
  providers: [
    BusinessAnalystService,
    AnalyticsDataService,
    AiResponseValidatorService,
    CustomerAnalyticsCollector,
    SalesAnalyticsCollector,
    ProductAnalyticsCollector,
    CampaignAnalyticsCollector,
    BusinessAnalystProcessor,
    AnalyticsCacheService,
  ],
  exports: [
    BusinessAnalystService,
    AnalyticsDataService,
    AnalyticsCacheService,
  ],
})
export class BusinessAnalystModule {}
