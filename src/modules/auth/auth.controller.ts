import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto } from './dto/login.dto';
import { RegisterOwnerDto } from './dto/register.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Register Business Owner & Initialize Store',
    description:
      'Creates owner user, initializes business profile, creates default operating hours, and returns JWT tokens.',
  })
  @ApiResponse({ status: 201, description: 'Owner registered successfully' })
  @ApiResponse({ status: 409, description: 'Mobile number already registered' })
  async register(@Body() dto: RegisterOwnerDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.registerOwner(dto, ip, userAgent);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with Mobile Number & Password',
    description:
      'Authenticates owner or platform user, registers a new device UserSession, and returns tokens.',
  })
  @ApiResponse({ status: 200, description: 'Authentication successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.login(dto, ip, userAgent);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh Access Token',
    description:
      'Validates refresh token against UserSession, rotates refresh token, and returns a new token pair.',
  })
  @ApiResponse({ status: 200, description: 'Tokens rotated successfully' })
  @ApiResponse({ status: 401, description: 'Session expired or revoked' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.authService.refreshTokens(dto.refreshToken, ip, userAgent);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout Current Session',
    description:
      'Revokes the current device UserSession so refresh tokens can no longer be used.',
  })
  @ApiResponse({ status: 200, description: 'Session revoked successfully' })
  async logout(@CurrentUser('sessionId') sessionId: string) {
    return this.authService.logout(sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('sessions')
  @ApiOperation({
    summary: 'List Active Login Sessions',
    description: 'Retrieves all active devices/sessions for the authenticated user.',
  })
  @ApiResponse({ status: 200, description: 'List of active sessions' })
  async getSessions(@CurrentUser('userId') userId: string) {
    return this.authService.getUserSessions(userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete('sessions/:id')
  @ApiOperation({
    summary: 'Revoke Specific Session',
    description: 'Terminates an individual device session.',
  })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  async revokeSession(
    @CurrentUser('userId') userId: string,
    @Param('id') sessionId: string,
  ) {
    return this.authService.revokeSession(userId, sessionId);
  }
}
