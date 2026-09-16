import { ApiPropertyOptional } from '@nestjs/swagger';
import { AnalysisStatus, AnalysisType, QuestionStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class AnalysisQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: AnalysisType,
    description: 'Filter analysis history by type',
  })
  @IsOptional()
  @IsEnum(AnalysisType)
  analysisType?: AnalysisType;

  @ApiPropertyOptional({
    enum: AnalysisStatus,
    description: 'Filter analysis history by status',
  })
  @IsOptional()
  @IsEnum(AnalysisStatus)
  status?: AnalysisStatus;
}

export class QuestionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: QuestionStatus,
    description: 'Filter question history by status',
  })
  @IsOptional()
  @IsEnum(QuestionStatus)
  status?: QuestionStatus;
}
