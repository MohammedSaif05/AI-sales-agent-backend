import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/roles.decorator';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@ApiTags('WhatsApp Webhook')
@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  constructor(private readonly webhookService: WhatsAppWebhookService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Meta webhook challenge verification handshake' })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const verifiedChallenge = this.webhookService.verifyWebhookChallenge(
      mode,
      token,
      challenge,
    );
    // Meta requires plain text response of the challenge value
    return res.status(HttpStatus.OK).send(verifiedChallenge);
  }

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Meta webhook intake endpoint with durable staging',
  })
  async handleWebhook(
    @Body() payload: any,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    return this.webhookService.handleIncomingWebhook(payload, signature);
  }
}
