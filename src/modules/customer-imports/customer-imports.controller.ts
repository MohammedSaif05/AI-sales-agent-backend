import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentBusinessId } from '../../common/decorators/current-business.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CustomerImportsService } from './customer-imports.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { ImportRowsQueryDto } from './dto/import-rows-query.dto';

@ApiTags('Customer Imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('customers/import')
export class CustomerImportsController {
  constructor(private readonly importsService: CustomerImportsService) {}

  @Post('file')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload CSV or Excel Customer Sheet',
    description:
      'Uploads file (.csv, .xlsx, .xls <= 10MB) to R2 and stages rows for preview. Returns 202 Accepted with importId.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 202, description: 'File accepted for parsing' })
  async uploadFile(
    @CurrentBusinessId() businessId: string,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.importsService.uploadAndStageFile(businessId, userId, file);
  }

  @Post('image')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload Customer Sheet Image for AI Extraction',
    description:
      'Uploads image (JPEG, PNG, WebP <= 10MB) to R2 and dispatches AI Vision extraction. Output is staged as untrusted input.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 202, description: 'Image accepted for AI extraction' })
  async uploadImage(
    @CurrentBusinessId() businessId: string,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.importsService.uploadAndStageImage(businessId, userId, file);
  }

  @Get()
  @ApiOperation({
    summary: 'List Store Import History',
    description:
      'Returns past import jobs for this business with counts and statuses.',
  })
  @ApiResponse({ status: 200, description: 'Import history' })
  async getHistory(
    @CurrentBusinessId() businessId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.importsService.getImportHistory(
      businessId,
      Number(page),
      Number(limit),
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get Import Job Status & Summary',
    description:
      'Returns current status (PENDING, PARSING, PREVIEW_READY, PROCESSING, COMPLETED) and count breakdown.',
  })
  @ApiResponse({ status: 200, description: 'Import status' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async getStatus(
    @CurrentBusinessId() businessId: string,
    @Param('id') importId: string,
  ) {
    return this.importsService.getImportStatus(businessId, importId);
  }

  @Get(':id/rows')
  @ApiOperation({
    summary: 'Get Paginated Staged Rows for Preview',
    description:
      'Allows business owner to inspect staged valid, invalid, and duplicate customer rows before confirming.',
  })
  @ApiResponse({ status: 200, description: 'Staged rows list' })
  async getRows(
    @CurrentBusinessId() businessId: string,
    @Param('id') importId: string,
    @Query() query: ImportRowsQueryDto,
  ) {
    return this.importsService.getImportRows(businessId, importId, query);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm and Insert Staged Customers',
    description:
      'Idempotently batch-inserts all VALID customers into the store. Retries and duplicate taps will not create duplicates.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Unique client request token to guarantee idempotency',
  })
  @ApiResponse({ status: 200, description: 'Customers successfully imported' })
  @ApiResponse({
    status: 400,
    description: 'Import is not in PREVIEW_READY status',
  })
  async confirm(
    @CurrentBusinessId() businessId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') importId: string,
    @Body() dto: ConfirmImportDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.importsService.confirmImport(
      businessId,
      importId,
      userId,
      dto,
      idempotencyKey,
    );
  }
}
