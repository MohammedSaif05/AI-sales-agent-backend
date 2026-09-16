import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AnalysisStatus, AnalysisType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AIService } from '../ai/ai.service';
import { AnalyticsDataService } from './services/analytics-data.service';
import { AiResponseValidatorService } from './services/ai-response-validator.service';

@Processor('business-analysis')
export class BusinessAnalystProcessor extends WorkerHost {
  private readonly logger = new Logger(BusinessAnalystProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AIService,
    private readonly analyticsDataService: AnalyticsDataService,
    private readonly validatorService: AiResponseValidatorService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { analysisId, businessId, analysisType, periodFrom, periodTo } =
      job.data;
    this.logger.log(
      `BullMQ worker processing analysisId=${analysisId}, type=${analysisType}`,
    );

    // Transition to PROCESSING
    await this.prisma.businessAnalysis.update({
      where: { id: analysisId },
      data: { status: AnalysisStatus.PROCESSING },
    });

    try {
      const fromDate = new Date(periodFrom);
      const toDate = new Date(periodTo);

      const { factSheet, metricValueMap } =
        await this.analyticsDataService.buildFactSheet(
          businessId,
          fromDate,
          toDate,
          undefined,
          {
            isDemographicRequested:
              analysisType === AnalysisType.CUSTOMER_ANALYSIS,
          },
        );

      const rawAiResponse = await this.aiService.generateBusinessAnalysis(
        factSheet,
        analysisType,
      );

      const validatedResult = this.validatorService.validateAnalysisResponse(
        rawAiResponse,
        factSheet.period,
        factSheet.metrics,
        metricValueMap,
        factSheet.dataLimitations,
      );

      await this.prisma.businessAnalysis.update({
        where: { id: analysisId },
        data: {
          status: AnalysisStatus.COMPLETED,
          summary: rawAiResponse.summary,
          resultJson: validatedResult as any,
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `Analysis id=${analysisId} successfully completed by worker`,
      );
      return { status: 'COMPLETED', analysisId };
    } catch (err: any) {
      this.logger.error(
        `Worker failed to process analysisId=${analysisId}`,
        err,
      );
      await this.prisma.businessAnalysis.update({
        where: { id: analysisId },
        data: {
          status: AnalysisStatus.FAILED,
          errorMessage:
            err.message ||
            'Background worker encountered an unexpected failure',
        },
      });
      throw err;
    }
  }
}
