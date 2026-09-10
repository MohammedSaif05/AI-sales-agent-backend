import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { BusinessRole, SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    business: {
      create: jest.fn(),
    },
    businessUser: {
      create: jest.fn(),
    },
    businessHours: {
      create: jest.fn(),
    },
    userSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') return 'test-access-secret';
      if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
      return null;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('registerOwner', () => {
    it('should register owner, create store, setup 7 days hours and return tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const mockUser = {
        id: 'user-1',
        phone: '+919876543210',
        name: 'Dev Owner',
        systemRole: SystemRole.USER,
      };
      const mockBusiness = {
        id: 'biz-1',
        name: 'Fashion Hub',
      };
      const mockBusinessUser = {
        role: BusinessRole.OWNER,
      };

      prisma.user.create.mockResolvedValue(mockUser);
      prisma.business.create.mockResolvedValue(mockBusiness);
      prisma.businessUser.create.mockResolvedValue(mockBusinessUser);
      prisma.businessHours.create.mockResolvedValue({});
      prisma.userSession.create.mockResolvedValue({});

      const result = await service.registerOwner({
        phone: '9876543210',
        password: 'Password123!',
        name: 'Dev Owner',
        businessName: 'Fashion Hub',
        businessAddress: '123 Store St',
        businessCity: 'Delhi',
        businessPincode: '110001',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { phone: '+919876543210' },
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: '+919876543210',
            name: 'Dev Owner',
            systemRole: SystemRole.USER,
          }),
        }),
      );

      expect(prisma.business.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Fashion Hub',
            city: 'Delhi',
          }),
        }),
      );

      // Verify default 7 days hours were created
      expect(prisma.businessHours.create).toHaveBeenCalledTimes(7);

      expect(result.user.phone).toBe('+919876543210');
      expect(result.business.id).toBe('biz-1');
      expect(result.tokens.accessToken).toBe('mock-jwt-token');
    });

    it('should throw ConflictException if phone is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.registerOwner({
          phone: '9876543210',
          password: 'Password123!',
          name: 'Dev Owner',
          businessName: 'Fashion Hub',
          businessAddress: '123 Store St',
          businessCity: 'Delhi',
          businessPincode: '110001',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should authenticate user and return tokens with new UserSession', async () => {
      const passwordHash = await argon2.hash('CorrectPassword123!');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phone: '+919876543210',
        passwordHash,
        isActive: true,
        systemRole: SystemRole.USER,
        businessUsers: [
          {
            role: BusinessRole.OWNER,
            business: { id: 'biz-1', name: 'Fashion Hub' },
          },
        ],
      });

      prisma.userSession.create.mockResolvedValue({});

      const result = await service.login({
        phone: '+91 98765 43210',
        password: 'CorrectPassword123!',
        deviceInfo: 'Android Mobile App',
      });

      expect(result.tokens.accessToken).toBe('mock-jwt-token');
      expect(result.business?.id).toBe('biz-1');
      expect(prisma.userSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            deviceInfo: 'Android Mobile App',
          }),
        }),
      );
    });

    it('should throw UnauthorizedException on invalid password', async () => {
      const passwordHash = await argon2.hash('CorrectPassword123!');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        phone: '+919876543210',
        passwordHash,
        isActive: true,
      });

      await expect(
        service.login({
          phone: '9876543210',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should revoke the specified session', async () => {
      prisma.userSession.update.mockResolvedValue({ isRevoked: true });
      const res = await service.logout('session-1');
      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { isRevoked: true },
      });
      expect(res.message).toContain('Logged out');
    });
  });
});
