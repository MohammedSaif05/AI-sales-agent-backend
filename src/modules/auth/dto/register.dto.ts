import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterOwnerDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'Owner mobile number (Indian standard)',
  })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty({
    example: 'SecurePassword123!',
    minLength: 8,
    description: 'Owner account password',
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Rajesh Sharma', description: 'Owner full name' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Sharma Textiles',
    description: 'Business display name',
  })
  @IsNotEmpty()
  @IsString()
  businessName: string;

  @ApiProperty({
    example: 'Shop 12, Fashion Street, Commercial Road',
    description: 'Physical store address',
  })
  @IsNotEmpty()
  @IsString()
  businessAddress: string;

  @ApiProperty({ example: 'Mumbai', description: 'City' })
  @IsNotEmpty()
  @IsString()
  businessCity: string;

  @ApiProperty({ example: '400001', description: 'Postal pincode' })
  @IsNotEmpty()
  @IsString()
  businessPincode: string;

  @ApiPropertyOptional({ example: 'Maharashtra', description: 'State' })
  @IsOptional()
  @IsString()
  businessState?: string = 'Maharashtra';

  @ApiPropertyOptional({
    example: 'contact@sharmatextiles.com',
    description: 'Business email',
  })
  @IsOptional()
  @IsString()
  businessEmail?: string;
}
