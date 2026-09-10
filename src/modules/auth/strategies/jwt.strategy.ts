import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../database/prisma.service';
import { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  phone: string;
  systemRole: 'USER' | 'SUPER_ADMIN';
  businessId?: string;
  businessRole?: 'OWNER' | 'STAFF';
  sessionId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_ACCESS_SECRET') ||
        'dev-jwt-access-secret-32-chars-long-random-key!',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub || !payload.sessionId) {
      throw new UnauthorizedException('Malformed token payload');
    }

    // Verify session is active and not revoked
    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sessionId },
    });

    if (!session || session.isRevoked || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session is expired or has been revoked');
    }

    return {
      userId: payload.sub,
      phone: payload.phone,
      systemRole: payload.systemRole,
      businessId: payload.businessId,
      businessRole: payload.businessRole,
      sessionId: payload.sessionId,
    };
  }
}
