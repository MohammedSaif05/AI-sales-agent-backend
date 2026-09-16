import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ImportRowStatus, ImportStatus, ImportType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AIService } from '../ai/ai.service';
import { StorageService } from '../storage/storage.service';
import { CustomerImportsService } from './customer-imports.service';

describe('CustomerImportsService', () => {
  let service: CustomerImportsService;
  let prisma: any;

  const mockPrismaService = {
    customerImport: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    customerImportRow: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    customer: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    customerCommunicationPreferences: {
      create: jest.fn(),
    },
    fileUpload: {
      create: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockStorageService = {
    uploadBuffer: jest.fn().mockResolvedValue('storage-key-1'),
    downloadBuffer: jest.fn(),
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://mock-url'),
  };

  const mockAiService = {
    extractCustomersFromImage: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerImportsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: AIService, useValue: mockAiService },
        { provide: 'BullQueue_customer-imports', useValue: mockQueue },
      ],
    }).compile();

    service = module.get<CustomerImportsService>(CustomerImportsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('CSV Parsing & Staging Logic', () => {
    it('should parse CSV, detect headers, normalize phones and detect intra-file duplicates', async () => {
      const csvContent = `Name,Mobile,Email,City
Rahul Verma,9876543210,rahul@example.com,Mumbai
Ananya Sen,+91 98765 43210,ananya@example.com,Pune
Rohit Kumar,919876543211,rohit@example.com,Delhi
Bad Entry,12345,,`;

      const buffer = Buffer.from(csvContent, 'utf-8');

      prisma.customerImport.findUnique.mockResolvedValue({
        id: 'import-1',
        businessId: 'biz-1',
        importType: ImportType.CSV,
        status: ImportStatus.PENDING,
        file: { storageKey: 'some-key' },
      });

      // No existing customers in DB
      prisma.customer.findMany.mockResolvedValue([]);
      prisma.customerImportRow.createMany.mockResolvedValue({ count: 4 });
      prisma.customerImport.update.mockResolvedValue({});

      await service.processImportJob(
        { importId: 'import-1', businessId: 'biz-1' },
        buffer,
      );

      // Verify staged rows call
      expect(prisma.customerImportRow.createMany).toHaveBeenCalled();
      const stagedData =
        prisma.customerImportRow.createMany.mock.calls[0][0].data;

      expect(stagedData).toHaveLength(4);

      // Row 1: Valid Rahul Verma
      expect(stagedData[0].rawName).toBe('Rahul Verma');
      expect(stagedData[0].normalizedPhone).toBe('+919876543210');
      expect(stagedData[0].status).toBe(ImportRowStatus.VALID);

      // Row 2: Duplicate of Row 1 (same phone +919876543210)
      expect(stagedData[1].rawName).toBe('Ananya Sen');
      expect(stagedData[1].normalizedPhone).toBe('+919876543210');
      expect(stagedData[1].status).toBe(ImportRowStatus.DUPLICATE);
      expect(stagedData[1].duplicateReason).toContain(
        'already appeared earlier in row',
      );

      // Row 3: Valid Rohit Kumar
      expect(stagedData[2].normalizedPhone).toBe('+919876543211');
      expect(stagedData[2].status).toBe(ImportRowStatus.VALID);

      // Row 4: Invalid phone number 12345
      expect(stagedData[3].status).toBe(ImportRowStatus.INVALID);

      // Verify import summary counts updated: 2 valid, 1 duplicate, 1 invalid, total 4
      expect(prisma.customerImport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'import-1' },
          data: expect.objectContaining({
            totalRows: 4,
            validRows: 2,
            duplicateRows: 1,
            invalidRows: 1,
            status: ImportStatus.PREVIEW_READY,
          }),
        }),
      );
    });
  });

  describe('Idempotent Confirmation', () => {
    it('should return idempotent response if import status is already COMPLETED', async () => {
      prisma.customerImport.findUnique.mockResolvedValue({
        id: 'import-completed',
        businessId: 'biz-1',
        status: ImportStatus.COMPLETED,
        validRows: 15,
      });

      const result = await service.confirmImport(
        'biz-1',
        'import-completed',
        'user-1',
        { skipDuplicates: true },
      );

      expect(result.status).toBe(ImportStatus.COMPLETED);
      expect(result.importedCount).toBe(15);
      expect(result.alreadyCompleted).toBe(true);

      // Must NOT attempt to insert customers again
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if import is still in PENDING or PARSING state', async () => {
      prisma.customerImport.findUnique.mockResolvedValue({
        id: 'import-pending',
        businessId: 'biz-1',
        status: ImportStatus.PARSING,
      });

      await expect(
        service.confirmImport('biz-1', 'import-pending', 'user-1', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('should insert valid rows and set status to COMPLETED on valid confirmation', async () => {
      prisma.customerImport.findUnique.mockResolvedValue({
        id: 'import-ready',
        businessId: 'biz-1',
        status: ImportStatus.PREVIEW_READY,
        importType: ImportType.CSV,
      });

      prisma.customerImportRow.findMany.mockResolvedValue([
        {
          id: 'row-1',
          normalizedName: 'Kavita Roy',
          rawPhone: '9876543212',
          normalizedPhone: '+919876543212',
          normalizedEmail: 'kavita@example.com',
          normalizedGender: null,
          normalizedDob: null,
          normalizedCity: 'Kolkata',
          normalizedAddress: null,
        },
      ]);

      prisma.customer.findMany.mockResolvedValue([]);
      prisma.customer.create.mockResolvedValue({ id: 'cust-new' });
      prisma.customerCommunicationPreferences.create.mockResolvedValue({});
      prisma.customerImport.update.mockResolvedValue({});

      const result = await service.confirmImport(
        'biz-1',
        'import-ready',
        'user-1',
        {},
      );

      expect(result.status).toBe(ImportStatus.COMPLETED);
      expect(result.importedCount).toBe(1);

      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            businessId: 'biz-1',
            name: 'Kavita Roy',
            normalizedPhone: '+919876543212',
          }),
        }),
      );

      expect(
        prisma.customerCommunicationPreferences.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            whatsappMarketing: false,
            voiceMarketing: false,
            emailMarketing: false,
          }),
        }),
      );
    });
  });
});
