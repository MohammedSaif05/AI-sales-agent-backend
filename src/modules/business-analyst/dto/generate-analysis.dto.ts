import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalysisType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isPeriodOrderValid', async: false })
export class IsPeriodOrderValidConstraint implements ValidatorConstraintInterface {
  validate(_value: any, args: ValidationArguments) {
    const obj = args.object as GenerateAnalysisDto;
    if (!obj.periodFrom || !obj.periodTo) return true;
    const fromTime = new Date(obj.periodFrom).getTime();
    const toTime = new Date(obj.periodTo).getTime();
    if (isNaN(fromTime) || isNaN(toTime)) return false;
    return fromTime < toTime;
  }

  defaultMessage() {
    return 'periodFrom must be strictly earlier than periodTo';
  }
}

@ValidatorConstraint({ name: 'isMaxRangeValid', async: false })
export class IsMaxRangeValidConstraint implements ValidatorConstraintInterface {
  validate(_value: any, args: ValidationArguments) {
    const obj = args.object as GenerateAnalysisDto;
    if (!obj.periodFrom || !obj.periodTo) return true;
    const fromTime = new Date(obj.periodFrom).getTime();
    const toTime = new Date(obj.periodTo).getTime();
    if (isNaN(fromTime) || isNaN(toTime)) return false;
    const diffDays = (toTime - fromTime) / (1000 * 60 * 60 * 24);
    return diffDays <= 365;
  }

  defaultMessage() {
    return 'Analysis period cannot exceed 365 days';
  }
}

export class GenerateAnalysisDto {
  @ApiProperty({
    enum: AnalysisType,
    example: AnalysisType.CUSTOMER_ANALYSIS,
    description: 'Category of business analysis to generate',
  })
  @IsEnum(AnalysisType)
  analysisType: AnalysisType;

  @ApiProperty({
    example: '2026-08-01T00:00:00.000Z',
    description: 'Start of analysis period in ISO-8601 UTC (inclusive)',
  })
  @Type(() => Date)
  @IsDate()
  @Validate(IsPeriodOrderValidConstraint)
  @Validate(IsMaxRangeValidConstraint)
  periodFrom: Date;

  @ApiProperty({
    example: '2026-09-01T00:00:00.000Z',
    description: 'End of analysis period in ISO-8601 UTC (exclusive)',
  })
  @Type(() => Date)
  @IsDate()
  periodTo: Date;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description:
      'Set true to enqueue for asynchronous BullMQ background processing',
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  isAsync?: boolean = false;
}
