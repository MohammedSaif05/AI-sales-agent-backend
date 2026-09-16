import { Injectable, NotFoundException } from '@nestjs/common';
import { ImportStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../database/prisma.service';
import { BusinessAnalystService } from '../business-analyst/business-analyst.service';
import {
  AnalysisQueryDto,
  QuestionQueryDto,
} from '../business-analyst/dto/analysis-query.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analystService: BusinessAnalystService,
  ) {}

  /**
   * Platform-wide dashboard summary metrics for Super Admin
   */
  async getDashboardStats() {
    const [
      totalBusinesses,
      totalUsers,
      totalCustomers,
      totalImports,
      completedImports,
      failedImports,
      totalFiles,
    ] = await Promise.all([
      this.prisma.business.count(),
      this.prisma.user.count(),
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.customerImport.count(),
      this.prisma.customerImport.count({
        where: { status: ImportStatus.COMPLETED },
      }),
      this.prisma.customerImport.count({
        where: { status: ImportStatus.FAILED },
      }),
      this.prisma.fileUpload.count(),
    ]);

    return {
      totalBusinesses,
      totalUsers,
      totalCustomers,
      totalImports,
      completedImports,
      failedImports,
      totalFiles,
    };
  }

  /**
   * Paginated directory of all businesses with owner details & customer counts
   */
  async getBusinesses(query: PaginationQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        { city: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [total, businesses] = await Promise.all([
      this.prisma.business.count({ where }),
      this.prisma.business.findMany({
        where,
        include: {
          businessUsers: {
            include: {
              user: {
                select: { id: true, name: true, phone: true, systemRole: true },
              },
            },
          },
          _count: {
            select: {
              customers: true,
              imports: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: businesses.map((b) => ({
        id: b.id,
        name: b.name,
        phone: b.phone,
        city: b.city,
        state: b.state,
        country: b.country,
        pincode: b.pincode,
        email: b.email,
        createdAt: b.createdAt,
        owner: b.businessUsers.find((bu) => bu.role === 'OWNER')?.user || null,
        stats: {
          customerCount: b._count.customers,
          importCount: b._count.imports,
        },
      })),
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
   * Deep inspection of a single business
   */
  async getBusinessDetail(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: {
        businessUsers: {
          include: {
            user: {
              select: { id: true, name: true, phone: true, systemRole: true },
            },
          },
        },
        hours: {
          orderBy: { dayOfWeek: 'asc' },
        },
        _count: {
          select: {
            customers: true,
            imports: true,
            fileUploads: true,
          },
        },
      },
    });

    if (!business) {
      throw new NotFoundException({
        errorCode: 'BUSINESS_NOT_FOUND',
        message: 'Business not found',
      });
    }

    return business;
  }

  /**
   * Cross-tenant customer inspection for a specific business
   */
  async getBusinessCustomers(businessId: string, query: PaginationQueryDto) {
    await this.getBusinessDetail(businessId);

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { businessId };
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { normalizedPhone: { contains: term } },
        { email: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        include: { preferences: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
   * Global import audit log across all businesses
   */
  async getGlobalImports(query: PaginationQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.customerImport.count(),
      this.prisma.customerImport.findMany({
        include: {
          business: {
            select: { id: true, name: true, phone: true },
          },
          createdBy: {
            select: { id: true, name: true, phone: true },
          },
          file: {
            select: { fileName: true, fileSize: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
   * Deep inspection of any import job across tenants
   */
  async getImportDetail(importId: string) {
    const record = await this.prisma.customerImport.findUnique({
      where: { id: importId },
      include: {
        business: true,
        createdBy: {
          select: { id: true, name: true, phone: true },
        },
        file: true,
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
   * Super Admin inspection of latest business analyst summary for a store
   */
  async getBusinessAnalystSummary(businessId: string) {
    await this.getBusinessDetail(businessId);
    return this.analystService.getLatestSummary(businessId);
  }

  /**
   * Super Admin inspection of business analysis reports history for a store
   */
  async getBusinessAnalyses(businessId: string, query: AnalysisQueryDto) {
    await this.getBusinessDetail(businessId);
    return this.analystService.getAnalysisHistory(businessId, query);
  }

  /**
   * Super Admin deep inspection of a specific analysis record for a store
   */
  async getBusinessAnalysisDetail(businessId: string, analysisId: string) {
    await this.getBusinessDetail(businessId);
    return this.analystService.getAnalysis(businessId, analysisId);
  }

  /**
   * Super Admin inspection of question history for a store
   */
  async getBusinessQuestions(businessId: string, query: QuestionQueryDto) {
    await this.getBusinessDetail(businessId);
    return this.analystService.getQuestionHistory(businessId, query);
  }
}

