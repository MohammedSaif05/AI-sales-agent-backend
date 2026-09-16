import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { AnalysisStatus, AnalysisType, QuestionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AIService } from '../ai/ai.service';
import { AnalysisQueryDto, QuestionQueryDto } from './dto/analysis-query.dto';
import { AskBusinessQuestionDto } from './dto/ask-business-question.dto';
import { GenerateAnalysisDto } from './dto/generate-analysis.dto';
import { AnalyticsDataService } from './services/analytics-data.service';
import { AiResponseValidatorService } from './services/ai-response-validator.service';

@Injectable()
export class BusinessAnalystService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BusinessAnalystService.name);
  private readonly redisClient: Redis;
  private readonly defaultTtl: number;
  private watchdogTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly aiService: AIService,
    private readonly analyticsDataService: AnalyticsDataService,
    private readonly validatorService: AiResponseValidatorService,
    @InjectQueue('business-analysis')
    private readonly analysisQueue: Queue,
  ) {
    this.defaultTtl = Number(
      this.configService.get<number>('BUSINESS_ANALYST_CACHE_TTL') || 900,
    );
    this.redisClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST') || 'localhost',
      port: this.configService.get<number>('REDIS_PORT') || 6379,
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      lazyConnect: true,
    });
    this.redisClient.connect().catch((err) => {
      this.logger.warn(
        `Redis client connect failed in BusinessAnalystService: ${err.message}`,
      );
    });
  }

  async onModuleInit() {
    // 1. Initial watchdog pass on application startup
    await this.recoverStaleProcessingJobs().catch((err) => {
      this.logger.warn(`Initial stale watchdog pass failed: ${err.message}`);
    });

    // 2. Periodic watchdog pass every 60 seconds (unrefed so tests can exit cleanly)
    this.watchdogTimer = setInterval(() => {
      this.recoverStaleProcessingJobs().catch((err) => {
        this.logger.warn(`Periodic stale watchdog pass failed: ${err.message}`);
      });
    }, 60000);
    this.watchdogTimer.unref();
  }

  async onModuleDestroy() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
    }
    try {
      await this.redisClient.quit();
    } catch {
      this.redisClient.disconnect();
    }
  }

  /**
   * Generates or queues a business analysis report.
   */
  async generateAnalysis(
    businessId: string,
    userId: string,
    dto: GenerateAnalysisDto,
    idempotencyKey?: string,
  ) {
    const validatedKey = this.validateIdempotencyKey(idempotencyKey);
    const requestHash = this.computeHash({
      endpoint: 'generate-analysis',
      analysisType: dto.analysisType,
      periodFrom: dto.periodFrom.toISOString(),
      periodTo: dto.periodTo.toISOString(),
      isAsync: dto.isAsync,
    });

    // 1. Idempotency Check
    if (validatedKey) {
      const existing = await this.prisma.businessAnalysis.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId,
            idempotencyKey: validatedKey,
          },
        },
      });

      if (existing) {
        if (existing.requestHash && existing.requestHash !== requestHash) {
          throw new ConflictException({
            errorCode: 'IDEMPOTENCY_KEY_REUSE_CONFLICT',
            message:
              'The provided Idempotency-Key was previously used with a different request payload',
          });
        }
        this.logger.log(`Idempotent analysis return for key=${validatedKey}`);
        return this.formatAnalysisResponse(existing);
      }
    }

    // 2. Compute Fact Sheet & Snapshot
    const isDemographicRequested =
      dto.analysisType === AnalysisType.CUSTOMER_ANALYSIS;

    const { factSheet, metadata, metricValueMap } =
      await this.analyticsDataService.buildFactSheet(
        businessId,
        dto.periodFrom,
        dto.periodTo,
        undefined,
        { isDemographicRequested },
      );

    const snapshotPayload = {
      ...factSheet,
      metadata,
    };

    // 3. Asynchronous Flow
    if (dto.isAsync) {
      let record;
      try {
        record = await this.prisma.businessAnalysis.create({
          data: {
            businessId,
            requestedByUserId: userId,
            analysisType: dto.analysisType,
            periodFrom: dto.periodFrom,
            periodTo: dto.periodTo,
            status: AnalysisStatus.QUEUED,
            dataSnapshotJson: snapshotPayload as any,
            idempotencyKey: validatedKey,
            requestHash,
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002' && validatedKey) {
          return this.handleIdempotencyRaceCondition(
            businessId,
            validatedKey,
            requestHash,
          );
        }
        throw err;
      }

      // Enqueue to BullMQ with deterministic jobId
      await this.analysisQueue.add(
        'process-analysis',
        {
          analysisId: record.id,
          businessId,
          analysisType: dto.analysisType,
          periodFrom: dto.periodFrom.toISOString(),
          periodTo: dto.periodTo.toISOString(),
        },
        {
          jobId: `business-analysis:${businessId}:${record.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: true,
        },
      );

      return {
        id: record.id,
        analysisType: record.analysisType,
        status: AnalysisStatus.QUEUED,
        message: 'Analysis request queued for background processing',
      };
    }

    // 4. Synchronous Flow
    let record;
    try {
      record = await this.prisma.businessAnalysis.create({
        data: {
          businessId,
          requestedByUserId: userId,
          analysisType: dto.analysisType,
          periodFrom: dto.periodFrom,
          periodTo: dto.periodTo,
          status: AnalysisStatus.PROCESSING,
          dataSnapshotJson: snapshotPayload as any,
          idempotencyKey: validatedKey,
          requestHash,
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002' && validatedKey) {
        return this.handleIdempotencyRaceCondition(
          businessId,
          validatedKey,
          requestHash,
        );
      }
      throw err;
    }

    try {
      const rawAiResponse = await this.aiService.generateBusinessAnalysis(
        factSheet,
        dto.analysisType,
      );

      const validatedResult = this.validatorService.validateAnalysisResponse(
        rawAiResponse,
        factSheet.period,
        factSheet.metrics,
        metricValueMap,
        factSheet.dataLimitations,
      );

      const updated = await this.prisma.businessAnalysis.update({
        where: { id: record.id },
        data: {
          status: AnalysisStatus.COMPLETED,
          summary: rawAiResponse.summary,
          resultJson: validatedResult as any,
          completedAt: new Date(),
        },
      });

      // Cache report result
      await this.cacheAnalysis(
        businessId,
        dto.analysisType,
        dto.periodFrom,
        dto.periodTo,
        validatedResult,
      );

      return this.formatAnalysisResponse(updated);
    } catch (err: any) {
      this.logger.error(
        `Synchronous analysis generation failed for id=${record.id}`,
        err,
      );
      await this.prisma.businessAnalysis.update({
        where: { id: record.id },
        data: {
          status: AnalysisStatus.FAILED,
          errorMessage:
            err.message ||
            'Analysis processing encountered an unexpected failure',
        },
      });
      throw err;
    }
  }

  /**
   * Retrieves a single analysis record with stuck-job recovery handling.
   */
  async getAnalysis(businessId: string, id: string) {
    const record = await this.prisma.businessAnalysis.findFirst({
      where: { id, businessId },
    });

    if (!record) {
      throw new NotFoundException({
        errorCode: 'ANALYSIS_NOT_FOUND',
        message: 'Business analysis record not found',
      });
    }

    // Stuck in PROCESSING recovery check (> 5 minutes)
    if (
      record.status === AnalysisStatus.PROCESSING &&
      Date.now() - record.updatedAt.getTime() > 300000
    ) {
      this.logger.warn(`Recovering stale processing analysis id=${id}`);
      const recovered = await this.prisma.businessAnalysis.update({
        where: { id },
        data: {
          status: AnalysisStatus.FAILED,
          errorMessage: 'Analysis processing timed out or failed to complete.',
        },
      });
      return this.formatAnalysisResponse(recovered);
    }

    return this.formatAnalysisResponse(record);
  }

  /**
   * Lists paginated analysis history for the business.
   */
  async getAnalysisHistory(businessId: string, query: AnalysisQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { businessId };
    if (query.analysisType) where.analysisType = query.analysisType;
    if (query.status) where.status = query.status;

    const [total, records] = await Promise.all([
      this.prisma.businessAnalysis.count({ where }),
      this.prisma.businessAnalysis.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: records.map((r) => this.formatAnalysisResponse(r)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    };
  }

  /**
   * Fast cached latest business summary for mobile dashboard.
   */
  async getLatestSummary(businessId: string) {
    const cacheKey = `tenant:${businessId}:analyst:summary`;

    try {
      const cached = await this.redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      this.logger.warn(`Redis get cache error: ${err}`);
    }

    // Default to trailing 30-day window
    const periodTo = new Date();
    const periodFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const { factSheet, metricValueMap } =
      await this.analyticsDataService.buildFactSheet(
        businessId,
        periodFrom,
        periodTo,
      );

    const rawAiResponse = await this.aiService.generateBusinessAnalysis(
      factSheet,
      AnalysisType.BUSINESS_SUMMARY,
    );

    const validatedResult = this.validatorService.validateAnalysisResponse(
      rawAiResponse,
      factSheet.period,
      factSheet.metrics,
      metricValueMap,
      factSheet.dataLimitations,
    );

    const summaryPayload = {
      period: factSheet.period,
      summary: rawAiResponse.summary,
      metrics: factSheet.metrics,
      insights: validatedResult.insights,
      recommendations: validatedResult.recommendations,
      dataLimitations: validatedResult.dataLimitations,
    };

    try {
      await this.redisClient.set(
        cacheKey,
        JSON.stringify(summaryPayload),
        'EX',
        this.defaultTtl,
      );
    } catch (err) {
      this.logger.warn(`Redis set cache error: ${err}`);
    }

    return summaryPayload;
  }

  /**
   * Answers natural language business questions with idempotency and minimal context.
   */
  async askQuestion(
    businessId: string,
    userId: string,
    dto: AskBusinessQuestionDto,
    idempotencyKey?: string,
  ) {
    const validatedKey = this.validateIdempotencyKey(idempotencyKey);
    const requestHash = this.computeHash({
      endpoint: 'questions',
      question: dto.question,
    });

    if (validatedKey) {
      const existing = await this.prisma.businessQuestion.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId,
            idempotencyKey: validatedKey,
          },
        },
      });

      if (existing) {
        if (existing.requestHash && existing.requestHash !== requestHash) {
          throw new ConflictException({
            errorCode: 'IDEMPOTENCY_KEY_REUSE_CONFLICT',
            message:
              'The provided Idempotency-Key was previously used with a different request payload',
          });
        }
        return {
          id: existing.id,
          question: existing.question,
          answer: existing.answer,
          status: existing.status,
          createdAt: existing.createdAt,
        };
      }
    }

    // Default 30-day contextual fact sheet
    const periodTo = new Date();
    const periodFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const isDemographicRequested = Boolean(
      dto.question.toLowerCase().match(/age|demographic|dob|birthday|birth/),
    );

    const { factSheet, metadata } =
      await this.analyticsDataService.buildFactSheet(
        businessId,
        periodFrom,
        periodTo,
        undefined,
        { isDemographicRequested },
      );

    let questionRecord;
    try {
      questionRecord = await this.prisma.businessQuestion.create({
        data: {
          businessId,
          userId,
          question: dto.question,
          status: QuestionStatus.PROCESSING,
          contextJson: {
            period: factSheet.period,
            metrics: factSheet.metrics,
            dataLimitations: factSheet.dataLimitations,
            metadata,
          } as any,
          idempotencyKey: validatedKey,
          requestHash,
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002' && validatedKey) {
        return this.handleQuestionIdempotencyRaceCondition(
          businessId,
          validatedKey,
          requestHash,
        );
      }
      throw err;
    }

    try {
      const rawAiResponse = await this.aiService.answerBusinessQuestion(
        dto.question,
        factSheet,
      );

      const validated = this.validatorService.validateQuestionResponse(
        questionRecord.id,
        dto.question,
        rawAiResponse,
        factSheet.dataLimitations,
      );

      const updated = await this.prisma.businessQuestion.update({
        where: { id: questionRecord.id },
        data: {
          status: QuestionStatus.COMPLETED,
          answer: validated.answer,
        },
      });

      return {
        id: updated.id,
        question: updated.question,
        answer: updated.answer,
        status: updated.status,
        dataLimitations: validated.dataLimitations,
        createdAt: updated.createdAt,
      };
    } catch (err: any) {
      this.logger.error(`Business Q&A failed for id=${questionRecord.id}`, err);
      await this.prisma.businessQuestion.update({
        where: { id: questionRecord.id },
        data: {
          status: QuestionStatus.FAILED,
          errorMessage: err.message || 'Failed to answer business question',
        },
      });
      throw err;
    }
  }

  /**
   * Retrieves paginated question history.
   */
  async getQuestionHistory(businessId: string, query: QuestionQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { businessId };
    if (query.status) where.status = query.status;

    const [total, records] = await Promise.all([
      this.prisma.businessQuestion.count({ where }),
      this.prisma.businessQuestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: records.map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        status: r.status,
        createdAt: r.createdAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    };
  }

  /**
   * Invalidates Redis cache keys for the specified business.
   */
  async invalidateBusinessCache(businessId: string): Promise<void> {
    try {
      const pattern = `tenant:${businessId}:analyst:*`;
      const keys = await this.redisClient.keys(pattern);
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
        this.logger.log(
          `Invalidated ${keys.length} cache keys for businessId=${businessId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate cache for businessId=${businessId}: ${err}`,
      );
    }
  }
  /**
   * Watchdog recovery for analysis jobs stuck in PROCESSING state longer than timeout threshold.
   */
  async recoverStaleProcessingJobs(
    timeoutMinutes: number = 5,
  ): Promise<number> {
    const thresholdDate = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    const result = await this.prisma.businessAnalysis.updateMany({
      where: {
        status: AnalysisStatus.PROCESSING,
        updatedAt: {
          lt: thresholdDate,
        },
      },
      data: {
        status: AnalysisStatus.FAILED,
        errorMessage:
          'Analysis processing timed out and was recovered by watchdog.',
      },
    });

    if (result.count > 0) {
      this.logger.warn(
        `Recovered ${result.count} stale analysis jobs stuck in PROCESSING state`,
      );
    }

    return result.count;
  }

  // --- Helpers ---

  private async cacheAnalysis(
    businessId: string,
    type: string,
    from: Date,
    to: Date,
    data: any,
  ) {
    try {
      const key = `tenant:${businessId}:analyst:report:${type}:${from.toISOString()}:${to.toISOString()}`;
      await this.redisClient.set(
        key,
        JSON.stringify(data),
        'EX',
        this.defaultTtl,
      );
    } catch (err) {
      this.logger.warn(`Cache analysis set failed: ${err}`);
    }
  }

  private validateIdempotencyKey(key?: string): string | undefined {
    if (!key) return undefined;
    const trimmed = key.trim();
    if (trimmed.length === 0) return undefined;
    if (trimmed.length > 128) {
      throw new BadRequestException(
        'Idempotency-Key header exceeds maximum allowed length of 128 characters',
      );
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      throw new BadRequestException(
        'Idempotency-Key header contains invalid characters. Use alphanumeric, dashes, or underscores',
      );
    }
    return trimmed;
  }

  private computeHash(payload: Record<string, any>): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private async handleIdempotencyRaceCondition(
    businessId: string,
    idempotencyKey: string,
    incomingHash: string,
  ) {
    const existing = await this.prisma.businessAnalysis.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId,
          idempotencyKey,
        },
      },
    });

    if (existing) {
      if (existing.requestHash && existing.requestHash !== incomingHash) {
        throw new ConflictException({
          errorCode: 'IDEMPOTENCY_KEY_REUSE_CONFLICT',
          message:
            'The provided Idempotency-Key was previously used with a different request payload',
        });
      }
      return this.formatAnalysisResponse(existing);
    }
    throw new ConflictException(
      'Concurrent request conflict detected for this Idempotency-Key',
    );
  }

  private async handleQuestionIdempotencyRaceCondition(
    businessId: string,
    idempotencyKey: string,
    incomingHash: string,
  ) {
    const existing = await this.prisma.businessQuestion.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId,
          idempotencyKey,
        },
      },
    });

    if (existing) {
      if (existing.requestHash && existing.requestHash !== incomingHash) {
        throw new ConflictException({
          errorCode: 'IDEMPOTENCY_KEY_REUSE_CONFLICT',
          message:
            'The provided Idempotency-Key was previously used with a different request payload',
        });
      }
      return {
        id: existing.id,
        question: existing.question,
        answer: existing.answer,
        status: existing.status,
        createdAt: existing.createdAt,
      };
    }
    throw new ConflictException(
      'Concurrent question conflict detected for this Idempotency-Key',
    );
  }

  private formatAnalysisResponse(record: any) {
    return {
      id: record.id,
      analysisType: record.analysisType,
      status: record.status,
      summary: record.summary,
      result: record.resultJson,
      errorMessage: record.errorMessage,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
    };
  }
}
