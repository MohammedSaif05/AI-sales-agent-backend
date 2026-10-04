import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('Admin WhatsApp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/whatsapp')
export class AdminWhatsAppController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('whatsapp-communication') private readonly queue: Queue,
  ) {}

  @Get('connections')
  @ApiOperation({
    summary: 'Platform-wide WhatsApp connections overview (Super Admin only)',
  })
  async listConnections() {
    const connections = await this.prisma.whatsAppConnection.findMany({
      include: {
        business: {
          select: { id: true, name: true, phone: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return connections.map(
      ({ encryptedAccessToken: _encryptedAccessToken, ...conn }) => conn,
    );
  }

  @Get('webhook-events')
  @ApiOperation({ summary: 'Inspect staged webhook events (Super Admin only)' })
  async listWebhookEvents(
    @Query('status') status?: any,
    @Query('limit') limit?: number,
  ) {
    const take = limit ? Math.min(Number(limit), 100) : 50;
    const where: any = {};
    if (status) {
      where.status = status;
    }

    return this.prisma.whatsAppWebhookEvent.findMany({
      where,
      take,
      orderBy: { receivedAt: 'desc' },
    });
  }

  @Post('webhook-events/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually retry a failed or stuck webhook event' })
  async retryWebhookEvent(@Param('id') id: string) {
    const event = await this.prisma.whatsAppWebhookEvent.findUnique({
      where: { id },
    });

    if (!event) {
      throw new NotFoundException(`Webhook event ${id} not found`);
    }

    await this.queue.add(
      'PROCESS_WEBHOOK',
      { eventId: event.id },
      {
        jobId: `webhook-retry-${event.id}-${Date.now()}`,
        removeOnComplete: true,
      },
    );

    return this.prisma.whatsAppWebhookEvent.update({
      where: { id },
      data: {
        status: 'QUEUED',
        errorMessage: null,
      },
    });
  }
}
