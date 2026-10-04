import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppMessagingService } from './whatsapp-messaging.service';
import { ConnectWhatsAppDto } from './dto/connect-whatsapp.dto';
import { SendWhatsAppMessageDto } from './dto/send-whatsapp-message.dto';
import { ResolveAmbiguousMessageDto } from './dto/resolve-ambiguous-message.dto';
import { WhatsAppMessagesQueryDto } from './dto/whatsapp-query.dto';

@ApiTags('WhatsApp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly messagingService: WhatsAppMessagingService,
  ) {}

  @Post('connect')
  @Roles('OWNER')
  @ApiOperation({
    summary: 'Connect or update WhatsApp Business Cloud account for tenant',
  })
  @ApiResponse({ status: 200, description: 'WhatsApp connected successfully' })
  async connect(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConnectWhatsAppDto,
  ) {
    return this.whatsappService.connect(user.businessId!, dto);
  }

  @Get('connection')
  @Roles('OWNER', 'STAFF')
  @ApiOperation({
    summary: 'Get current WhatsApp connection details for tenant',
  })
  async getConnection(@CurrentUser() user: AuthenticatedUser) {
    return this.whatsappService.getConnection(user.businessId!);
  }

  @Post('disconnect')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate graceful disconnect of WhatsApp account' })
  async disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Body('reason') reason?: string,
  ) {
    return this.whatsappService.initiateDisconnect(user.businessId!, reason);
  }

  @Post('messages')
  @Roles('OWNER', 'STAFF')
  @ApiOperation({
    summary: 'Send an outbound text message within 24-hour service window',
  })
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendWhatsAppMessageDto,
  ) {
    return this.messagingService.sendMessage(
      user.businessId!,
      dto,
      user.userId,
    );
  }

  @Get('messages')
  @Roles('OWNER', 'STAFF')
  @ApiOperation({
    summary: 'List WhatsApp messages with pagination and filtering',
  })
  async getMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: WhatsAppMessagesQueryDto,
  ) {
    return this.messagingService.getMessages(user.businessId!, query);
  }

  @Get('messages/:id')
  @Roles('OWNER', 'STAFF')
  @ApiOperation({ summary: 'Get details of a specific WhatsApp message' })
  async getMessageById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.messagingService.getMessageById(user.businessId!, id);
  }

  @Post('messages/:id/resolve-ambiguous')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually resolve an ambiguous DISPATCH_UNKNOWN message',
  })
  async resolveAmbiguous(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveAmbiguousMessageDto,
  ) {
    return this.messagingService.resolveAmbiguousMessage(
      user.businessId!,
      id,
      dto,
      user.userId,
    );
  }
}
