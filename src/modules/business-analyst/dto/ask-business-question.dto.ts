import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class AskBusinessQuestionDto {
  @ApiProperty({
    example:
      'How many customers did we onboard this month and what is their WhatsApp consent status?',
    description:
      'Natural language business performance inquiry (3 - 2000 characters)',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(3, 2000, {
    message: 'Question must be between 3 and 2000 characters in length',
  })
  question: string;
}
