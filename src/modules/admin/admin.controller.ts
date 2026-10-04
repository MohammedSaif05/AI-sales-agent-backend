import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SystemRole } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  AnalysisQueryDto,
  QuestionQueryDto,
} from '../business-analyst/dto/analysis-query.dto';
import { AdminService } from './admin.service';

@ApiTags('Super Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SystemRole.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Platform Overview Metrics',
    description:
      'Aggregates system-wide counts: total businesses, users, active customers, completed/failed imports, and files stored.',
  })
  @ApiResponse({ status: 200, description: 'Platform statistics' })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('businesses')
  @ApiOperation({
    summary: 'List All Registered Businesses',
    description:
      'Cross-tenant list of all onboarded businesses, owners, and customer counts.',
  })
  @ApiResponse({ status: 200, description: 'Paginated business list' })
  async getBusinesses(@Query() query: PaginationQueryDto) {
    return this.adminService.getBusinesses(query);
  }

  @Get('businesses/:id')
  @ApiOperation({
    summary: 'Inspect Specific Business Details',
    description: 'Retrieves store profile, members, and operating hours.',
  })
  @ApiResponse({ status: 200, description: 'Business details' })
  @ApiResponse({ status: 404, description: 'Business not found' })
  async getBusinessDetail(@Param('id') id: string) {
    return this.adminService.getBusinessDetail(id);
  }

  @Get('businesses/:id/customers')
  @ApiOperation({
    summary: 'Inspect Customers of a Business',
    description: 'Cross-tenant customer inspection for administrative audit.',
  })
  @ApiResponse({ status: 200, description: 'Customer directory for store' })
  async getBusinessCustomers(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.adminService.getBusinessCustomers(id, query);
  }

  @Get('imports')
  @ApiOperation({
    summary: 'Platform-Wide Customer Import Logs',
    description: 'Lists all customer import jobs across all businesses.',
  })
  @ApiResponse({ status: 200, description: 'Global imports log' })
  async getGlobalImports(@Query() query: PaginationQueryDto) {
    return this.adminService.getGlobalImports(query);
  }

  @Get('imports/:id')
  @ApiOperation({
    summary: 'Inspect Import Job Breakdown',
    description: 'Returns granular status, error summary, and file details.',
  })
  @ApiResponse({ status: 200, description: 'Import job details' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async getImportDetail(@Param('id') id: string) {
    return this.adminService.getImportDetail(id);
  }

  @Get('businesses/:id/analyst-summary')
  @ApiOperation({
    summary: 'Inspect Business Analyst Summary',
    description:
      'Cross-tenant inspection of trailing 30-day business performance summary, verified metrics, insights, and recommendations.',
  })
  @ApiResponse({ status: 200, description: 'Business summary' })
  @ApiResponse({ status: 404, description: 'Business not found' })
  async getBusinessAnalystSummary(@Param('id') id: string) {
    return this.adminService.getBusinessAnalystSummary(id);
  }

  @Get('businesses/:id/analyses')
  @ApiOperation({
    summary: 'Inspect Store Analysis History',
    description:
      'Cross-tenant paginated list of historical analytical reports for a business.',
  })
  @ApiResponse({ status: 200, description: 'Paginated analysis history' })
  @ApiResponse({ status: 404, description: 'Business not found' })
  async getBusinessAnalyses(
    @Param('id') id: string,
    @Query() query: AnalysisQueryDto,
  ) {
    return this.adminService.getBusinessAnalyses(id, query);
  }

  @Get('businesses/:id/analyses/:analysisId')
  @ApiOperation({
    summary: 'Inspect Store Analysis Detail',
    description:
      'Cross-tenant deep inspection of a specific analysis report, verified result, and timestamps.',
  })
  @ApiResponse({ status: 200, description: 'Analysis report details' })
  @ApiResponse({ status: 404, description: 'Analysis or business not found' })
  async getBusinessAnalysisDetail(
    @Param('id') id: string,
    @Param('analysisId') analysisId: string,
  ) {
    return this.adminService.getBusinessAnalysisDetail(id, analysisId);
  }

  @Get('businesses/:id/questions')
  @ApiOperation({
    summary: 'Inspect Store Business Question History',
    description:
      'Cross-tenant paginated list of natural language inquiries and answers for a business.',
  })
  @ApiResponse({ status: 200, description: 'Paginated question history' })
  @ApiResponse({ status: 404, description: 'Business not found' })
  async getBusinessQuestions(
    @Param('id') id: string,
    @Query() query: QuestionQueryDto,
  ) {
    return this.adminService.getBusinessQuestions(id, query);
  }
}
