import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateBusinessProfileDto {
  @ApiPropertyOptional({ example: 'Sharma Textiles & Apparel' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Shop 12, Fashion Street' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Maharashtra' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '400001' })
  @IsOptional()
  @IsString()
  pincode?: string;

  @ApiPropertyOptional({ example: 'info@sharmatextiles.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'https://sharmatextiles.com' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: '@sharma_textiles' })
  @IsOptional()
  @IsString()
  instagram?: string;

  @ApiPropertyOptional({ example: 'https://facebook.com/sharmatextiles' })
  @IsOptional()
  @IsString()
  facebook?: string;

  @ApiPropertyOptional({ example: 'Premium ethnic and casual clothing store located in Mumbai.' })
  @IsOptional()
  @IsString()
  description?: string;
}
