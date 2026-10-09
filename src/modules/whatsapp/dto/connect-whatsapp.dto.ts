import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ConnectWhatsAppDto {
  @ApiPropertyOptional({
    example: '109876543210987',
    description: 'Meta WhatsApp Business Account ID (WABA ID)',
  })
  @IsOptional()
  @IsString()
  wabaId?: string;

  @ApiPropertyOptional({
    example: '100345678901234',
    description: 'Meta Phone Number ID',
  })
  @IsOptional()
  @IsString()
  phoneNumberId?: string;

  @ApiPropertyOptional({
    description:
      'OAuth authorization code from Meta Embedded Signup to exchange for access token',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    description: 'Pre-acquired Meta System User Access Token',
  })
  @IsOptional()
  @IsString()
  accessToken?: string;

  @ApiPropertyOptional({
    example: '+1 555-0100',
    description: 'Display phone number formatted',
  })
  @IsOptional()
  @IsString()
  displayPhoneNumber?: string;

  @ApiPropertyOptional({
    example: 'Acme Retail Store',
    description: 'Verified business name',
  })
  @IsOptional()
  @IsString()
  verifiedName?: string;

  @ApiPropertyOptional({
    description: 'OAuth redirect_uri used during code request',
  })
  @IsOptional()
  @IsString()
  redirectUri?: string;
}
