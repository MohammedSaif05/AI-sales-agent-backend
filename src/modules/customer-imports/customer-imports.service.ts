import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerSource,
  FileCategory,
  Gender,
  ImportRowStatus,
  ImportStatus,
  ImportType,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { parse } from 'csv-parse/sync';
import { randomUUID } from 'crypto';
import * as xlsx from 'xlsx';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';
import { PrismaService } from '../../database/prisma.service';
import { AIService } from '../ai/ai.service';
import { StorageService } from '../storage/storage.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { ImportRowsQueryDto } from './dto/import-rows-query.dto';

interface RawRowData {
  name?: string;
  phone?: string;
  email?: string;
  city?: string;
  address?: string;
  gender?: string;
  dob?: string;
}

@Injectable()
export class CustomerImportsService {
  private readonly logger = new Logger(CustomerImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly aiService: AIService,
    @InjectQueue('customer-imports')
    private readonly importQueue: Queue,
  ) {}

  /**
   * Uploads CSV or Excel spreadsheet and dispatches background parsing job
   */
  async uploadAndStageFile(
    businessId: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        errorCode: 'INVALID_FILE',
        message: 'A valid CSV or Excel file is required',
      });
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    const isCsv = ext === 'csv';
    const isExcel = ext === 'xlsx' || ext === 'xls';

    if (!isCsv && !isExcel) {
      throw new BadRequestException({
        errorCode: 'INVALID_FILE_TYPE',
        message: 'Only CSV (.csv) and Excel (.xlsx, .xls) files are supported',
      });
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException({
        errorCode: 'FILE_TOO_LARGE',
        message: 'Import file size must not exceed 10MB',
      });
    }

    const importType = isCsv ? ImportType.CSV : ImportType.EXCEL;
    const importId = randomUUID();
    const storageKey = `businesses/${businessId}/imports/${importId}/${file.originalname}`;

    // Upload to R2
    await this.storageService.uploadBuffer(
      storageKey,
      file.buffer,
      file.mimetype || 'application/octet-stream',
    );

    // Save FileUpload and CustomerImport in transaction
    await this.prisma.$transaction(async (tx) => {
      const fileUpload = await tx.fileUpload.create({
        data: {
          businessId,
          fileName: file.originalname,
          fileType: file.mimetype || 'application/octet-stream',
          storageKey,
          fileSize: file.size,
          category: FileCategory.CUSTOMER_IMPORT,
          uploadedById: userId,
        },
      });

      await tx.customerImport.create({
        data: {
          id: importId,
          businessId,
          fileId: fileUpload.id,
          importType,
          status: ImportStatus.PENDING,
          createdById: userId,
        },
      });
    });

    // Enqueue job or run fallback asynchronously
    await this.dispatchImportJob(importId, businessId, file.buffer);

    return {
      importId,
      status: ImportStatus.PENDING,
      message: 'File uploaded successfully and staged for parsing',
    };
  }

  /**
   * Uploads image of customer list and dispatches AI vision extraction job
   */
  async uploadAndStageImage(
    businessId: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        errorCode: 'INVALID_FILE',
        message: 'Image file is required',
      });
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException({
        errorCode: 'INVALID_FILE_TYPE',
        message: 'Image must be JPEG, PNG, or WebP format',
      });
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException({
        errorCode: 'FILE_TOO_LARGE',
        message: 'Image file size must not exceed 10MB',
      });
    }

    const importId = randomUUID();
    const ext = file.originalname.split('.').pop() || 'jpg';
    const storageKey = `businesses/${businessId}/imports/${importId}/${randomUUID()}.${ext}`;

    await this.storageService.uploadBuffer(storageKey, file.buffer, file.mimetype);

    await this.prisma.$transaction(async (tx) => {
      const fileUpload = await tx.fileUpload.create({
        data: {
          businessId,
          fileName: file.originalname,
          fileType: file.mimetype,
          storageKey,
          fileSize: file.size,
          category: FileCategory.CUSTOMER_IMPORT,
          uploadedById: userId,
        },
      });

      await tx.customerImport.create({
        data: {
          id: importId,
          businessId,
          fileId: fileUpload.id,
          importType: ImportType.IMAGE,
          status: ImportStatus.PENDING,
          createdById: userId,
        },
      });
    });

    await this.dispatchImportJob(importId, businessId, file.buffer);

    return {
      importId,
      status: ImportStatus.PENDING,
      message: 'Image uploaded and queued for AI vision extraction',
    };
  }

  /**
   * Dispatches job to BullMQ queue, or invokes async worker fallback if Redis queue is offline
   */
  private async dispatchImportJob(
    importId: string,
    businessId: string,
    buffer?: Buffer,
  ) {
    try {
      await this.importQueue.add(
        'process-import',
        { importId, businessId },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
      this.logger.log(`Enqueued BullMQ job for importId: ${importId}`);
    } catch (err: unknown) {
      this.logger.warn(
        `BullMQ queue add failed (Redis might be offline). Running async worker directly: ${err}`,
      );
      // Run asynchronously without blocking HTTP response
      setImmediate(async () => {
        try {
          await this.processImportJob({ importId, businessId }, buffer);
        } catch (jobErr) {
          this.logger.error(`Direct async processing failed for ${importId}`, jobErr);
        }
      });
    }
  }

  /**
   * Core background parsing & staging job (invoked by BullMQ processor or direct fallback)
   */
  async processImportJob(
    jobData: { importId: string; businessId: string },
    cachedBuffer?: Buffer,
  ) {
    const { importId, businessId } = jobData;
    this.logger.log(`Processing import job for importId=${importId}`);

    const importRecord = await this.prisma.customerImport.findUnique({
      where: { id: importId },
      include: { file: true },
    });

    if (!importRecord) {
      this.logger.error(`CustomerImport not found: ${importId}`);
      return;
    }

    // Mark as PARSING
    await this.prisma.customerImport.update({
      where: { id: importId },
      data: { status: ImportStatus.PARSING },
    });

    try {
      let fileBuffer = cachedBuffer;
      if (!fileBuffer && importRecord.file?.storageKey) {
        fileBuffer = await this.storageService.downloadBuffer(
          importRecord.file.storageKey,
        );
      }

      if (!fileBuffer) {
        throw new Error('File content could not be retrieved from object storage');
      }

      let rawRows: RawRowData[] = [];

      if (importRecord.importType === ImportType.IMAGE) {
        const mimeType = importRecord.file?.fileType || 'image/jpeg';
        const extracted = await this.aiService.extractCustomersFromImage(
          fileBuffer,
          mimeType,
        );
        rawRows = extracted.map((e) => ({
          name: e.rawName,
          phone: e.rawPhone,
          email: e.rawEmail || undefined,
          gender: e.rawGender || undefined,
          dob: e.rawDob || undefined,
          city: e.rawCity || undefined,
          address: e.rawAddress || undefined,
        }));
      } else if (importRecord.importType === ImportType.CSV) {
        rawRows = this.parseCsvBuffer(fileBuffer);
      } else if (importRecord.importType === ImportType.EXCEL) {
        rawRows = this.parseExcelBuffer(fileBuffer);
      }

      // Fetch all existing active phone numbers in this business for duplicate detection
      const existingCustomers = await this.prisma.customer.findMany({
        where: { businessId, deletedAt: null },
        select: { normalizedPhone: true },
      });
      const existingPhones = new Set(existingCustomers.map((c) => c.normalizedPhone));

      // Track phones seen within this file to detect intra-file duplicates
      const seenPhonesInFile = new Set<string>();

      let validCount = 0;
      let invalidCount = 0;
      let duplicateCount = 0;

      const stagedRowsData: any[] = [];

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const rowNumber = i + 1;
        const validationErrors: string[] = [];

        // Validate Name
        const rawName = (row.name || '').trim();
        let normalizedName: string | null = null;
        if (!rawName) {
          validationErrors.push('Customer name is missing');
        } else {
          normalizedName = rawName;
        }

        // Validate & Normalize Phone
        const rawPhone = (row.phone || '').trim();
        let normalizedPhone: string | null = null;
        let isDuplicate = false;
        let duplicateReason: string | null = null;

        if (!rawPhone) {
          validationErrors.push('Phone number is missing');
        } else {
          const phoneResult = PhoneNormalizer.normalize(rawPhone);
          if (!phoneResult.isValid || !phoneResult.normalized) {
            validationErrors.push(
              phoneResult.error || 'Invalid phone number format',
            );
          } else {
            normalizedPhone = phoneResult.normalized;

            // Check intra-file duplicate
            if (seenPhonesInFile.has(normalizedPhone)) {
              isDuplicate = true;
              duplicateReason = `Duplicate phone number in file (already appeared earlier in row)`;
            } else if (existingPhones.has(normalizedPhone)) {
              isDuplicate = true;
              duplicateReason = `Customer with phone ${normalizedPhone} already exists in your store`;
            } else {
              seenPhonesInFile.add(normalizedPhone);
            }
          }
        }

        // Validate Email
        const rawEmail = (row.email || '').trim();
        let normalizedEmail: string | null = null;
        if (rawEmail) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(rawEmail)) {
            validationErrors.push('Invalid email address format');
          } else {
            normalizedEmail = rawEmail.toLowerCase();
          }
        }

        // Parse Gender
        const rawGender = (row.gender || '').trim();
        let normalizedGender: Gender | null = null;
        if (rawGender) {
          const gUpper = rawGender.toUpperCase();
          if (gUpper.startsWith('M')) normalizedGender = Gender.MALE;
          else if (gUpper.startsWith('F')) normalizedGender = Gender.FEMALE;
          else if (gUpper.startsWith('O')) normalizedGender = Gender.OTHER;
          else normalizedGender = Gender.UNSPECIFIED;
        }

        // Parse DOB
        const rawDob = (row.dob || '').trim();
        let normalizedDob: Date | null = null;
        if (rawDob) {
          const d = new Date(rawDob);
          if (!isNaN(d.getTime())) {
            normalizedDob = d;
          }
        }

        const rawCity = (row.city || '').trim() || null;
        const rawAddress = (row.address || '').trim() || null;

        // Determine Status
        let status: ImportRowStatus = ImportRowStatus.VALID;
        if (validationErrors.length > 0) {
          status = ImportRowStatus.INVALID;
          invalidCount++;
        } else if (isDuplicate) {
          status = ImportRowStatus.DUPLICATE;
          duplicateCount++;
        } else {
          validCount++;
        }

        stagedRowsData.push({
          importId,
          rowNumber,
          rawName: rawName || null,
          rawPhone: rawPhone || null,
          rawEmail: rawEmail || null,
          rawGender: rawGender || null,
          rawDob: rawDob || null,
          rawCity,
          rawAddress,
          normalizedName,
          normalizedPhone,
          normalizedEmail,
          normalizedGender,
          normalizedDob,
          normalizedCity: rawCity,
          normalizedAddress: rawAddress,
          status,
          validationErrors:
            validationErrors.length > 0 ? validationErrors : null,
          isDuplicate,
          duplicateReason,
        });
      }

      // Batch insert staged rows in chunks of 500
      const chunkSize = 500;
      for (let i = 0; i < stagedRowsData.length; i += chunkSize) {
        const chunk = stagedRowsData.slice(i, i + chunkSize);
        await this.prisma.customerImportRow.createMany({
          data: chunk,
        });
      }

      // Update import summary & status to PREVIEW_READY
      await this.prisma.customerImport.update({
        where: { id: importId },
        data: {
          totalRows: rawRows.length,
          validRows: validCount,
          invalidRows: invalidCount,
          duplicateRows: duplicateCount,
          status: ImportStatus.PREVIEW_READY,
        },
      });

      this.logger.log(
        `Import ${importId} staging complete: ${rawRows.length} total, ${validCount} valid, ${invalidCount} invalid, ${duplicateCount} duplicate`,
      );
    } catch (err: unknown) {
      this.logger.error(`Import ${importId} parsing failed`, err);
      await this.prisma.customerImport.update({
        where: { id: importId },
        data: {
          status: ImportStatus.FAILED,
          errorSummary:
            err instanceof Error ? err.message : 'Unknown parsing error occurred',
        },
      });
    }
  }

  /**
   * Retrieves single import status and counts scoped to business
   */
  async getImportStatus(businessId: string, importId: string) {
    const record = await this.prisma.customerImport.findFirst({
      where: { id: importId, businessId },
      include: {
        file: {
          select: {
            fileName: true,
            fileSize: true,
            storageKey: true,
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundException({
        errorCode: 'IMPORT_NOT_FOUND',
        message: 'Import record not found',
      });
    }

    return record;
  }

  /**
   * Retrieves paginated staged rows for preview review
   */
  async getImportRows(
    businessId: string,
    importId: string,
    query: ImportRowsQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    await this.getImportStatus(businessId, importId);

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const skip = (page - 1) * limit;

    const where: any = { importId };
    if (query.status) {
      where.status = query.status;
    }

    const [total, items] = await Promise.all([
      this.prisma.customerImportRow.count({ where }),
      this.prisma.customerImportRow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { rowNumber: 'asc' },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Retrieves list of imports for this business
   */
  async getImportHistory(businessId: string, page = 1, limit = 10) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;

    const [total, items] = await Promise.all([
      this.prisma.customerImport.count({ where: { businessId } }),
      this.prisma.customerImport.findMany({
        where: { businessId },
        include: {
          file: {
            select: { fileName: true, fileSize: true },
          },
        },
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalPages = Math.ceil(total / safeLimit);

    return {
      data: items,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1,
      },
    };
  }

  /**
   * Idempotent confirmation: batch-inserts all VALID rows into the Customer table
   */
  async confirmImport(
    businessId: string,
    importId: string,
    userId: string,
    dto: ConfirmImportDto,
    idempotencyKey?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.customerImport.findUnique({
        where: { id: importId },
      });

      if (!record || record.businessId !== businessId) {
        throw new NotFoundException({
          errorCode: 'IMPORT_NOT_FOUND',
          message: 'Import record not found',
        });
      }

      // Idempotency check: If already COMPLETED, return current state safely
      if (record.status === ImportStatus.COMPLETED) {
        this.logger.log(`Import ${importId} is already completed. Returning idempotent success.`);
        return {
          importId,
          status: ImportStatus.COMPLETED,
          importedCount: record.validRows,
          alreadyCompleted: true,
        };
      }

      // If currently processing by another concurrent request
      if (record.status === ImportStatus.PROCESSING) {
        return {
          importId,
          status: ImportStatus.PROCESSING,
          message: 'Import confirmation is currently in progress',
        };
      }

      if (record.status !== ImportStatus.PREVIEW_READY) {
        throw new BadRequestException({
          errorCode: 'INVALID_IMPORT_STATE',
          message: `Cannot confirm import in state: ${record.status}. Must be in PREVIEW_READY state.`,
        });
      }

      // Claim processing state
      await tx.customerImport.update({
        where: { id: importId },
        data: {
          status: ImportStatus.PROCESSING,
          idempotencyKey: idempotencyKey || null,
        },
      });

      // Fetch all VALID staged rows
      const validRows = await tx.customerImportRow.findMany({
        where: { importId, status: ImportRowStatus.VALID },
        orderBy: { rowNumber: 'asc' },
      });

      if (validRows.length === 0) {
        await tx.customerImport.update({
          where: { id: importId },
          data: {
            status: ImportStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
        return {
          importId,
          status: ImportStatus.COMPLETED,
          importedCount: 0,
        };
      }

      // Check against current active customers once more to prevent duplicate creation
      // in case a customer was manually added while preview was awaiting confirmation
      const existing = await tx.customer.findMany({
        where: { businessId, deletedAt: null },
        select: { normalizedPhone: true },
      });
      const activePhoneSet = new Set(existing.map((c) => c.normalizedPhone));

      const source =
        record.importType === ImportType.IMAGE
          ? CustomerSource.IMAGE
          : record.importType === ImportType.CSV
            ? CustomerSource.CSV
            : CustomerSource.EXCEL;

      let insertedCount = 0;

      for (const row of validRows) {
        if (!row.normalizedPhone || !row.normalizedName) continue;
        if (activePhoneSet.has(row.normalizedPhone)) continue;

        const customer = await tx.customer.create({
          data: {
            businessId,
            name: row.normalizedName,
            rawPhone: row.rawPhone || row.normalizedPhone,
            normalizedPhone: row.normalizedPhone,
            email: row.normalizedEmail,
            gender: row.normalizedGender,
            dob: row.normalizedDob,
            address: row.normalizedAddress,
            city: row.normalizedCity,
            source,
            importId,
          },
        });

        // Default marketing consent is FALSE per directive
        await tx.customerCommunicationPreferences.create({
          data: {
            customerId: customer.id,
            whatsappMarketing: false,
            voiceMarketing: false,
            emailMarketing: false,
            doNotContact: false,
            consentSource: 'IMPORT_DEFAULT_NO_CONSENT',
            consentTimestamp: new Date(),
          },
        });

        activePhoneSet.add(row.normalizedPhone);
        insertedCount++;
      }

      // Update import status to COMPLETED
      await tx.customerImport.update({
        where: { id: importId },
        data: {
          status: ImportStatus.COMPLETED,
          validRows: insertedCount,
          completedAt: new Date(),
        },
      });

      return {
        importId,
        status: ImportStatus.COMPLETED,
        importedCount: insertedCount,
      };
    });
  }

  // --- Parsing Helpers ---

  private parseCsvBuffer(buffer: Buffer): RawRowData[] {
    const content = buffer.toString('utf-8');
    const records: any[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((rec) => this.mapHeadersToRowData(rec));
  }

  private parseExcelBuffer(buffer: Buffer): RawRowData[] {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return [];

    const sheet = workbook.Sheets[firstSheetName];
    const jsonRows: any[] = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    return jsonRows.map((rec) => this.mapHeadersToRowData(rec));
  }

  private mapHeadersToRowData(row: Record<string, any>): RawRowData {
    const out: RawRowData = {};

    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const valStr = String(value ?? '').trim();

      if (
        normalizedKey.includes('name') ||
        normalizedKey === 'customer' ||
        normalizedKey === 'client'
      ) {
        if (!out.name) out.name = valStr;
      } else if (
        normalizedKey.includes('phone') ||
        normalizedKey.includes('mobile') ||
        normalizedKey.includes('contact') ||
        normalizedKey === 'cell' ||
        normalizedKey === 'whatsapp'
      ) {
        if (!out.phone) out.phone = valStr;
      } else if (normalizedKey.includes('email') || normalizedKey === 'mail') {
        if (!out.email) out.email = valStr;
      } else if (normalizedKey.includes('city') || normalizedKey === 'town') {
        if (!out.city) out.city = valStr;
      } else if (
        normalizedKey.includes('address') ||
        normalizedKey === 'street' ||
        normalizedKey === 'location'
      ) {
        if (!out.address) out.address = valStr;
      } else if (normalizedKey.includes('gender') || normalizedKey === 'sex') {
        if (!out.gender) out.gender = valStr;
      } else if (
        normalizedKey.includes('dob') ||
        normalizedKey.includes('birth')
      ) {
        if (!out.dob) out.dob = valStr;
      }
    }

    return out;
  }
}
