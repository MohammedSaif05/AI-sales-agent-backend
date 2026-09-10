import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CommunicationPreferencesDto {
  @ApiPropertyOptional({ default: false, description: 'Explicit consent for WhatsApp marketing' })
  @IsOptional()
  @IsBoolean()
  whatsappMarketing?: boolean = false;

  @ApiPropertyOptional({ default: false, description: 'Explicit consent for voice calls / marketing' })
  @IsOptional()
  @IsBoolean()
  voiceMarketing?: boolean = false;

  @ApiPropertyOptional({ default: false, description: 'Explicit consent for promotional emails' })
  @IsOptional()
  @IsBoolean()
  emailMarketing?: boolean = false;

  @ApiPropertyOptional({ default: false, description: 'Global do not contact flag' })
  @IsOptional()
  @IsBoolean()
  doNotContact?: boolean = false;
}

export class CreateCustomerDto {
  @ApiProperty({ example: 'Priya Patel', description: 'Customer full name' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: '+919876543210', description: 'Customer mobile number' })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiPropertyOptional({ example: 'priya.patel@example.com', description: 'Customer email' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: Gender, default: Gender.UNSPECIFIED })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender = Gender.UNSPECIFIED;

  @ApiPropertyOptional({ example: '1995-08-15', description: 'Date of birth (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  dob?: string;

  @ApiPropertyOptional({ example: 'B-204, Sunset Heights', description: 'Delivery/residence address' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Mumbai', description: 'City' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ type: CommunicationPreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CommunicationPreferencesDto)
  preferences?: CommunicationPreferencesDto;
}
