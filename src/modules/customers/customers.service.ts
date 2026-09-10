import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CustomerSource, Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';
import { PrismaService } from '../../database/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new customer for the business with phone normalization and duplicate prevention
   */
  async create(businessId: string, dto: CreateCustomerDto) {
    const phoneResult = PhoneNormalizer.normalize(dto.phone);
    if (!phoneResult.isValid || !phoneResult.normalized) {
      throw new BadRequestException({
        errorCode: 'INVALID_PHONE_NUMBER',
        message: phoneResult.error || 'Invalid customer phone number format',
      });
    }

    const canonicalPhone = phoneResult.normalized;

    // Check for existing active customer in this business
    const existingActive = await this.prisma.customer.findFirst({
      where: {
        businessId,
        normalizedPhone: canonicalPhone,
        deletedAt: null,
      },
    });

    if (existingActive) {
      throw new ConflictException({
        errorCode: 'DUPLICATE_CUSTOMER',
        message: `Customer with mobile number ${canonicalPhone} already exists in your store`,
      });
    }

    // Check if previously soft-deleted customer exists to restore
    const previouslyDeleted = await this.prisma.customer.findFirst({
      where: {
        businessId,
        normalizedPhone: canonicalPhone,
        deletedAt: { not: null },
      },
    });

    const parsedDob = dto.dob ? new Date(dto.dob) : null;

    if (previouslyDeleted) {
      // Restore customer record
      return this.prisma.$transaction(async (tx) => {
        const restored = await tx.customer.update({
          where: { id: previouslyDeleted.id },
          data: {
            name: dto.name,
            rawPhone: dto.phone,
            normalizedPhone: canonicalPhone,
            email: dto.email,
            gender: dto.gender,
            dob: parsedDob,
            address: dto.address,
            city: dto.city,
            source: CustomerSource.MANUAL,
            deletedAt: null,
          },
          include: { preferences: true },
        });

        await tx.customerCommunicationPreferences.upsert({
          where: { customerId: restored.id },
          update: {
            whatsappMarketing: dto.preferences?.whatsappMarketing ?? false,
            voiceMarketing: dto.preferences?.voiceMarketing ?? false,
            emailMarketing: dto.preferences?.emailMarketing ?? false,
            doNotContact: dto.preferences?.doNotContact ?? false,
            consentSource: 'MANUAL_RESTORE',
            consentTimestamp: new Date(),
          },
          create: {
            customerId: restored.id,
            whatsappMarketing: dto.preferences?.whatsappMarketing ?? false,
            voiceMarketing: dto.preferences?.voiceMarketing ?? false,
            emailMarketing: dto.preferences?.emailMarketing ?? false,
            doNotContact: dto.preferences?.doNotContact ?? false,
            consentSource: 'MANUAL_RESTORE',
            consentTimestamp: new Date(),
          },
        });

        return tx.customer.findUnique({
          where: { id: restored.id },
          include: { preferences: true },
        });
      });
    }

    // Standard creation in transaction
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          businessId,
          name: dto.name,
          rawPhone: dto.phone,
          normalizedPhone: canonicalPhone,
          email: dto.email,
          gender: dto.gender,
          dob: parsedDob,
          address: dto.address,
          city: dto.city,
          source: CustomerSource.MANUAL,
        },
      });

      await tx.customerCommunicationPreferences.create({
        data: {
          customerId: customer.id,
          whatsappMarketing: dto.preferences?.whatsappMarketing ?? false,
          voiceMarketing: dto.preferences?.voiceMarketing ?? false,
          emailMarketing: dto.preferences?.emailMarketing ?? false,
          doNotContact: dto.preferences?.doNotContact ?? false,
          consentSource: 'MANUAL_ENTRY',
          consentTimestamp: new Date(),
        },
      });

      return tx.customer.findUnique({
        where: { id: customer.id },
        include: { preferences: true },
      });
    });
  }

  /**
   * Retrieves paginated customers for a business with search and filtering
   */
  async findAll(
    businessId: string,
    query: CustomerQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      businessId,
      deletedAt: null,
    };

    if (query.gender) {
      where.gender = query.gender;
    }

    if (query.source) {
      where.source = query.source;
    }

    if (query.doNotContact !== undefined) {
      where.preferences = {
        doNotContact: query.doNotContact,
      };
    }

    if (query.search && query.search.trim()) {
      const searchTerm = query.search.trim();
      where.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { normalizedPhone: { contains: searchTerm } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
        { city: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const sortField = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [total, items] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        include: { preferences: true },
        skip,
        take: limit,
        orderBy: { [sortField]: sortOrder },
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
   * Retrieves a single customer by ID scoped to tenant
   */
  async findOne(businessId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: {
        id,
        businessId,
        deletedAt: null,
      },
      include: { preferences: true },
    });

    if (!customer) {
      throw new NotFoundException({
        errorCode: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found or has been removed',
      });
    }

    return customer;
  }

  /**
   * Updates an existing customer's details & communication preferences
   */
  async update(businessId: string, id: string, dto: UpdateCustomerDto) {
    const customer = await this.findOne(businessId, id);

    let normalizedPhone: string | undefined = undefined;
    if (dto.phone && dto.phone !== customer.rawPhone) {
      const phoneResult = PhoneNormalizer.normalize(dto.phone);
      if (!phoneResult.isValid || !phoneResult.normalized) {
        throw new BadRequestException({
          errorCode: 'INVALID_PHONE_NUMBER',
          message: phoneResult.error || 'Invalid phone number',
        });
      }

      normalizedPhone = phoneResult.normalized;

      // Check duplicate phone in business
      const duplicate = await this.prisma.customer.findFirst({
        where: {
          businessId,
          normalizedPhone,
          deletedAt: null,
          id: { not: id },
        },
      });

      if (duplicate) {
        throw new ConflictException({
          errorCode: 'DUPLICATE_CUSTOMER',
          message: `Another customer with phone ${normalizedPhone} already exists`,
        });
      }
    }

    const parsedDob = dto.dob !== undefined ? (dto.dob ? new Date(dto.dob) : null) : undefined;

    return this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: {
          name: dto.name,
          rawPhone: dto.phone,
          normalizedPhone,
          email: dto.email,
          gender: dto.gender,
          dob: parsedDob,
          address: dto.address,
          city: dto.city,
        },
      });

      if (dto.preferences) {
        await tx.customerCommunicationPreferences.upsert({
          where: { customerId: id },
          update: {
            whatsappMarketing: dto.preferences.whatsappMarketing,
            voiceMarketing: dto.preferences.voiceMarketing,
            emailMarketing: dto.preferences.emailMarketing,
            doNotContact: dto.preferences.doNotContact,
            consentSource: 'MANUAL_UPDATE',
            consentTimestamp: new Date(),
          },
          create: {
            customerId: id,
            whatsappMarketing: dto.preferences.whatsappMarketing ?? false,
            voiceMarketing: dto.preferences.voiceMarketing ?? false,
            emailMarketing: dto.preferences.emailMarketing ?? false,
            doNotContact: dto.preferences.doNotContact ?? false,
            consentSource: 'MANUAL_UPDATE',
            consentTimestamp: new Date(),
          },
        });
      }

      return tx.customer.findUnique({
        where: { id },
        include: { preferences: true },
      });
    });
  }

  /**
   * Soft-deletes a customer by setting deletedAt
   */
  async softDelete(businessId: string, id: string) {
    await this.findOne(businessId, id);

    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return {
      success: true,
      message: 'Customer soft-deleted successfully',
    };
  }
}
