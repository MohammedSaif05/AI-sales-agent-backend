import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: '+919876543210', description: 'Registered mobile number' })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty({ example: 'SecurePassword123!', description: 'Account password' })
  @IsNotEmpty()
  @IsString()
  password: string;

  @ApiPropertyOptional({ example: 'iPhone 15 Pro, iOS 17.5', description: 'Device/client information' })
  @IsOptional()
  @IsString()
  deviceInfo?: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Valid refresh token string' })
  @IsNotEmpty()
  @IsString()
  refreshToken: string;
}
