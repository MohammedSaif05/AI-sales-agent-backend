import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResolveAmbiguousMessageDto {
  @ApiProperty({
    enum: ['MARK_SENT', 'MARK_FAILED'],
    description: 'Manual resolution action for ambiguous message',
  })
  @IsNotEmpty()
  @IsIn(['MARK_SENT', 'MARK_FAILED'])
  action: 'MARK_SENT' | 'MARK_FAILED';

  @ApiPropertyOptional({
    example: 'wamid.HBgLMTE5ODc2NTQzMjEwFQIAERgSRjAzQTFERUZDQzEzNDg2NUM4AA==',
    description:
      'Operator-asserted Meta wamid (required if action is MARK_SENT)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^wamid\.[A-Za-z0-9+/=_-]+$/, {
    message:
      'providerMessageId must start with wamid. and contain valid base64url characters',
  })
  providerMessageId?: string;

  @ApiPropertyOptional({
    example: '100345678901234',
    description:
      'Meta Phone Number ID matching the originating sender connection',
  })
  @IsOptional()
  @IsString()
  providerPhoneNumberId?: string;

  @ApiProperty({
    example:
      'Verified in Meta WhatsApp Manager logs that message was dispatched',
    description: 'Mandatory operator reason for manual resolution',
    minLength: 5,
    maxLength: 500,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
