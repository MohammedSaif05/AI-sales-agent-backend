import { ApiPropertyOptional } from '@nestjs/swagger';
import { ImportRowStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ImportRowsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ImportRowStatus,
    description: 'Filter staged preview rows by status (VALID, INVALID, DUPLICATE)',
  })
  @IsOptional()
  @IsEnum(ImportRowStatus)
  status?: ImportRowStatus;
}
