import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentBusinessId } from '../../common/decorators/current-business.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { BusinessAnalystService } from './business-analyst.service';
import { AnalysisQueryDto, QuestionQueryDto } from './dto/analysis-query.dto';
import { AskBusinessQuestionDto } from './dto/ask-business-question.dto';
import { GenerateAnalysisDto } from './dto/generate-analysis.dto';

@ApiTags('Business Analyst')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('business-analyst')
export class BusinessAnalystController {
  constructor(private readonly analystService: BusinessAnalystService) {}

  @Post('analysis')
  @ApiOperation({
    summary: 'Generate Business Analysis',
    description:
      'Aggregates trusted backend metrics, synthesizes analytical insights and recommendations via Gemini AI. Supports synchronous execution or asynchronous background BullMQ queueing.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Unique client operation key (max 128 chars). Composite with tenant.',
  })
  @ApiResponse({ status: 201, description: 'Analysis generated synchronously' })
  @ApiResponse({
    status: 202,
    description: 'Analysis enqueued for background processing',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error in date range or parameters',
  })
  @ApiResponse({ status: 404, description: 'Business tenant not found' })
  @ApiResponse({
    status: 409,
    description: 'Idempotency key previously used with different payload',
  })
  async generateAnalysis(
    @CurrentBusinessId() businessId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: GenerateAnalysisDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.analystService.generateAnalysis(
      businessId,
      userId,
      dto,
      idempotencyKey,
    );

    if (dto.isAsync) {
      res.status(HttpStatus.ACCEPTED);
    } else {
      res.status(HttpStatus.CREATED);
    }

    return result;
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get Latest Business Summary',
    description:
      'Fast cached trailing 30-day business performance summary for mobile dashboard home.',
  })
  @ApiResponse({ status: 200, description: 'Cached business summary returned' })
  async getLatestSummary(@CurrentBusinessId() businessId: string) {
    return this.analystService.getLatestSummary(businessId);
  }

  @Get('analysis/:id')
  @ApiOperation({
    summary: 'Get Specific Analysis Report',
    description:
      'Retrieves full analysis report, verified metrics, insights, and recommendations by analysis ID.',
  })
  @ApiResponse({ status: 200, description: 'Analysis report returned' })
  @ApiResponse({
    status: 404,
    description: 'Analysis record not found in tenant',
  })
  async getAnalysis(
    @CurrentBusinessId() businessId: string,
    @Param('id') id: string,
  ) {
    return this.analystService.getAnalysis(businessId, id);
  }

  @Get('analysis')
  @ApiOperation({
    summary: 'List Analysis History',
    description:
      'Returns paginated historical analysis reports for the business.',
  })
  @ApiResponse({ status: 200, description: 'Paginated analysis list' })
  async getAnalysisHistory(
    @CurrentBusinessId() businessId: string,
    @Query() query: AnalysisQueryDto,
  ) {
    return this.analystService.getAnalysisHistory(businessId, query);
  }

  @Post('questions')
  @ApiOperation({
    summary: 'Ask Business Question',
    description:
      'Submits a natural language inquiry about store performance. Gemini formulates a grounded answer strictly using pre-computed tenant analytics.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Unique client key for duplicate question protection',
  })
  @ApiResponse({ status: 200, description: 'Question answered successfully' })
  @ApiResponse({
    status: 400,
    description: 'Question validation failed (length/format)',
  })
  @ApiResponse({ status: 409, description: 'Idempotency key reuse conflict' })
  async askQuestion(
    @CurrentBusinessId() businessId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: AskBusinessQuestionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.analystService.askQuestion(
      businessId,
      userId,
      dto,
      idempotencyKey,
    );
  }

  @Get('questions')
  @ApiOperation({
    summary: 'List Question History',
    description: 'Retrieves paginated past business questions and answers.',
  })
  @ApiResponse({ status: 200, description: 'Paginated question history' })
  async getQuestionHistory(
    @CurrentBusinessId() businessId: string,
    @Query() query: QuestionQueryDto,
  ) {
    return this.analystService.getQuestionHistory(businessId, query);
  }
}
