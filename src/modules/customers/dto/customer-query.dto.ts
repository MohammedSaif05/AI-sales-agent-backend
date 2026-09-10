import { ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerSource, Gender } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Gender, description: 'Filter by gender' })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ enum: CustomerSource, description: 'Filter by customer acquisition source' })
  @IsOptional()
  @IsEnum(CustomerSource)
  source?: CustomerSource;

  @ApiPropertyOptional({ description: 'Filter by doNotContact status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  doNotContact?: boolean;
}
