import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BusinessRole, SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';
import { PrismaService } from '../../database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterOwnerDto } from './dto/register.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Registers a new Business Owner and their Business in a single atomic transaction
   */
  async registerOwner(
    dto: RegisterOwnerDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const phoneResult = PhoneNormalizer.normalize(dto.phone);
    if (!phoneResult.isValid || !phoneResult.normalized) {
      throw new ConflictException({
        errorCode: 'INVALID_PHONE_NUMBER',
        message: phoneResult.error || 'Invalid phone number format',
      });
    }

    const canonicalPhone = phoneResult.normalized;

    const existingUser = await this.prisma.user.findUnique({
      where: { phone: canonicalPhone },
    });

    if (existingUser) {
      throw new ConflictException({
        errorCode: 'USER_ALREADY_EXISTS',
        message: 'A user with this mobile number is already registered',
      });
    }

    const passwordHash = await argon2.hash(dto.password);

    // Atomically create User, Business, BusinessUser, and default BusinessHours
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone: canonicalPhone,
          passwordHash,
          name: dto.name,
          systemRole: SystemRole.USER,
          isActive: true,
        },
      });

      const business = await tx.business.create({
        data: {
          name: dto.businessName,
          phone: canonicalPhone,
          address: dto.businessAddress,
          city: dto.businessCity,
          state: dto.businessState || null,
          country: 'India',
          pincode: dto.businessPincode,
          email: dto.businessEmail,
        },
      });

      const businessUser = await tx.businessUser.create({
        data: {
          businessId: business.id,
          userId: user.id,
          role: BusinessRole.OWNER,
        },
      });

      // Default 7-day schedule (10:00 - 21:00 Mon-Sat, Sun closed)
      const defaultHours = [
        { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true }, // Sunday
        {
          dayOfWeek: 1,
          openTime: '10:00',
          closeTime: '21:00',
          isClosed: false,
        }, // Monday
        {
          dayOfWeek: 2,
          openTime: '10:00',
          closeTime: '21:00',
          isClosed: false,
        }, // Tuesday
        {
          dayOfWeek: 3,
          openTime: '10:00',
          closeTime: '21:00',
          isClosed: false,
        }, // Wednesday
        {
          dayOfWeek: 4,
          openTime: '10:00',
          closeTime: '21:00',
          isClosed: false,
        }, // Thursday
        {
          dayOfWeek: 5,
          openTime: '10:00',
          closeTime: '21:00',
          isClosed: false,
        }, // Friday
        {
          dayOfWeek: 6,
          openTime: '10:00',
          closeTime: '21:00',
          isClosed: false,
        }, // Saturday
      ];

      for (const h of defaultHours) {
        await tx.businessHours.create({
          data: {
            businessId: business.id,
            dayOfWeek: h.dayOfWeek,
            openTime: h.openTime,
            closeTime: h.closeTime,
            isClosed: h.isClosed,
          },
        });
      }

      return { user, business, businessUser };
    });

    // Create session and issue initial tokens
    const tokens = await this.createSessionAndIssueTokens(
      result.user.id,
      result.user.phone,
      result.user.systemRole,
      result.business.id,
      result.businessUser.role,
      'Registration session',
      ipAddress,
      userAgent,
    );

    return {
      user: {
        id: result.user.id,
        phone: result.user.phone,
        name: result.user.name,
        systemRole: result.user.systemRole,
      },
      business: {
        id: result.business.id,
        name: result.business.name,
        role: result.businessUser.role,
      },
      tokens,
    };
  }

  /**
   * Authenticates user via mobile number & password
   */
  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const phoneResult = PhoneNormalizer.normalize(dto.phone);
    if (!phoneResult.isValid || !phoneResult.normalized) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Invalid mobile number or password',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { phone: phoneResult.normalized },
      include: {
        businessUsers: {
          include: { business: true },
          take: 1,
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Invalid mobile number or password',
      });
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException({
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Invalid mobile number or password',
      });
    }

    const primaryMembership = user.businessUsers[0];
    const businessId = primaryMembership?.businessId;
    const businessRole = primaryMembership?.role;

    const tokens = await this.createSessionAndIssueTokens(
      user.id,
      user.phone,
      user.systemRole,
      businessId,
      businessRole,
      dto.deviceInfo || 'Mobile App / Browser',
      ipAddress,
      userAgent,
    );

    return {
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        systemRole: user.systemRole,
      },
      business: primaryMembership
        ? {
            id: primaryMembership.business.id,
            name: primaryMembership.business.name,
            role: primaryMembership.role,
          }
        : null,
      tokens,
    };
  }

  /**
   * Refreshes access token and rotates refresh token using UserSession
   */
  async refreshTokens(
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    let payload: { sub: string; sessionId: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          'dev-jwt-refresh-secret-32-chars-long-random-key!',
      });
    } catch {
      throw new UnauthorizedException({
        errorCode: 'SESSION_EXPIRED',
        message: 'Refresh token is expired or invalid',
      });
    }

    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        user: {
          include: {
            businessUsers: {
              include: { business: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!session || session.isRevoked || session.expiresAt < new Date()) {
      throw new UnauthorizedException({
        errorCode: 'SESSION_EXPIRED',
        message: 'Session has been revoked or expired',
      });
    }

    // Verify stored refresh token hash
    const isValidToken = await argon2.verify(
      session.refreshTokenHash,
      refreshToken,
    );
    if (!isValidToken) {
      // Possible token reuse attack! Revoke session immediately for security
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { isRevoked: true },
      });
      throw new UnauthorizedException({
        errorCode: 'TOKEN_REUSE_DETECTED',
        message: 'Session revoked due to suspicious activity',
      });
    }

    const user = session.user;
    const primaryMembership = user.businessUsers[0];

    // Issue rotated tokens
    const newTokens = await this.rotateSessionTokens(
      session.id,
      user.id,
      user.phone,
      user.systemRole,
      primaryMembership?.businessId,
      primaryMembership?.role,
      ipAddress,
      userAgent,
    );

    return newTokens;
  }

  /**
   * Revokes a session (Logout)
   */
  async logout(sessionId: string) {
    try {
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { isRevoked: true },
      });
      return { message: 'Logged out successfully' };
    } catch {
      return { message: 'Logged out successfully' };
    }
  }

  /**
   * Retrieves active login sessions for a user
   */
  async getUserSessions(userId: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        deviceInfo: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions;
  }

  /**
   * Revokes a specific session belonging to user
   */
  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found');
    }

    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { isRevoked: true },
    });

    return { message: 'Session revoked successfully' };
  }

  // --- Helper Methods ---

  private async createSessionAndIssueTokens(
    userId: string,
    phone: string,
    systemRole: SystemRole,
    businessId?: string,
    businessRole?: BusinessRole,
    deviceInfo?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const refreshToken = this.jwtService.sign(
      { sub: userId, sessionId },
      {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          'dev-jwt-refresh-secret-32-chars-long-random-key!',
        expiresIn: '7d',
      },
    );

    const refreshTokenHash = await argon2.hash(refreshToken);

    await this.prisma.userSession.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash,
        deviceInfo,
        ipAddress,
        userAgent,
        expiresAt,
      },
    });

    const accessPayload: JwtPayload = {
      sub: userId,
      phone,
      systemRole,
      businessId,
      businessRole,
      sessionId,
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret:
        this.configService.get<string>('JWT_ACCESS_SECRET') ||
        'dev-jwt-access-secret-32-chars-long-random-key!',
      expiresIn: '15m',
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 mins in seconds
    };
  }

  private async rotateSessionTokens(
    sessionId: string,
    userId: string,
    phone: string,
    systemRole: SystemRole,
    businessId?: string,
    businessRole?: BusinessRole,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const newRefreshToken = this.jwtService.sign(
      { sub: userId, sessionId },
      {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          'dev-jwt-refresh-secret-32-chars-long-random-key!',
        expiresIn: '7d',
      },
    );

    const newRefreshTokenHash = await argon2.hash(newRefreshToken);

    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash: newRefreshTokenHash,
        expiresAt,
        ipAddress: ipAddress || undefined,
        userAgent: userAgent || undefined,
      },
    });

    const accessPayload: JwtPayload = {
      sub: userId,
      phone,
      systemRole,
      businessId,
      businessRole,
      sessionId,
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret:
        this.configService.get<string>('JWT_ACCESS_SECRET') ||
        'dev-jwt-access-secret-32-chars-long-random-key!',
      expiresIn: '15m',
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900,
    };
  }
}
