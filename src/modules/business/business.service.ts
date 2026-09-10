import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FileCategory } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PhoneNormalizer } from '../../common/utils/phone-normalizer.util';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { UpsertBusinessHoursDto } from './dto/business-hours.dto';
import { UpdateBusinessProfileDto } from './dto/business-profile.dto';

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Retrieves business profile, hours, and signed logo URL
   */
  async getProfile(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: {
        hours: {
          orderBy: { dayOfWeek: 'asc' },
        },
      },
    });

    if (!business) {
      throw new NotFoundException({
        errorCode: 'BUSINESS_NOT_FOUND',
        message: 'Business profile not found',
      });
    }

    let logoUrl: string | null = null;
    if (business.logoKey) {
      logoUrl = await this.storageService.getSignedDownloadUrl(business.logoKey);
    }

    return {
      ...business,
      logoUrl,
    };
  }

  /**
   * Updates business profile fields
   */
  async updateProfile(businessId: string, dto: UpdateBusinessProfileDto) {
    let normalizedPhone: string | undefined = undefined;
    if (dto.phone) {
      const phoneResult = PhoneNormalizer.normalize(dto.phone);
      if (!phoneResult.isValid || !phoneResult.normalized) {
        throw new BadRequestException({
          errorCode: 'INVALID_PHONE_NUMBER',
          message: phoneResult.error || 'Invalid business phone number format',
        });
      }
      normalizedPhone = phoneResult.normalized;
    }

    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: {
        name: dto.name,
        phone: normalizedPhone,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        country: dto.country,
        pincode: dto.pincode,
        email: dto.email,
        website: dto.website,
        instagram: dto.instagram,
        facebook: dto.facebook,
        description: dto.description,
      },
    });

    let logoUrl: string | null = null;
    if (updated.logoKey) {
      logoUrl = await this.storageService.getSignedDownloadUrl(updated.logoKey);
    }

    return {
      ...updated,
      logoUrl,
    };
  }

  /**
   * Uploads store logo to Cloudflare R2 and updates business logoKey
   */
  async uploadLogo(
    businessId: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException({
        errorCode: 'INVALID_FILE',
        message: 'Logo file is required',
      });
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException({
        errorCode: 'INVALID_FILE_TYPE',
        message: 'Logo must be a JPEG, PNG, or WebP image',
      });
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new BadRequestException({
        errorCode: 'FILE_TOO_LARGE',
        message: 'Logo file must not exceed 5MB',
      });
    }

    const extension = file.originalname.split('.').pop() || 'png';
    const storageKey = `businesses/${businessId}/logo/${randomUUID()}.${extension}`;

    await this.storageService.uploadBuffer(
      storageKey,
      file.buffer,
      file.mimetype,
    );

    // Save FileUpload record & update Business.logoKey in a transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.fileUpload.create({
        data: {
          businessId,
          fileName: file.originalname,
          fileType: file.mimetype,
          storageKey,
          fileSize: file.size,
          category: FileCategory.LOGO,
          uploadedById: userId,
        },
      });

      await tx.business.update({
        where: { id: businessId },
        data: { logoKey: storageKey },
      });
    });

    const logoUrl =
      await this.storageService.getSignedDownloadUrl(storageKey);

    return {
      logoKey: storageKey,
      logoUrl,
    };
  }

  /**
   * Retrieves operating hours for the business
   */
  async getHours(businessId: string) {
    const hours = await this.prisma.businessHours.findMany({
      where: { businessId },
      orderBy: { dayOfWeek: 'asc' },
    });

    return hours;
  }

  /**
   * Upserts complete 7-day schedule with validation
   */
  async upsertHours(businessId: string, dto: UpsertBusinessHoursDto) {
    // Validate that all 7 days (0 to 6) are present
    const daysPresent = new Set(dto.hours.map((h) => h.dayOfWeek));
    for (let i = 0; i <= 6; i++) {
      if (!daysPresent.has(i)) {
        throw new BadRequestException({
          errorCode: 'INCOMPLETE_HOURS',
          message: `Schedule for dayOfWeek ${i} is missing`,
        });
      }
    }

    // Validate opening & closing times
    for (const h of dto.hours) {
      if (!h.isClosed) {
        if (!h.openTime || !h.closeTime) {
          throw new BadRequestException({
            errorCode: 'INVALID_HOURS',
            message: `Day ${h.dayOfWeek} is marked open but missing openTime or closeTime`,
          });
        }
        if (h.openTime >= h.closeTime) {
          throw new BadRequestException({
            errorCode: 'INVALID_HOURS',
            message: `Day ${h.dayOfWeek}: openTime (${h.openTime}) must be earlier than closeTime (${h.closeTime})`,
          });
        }
      }
    }

    // Upsert in transaction
    const upserted = await this.prisma.$transaction(async (tx) => {
      const results: Array<{
        id: string;
        businessId: string;
        dayOfWeek: number;
        openTime: string | null;
        closeTime: string | null;
        isClosed: boolean;
      }> = [];
      for (const h of dto.hours) {
        const row = await tx.businessHours.upsert({
          where: {
            businessId_dayOfWeek: {
              businessId,
              dayOfWeek: h.dayOfWeek,
            },
          },
          update: {
            openTime: h.isClosed ? null : h.openTime,
            closeTime: h.isClosed ? null : h.closeTime,
            isClosed: h.isClosed,
          },
          create: {
            businessId,
            dayOfWeek: h.dayOfWeek,
            openTime: h.isClosed ? null : h.openTime,
            closeTime: h.isClosed ? null : h.closeTime,
            isClosed: h.isClosed,
          },
        });
        results.push(row);
      }
      return results;
    });

    return upserted.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  }
}
