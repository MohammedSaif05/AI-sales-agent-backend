import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ConfirmImportDto {
  @ApiPropertyOptional({
    default: true,
    description: 'Whether to skip duplicate rows or reject them',
  })
  @IsOptional()
  @IsBoolean()
  skipDuplicates?: boolean = true;
}
