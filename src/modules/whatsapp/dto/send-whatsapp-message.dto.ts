import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SendWhatsAppMessageDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'Recipient phone number (E.164 or national format)',
  })
  @IsNotEmpty()
  @IsString()
  recipientPhone: string;

  @ApiProperty({
    example: 'Hello! Your order has been confirmed.',
    description: 'Text content of the WhatsApp message',
    maxLength: 4096,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(4096)
  body: string;

  @ApiPropertyOptional({
    description:
      'Optional customer ID in BringBack AI database to associate message with',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
