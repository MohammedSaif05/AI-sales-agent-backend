import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class WhatsAppMessagesQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: WhatsAppMessageStatus })
  @IsOptional()
  @IsEnum(WhatsAppMessageStatus)
  status?: WhatsAppMessageStatus;

  @ApiPropertyOptional({ enum: WhatsAppMessageDirection })
  @IsOptional()
  @IsEnum(WhatsAppMessageDirection)
  direction?: WhatsAppMessageDirection;

  @ApiPropertyOptional({ description: 'Filter by customer ID' })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Search by phone number' })
  @IsOptional()
  @IsString()
  searchPhone?: string;
}
