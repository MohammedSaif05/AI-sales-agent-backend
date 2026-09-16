import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class BusinessHoursItemDto {
  @ApiProperty({
    example: 1,
    description: 'Day of week: 0 = Sunday, 1 = Monday, ..., 6 = Saturday',
  })
  @IsNotEmpty()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiPropertyOptional({
    example: '10:00',
    description: 'Opening time in 24h format HH:mm',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'openTime must be formatted as HH:mm (e.g. 10:00)',
  })
  openTime?: string | null;

  @ApiPropertyOptional({
    example: '21:00',
    description: 'Closing time in 24h format HH:mm',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'closeTime must be formatted as HH:mm (e.g. 21:00)',
  })
  closeTime?: string | null;

  @ApiProperty({
    example: false,
    description: 'True if store is closed on this day',
  })
  @IsNotEmpty()
  @IsBoolean()
  isClosed: boolean;
}

export class UpsertBusinessHoursDto {
  @ApiProperty({
    type: [BusinessHoursItemDto],
    description: 'Array of schedules for all 7 days (0 to 6)',
  })
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => BusinessHoursItemDto)
  hours: BusinessHoursItemDto[];
}
