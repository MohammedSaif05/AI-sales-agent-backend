import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentBusinessId } from '../../common/decorators/current-business.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { BusinessService } from './business.service';
import { UpsertBusinessHoursDto } from './dto/business-hours.dto';
import { UpdateBusinessProfileDto } from './dto/business-profile.dto';

@ApiTags('Business Profile & Hours')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('business')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Get()
  @ApiOperation({
    summary: 'Get Business Profile',
    description:
      'Retrieves store information, operating hours, and signed logo URL for the authenticated tenant.',
  })
  @ApiResponse({ status: 200, description: 'Business profile returned' })
  async getProfile(@CurrentBusinessId() businessId: string) {
    return this.businessService.getProfile(businessId);
  }

  @Patch()
  @ApiOperation({
    summary: 'Update Business Profile',
    description:
      'Updates business contact, address, social media links, and description.',
  })
  @ApiResponse({ status: 200, description: 'Business profile updated' })
  async updateProfile(
    @CurrentBusinessId() businessId: string,
    @Body() dto: UpdateBusinessProfileDto,
  ) {
    return this.businessService.updateProfile(businessId, dto);
  }

  @Post('logo')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload Store Logo',
    description:
      'Uploads a logo image (JPEG, PNG, WebP <= 5MB) to Cloudflare R2 and links to business profile.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Logo uploaded successfully' })
  async uploadLogo(
    @CurrentBusinessId() businessId: string,
    @CurrentUser('userId') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.businessService.uploadLogo(businessId, userId, file);
  }

  @Get('hours')
  @ApiOperation({
    summary: 'Get Business Hours',
    description: 'Returns the 7-day operating schedule for the store.',
  })
  @ApiResponse({ status: 200, description: 'Operating hours schedule' })
  async getHours(@CurrentBusinessId() businessId: string) {
    return this.businessService.getHours(businessId);
  }

  @Put('hours')
  @ApiOperation({
    summary: 'Update Business Hours',
    description:
      'Replaces the complete 7-day schedule. Requires all 7 days with valid open/close times.',
  })
  @ApiResponse({ status: 200, description: 'Operating hours updated' })
  async upsertHours(
    @CurrentBusinessId() businessId: string,
    @Body() dto: UpsertBusinessHoursDto,
  ) {
    return this.businessService.upsertHours(businessId, dto);
  }
}
