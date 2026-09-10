import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CustomerSource, Gender } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: any;

  const mockPrismaService = {
    customer: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    customerCommunicationPreferences: {
      create: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('create', () => {
    it('should normalize phone number and create customer with default false preferences', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);
      const createdCustomer = {
        id: 'cust-1',
        businessId: 'biz-1',
        name: 'Aarav Mehta',
        rawPhone: '9876543210',
        normalizedPhone: '+919876543210',
        preferences: {
          whatsappMarketing: false,
          voiceMarketing: false,
          emailMarketing: false,
          doNotContact: false,
        },
      };
      prisma.customer.create.mockResolvedValue(createdCustomer);
      prisma.customer.findUnique.mockResolvedValue(createdCustomer);

      const result = await service.create('biz-1', {
        name: 'Aarav Mehta',
        phone: '9876543210',
      });

      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          businessId: 'biz-1',
          normalizedPhone: '+919876543210',
          deletedAt: null,
        },
      });

      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            normalizedPhone: '+919876543210',
            source: CustomerSource.MANUAL,
          }),
        }),
      );

      // Verify default marketing consent is FALSE
      expect(prisma.customerCommunicationPreferences.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            whatsappMarketing: false,
            voiceMarketing: false,
            emailMarketing: false,
            doNotContact: false,
          }),
        }),
      );

      expect(result).toBeDefined();
    });

    it('should throw ConflictException if active customer with same phone exists in business', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'existing-id',
        normalizedPhone: '+919876543210',
      });

      await expect(
        service.create('biz-1', {
          name: 'Another Customer',
          phone: '+91 98765 43210',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should restore previously soft-deleted customer instead of creating duplicate', async () => {
      // First check (active) returns null
      prisma.customer.findFirst
        .mockResolvedValueOnce(null)
        // Second check (deleted) returns record
        .mockResolvedValueOnce({
          id: 'old-deleted-id',
          normalizedPhone: '+919876543210',
          deletedAt: new Date(),
        });

      prisma.customer.update.mockResolvedValue({ id: 'old-deleted-id' });
      prisma.customer.findUnique.mockResolvedValue({
        id: 'old-deleted-id',
        deletedAt: null,
      });

      const result = await service.create('biz-1', {
        name: 'Aarav Mehta Restored',
        phone: '9876543210',
      });

      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-deleted-id' },
          data: expect.objectContaining({
            deletedAt: null,
          }),
        }),
      );
      expect(result).toBeDefined();
    });
  });

  describe('softDelete', () => {
    it('should set deletedAt timestamp on customer', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust-1',
        businessId: 'biz-1',
      });
      prisma.customer.update.mockResolvedValue({
        id: 'cust-1',
        deletedAt: new Date(),
      });

      const result = await service.softDelete('biz-1', 'cust-1');
      expect(result.success).toBe(true);
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
