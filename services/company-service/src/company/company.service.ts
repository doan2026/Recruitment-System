import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Company,
  CompanyMedia,
  CompanyMediaType,
  CompanyMemberRole,
  CompanyVerificationStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { ApiException } from '../common/errors/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyProfileDto } from './dto/company-profile.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { PublicCompanyProfileDto } from './dto/public-company-profile.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

type CompanyWithMedia = Company & { media: CompanyMedia[] };

const COMPANY_WITH_MEDIA = {
  include: {
    media: {
      orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    },
  },
};

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    recruiterId: string,
    dto: CreateCompanyDto,
  ): Promise<CompanyProfileDto> {
    this.validateNoUnexpectedNulls(dto, new Set(['website']));
    this.validateMedia(dto.logo?.fileId, dto.media ?? []);

    const companyId = randomUUID();
    const name = this.cleanCompanyName(dto.name);
    const taxCode = this.normalizeTaxCode(dto.taxCode);

    try {
      const company = await this.prisma.$transaction(async (transaction) => {
        const existingMembership =
          await transaction.companyMember.findUnique({
            where: { userId: recruiterId },
            select: { companyId: true },
          });

        if (existingMembership) {
          throw new ApiException(
            'RECRUITER_ALREADY_HAS_COMPANY',
            'This recruiter already belongs to a company',
            HttpStatus.CONFLICT,
            { companyId: existingMembership.companyId },
          );
        }

        return transaction.company.create({
          data: {
            id: companyId,
            name,
            normalizedName: this.normalizeCompanyName(name),
            slug: this.createSlug(name, companyId),
            description: dto.description,
            industry: dto.industry,
            size: dto.size,
            address: dto.address,
            website: dto.website,
            taxCode,
            logoFileId: dto.logo?.fileId,
            logoUrl: dto.logo?.url,
            verifiedStatus: CompanyVerificationStatus.PENDING,
            members: {
              create: {
                userId: recruiterId,
                role: CompanyMemberRole.OWNER,
              },
            },
            media: dto.media?.length
              ? {
                  create: dto.media.map((item, index) => ({
                    fileId: item.fileId,
                    url: item.url,
                    type: item.type,
                    sortOrder: item.sortOrder ?? index,
                  })),
                }
              : undefined,
          },
          ...COMPANY_WITH_MEDIA,
        });
      });

      return this.toProfile(company);
    } catch (error) {
      this.throwPersistenceError(error);
    }
  }

  async getMine(recruiterId: string): Promise<CompanyProfileDto> {
    const membership = await this.prisma.companyMember.findUnique({
      where: { userId: recruiterId },
      include: {
        company: COMPANY_WITH_MEDIA,
      },
    });

    if (!membership) {
      throw new ApiException(
        'COMPANY_NOT_FOUND',
        'No company is associated with this recruiter',
        HttpStatus.NOT_FOUND,
      );
    }

    return this.toProfile(membership.company);
  }

  async getPublicById(companyId: string): Promise<PublicCompanyProfileDto> {
    const company = await this.prisma.company.findFirst({
      where: {
        id: companyId,
        verifiedStatus: CompanyVerificationStatus.VERIFIED,
      },
      ...COMPANY_WITH_MEDIA,
    });

    if (!company) {
      throw new ApiException(
        'COMPANY_NOT_FOUND',
        'Verified company was not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return this.toPublicProfile(company);
  }

  async update(
    recruiterId: string,
    companyId: string,
    dto: UpdateCompanyDto,
  ): Promise<CompanyProfileDto> {
    this.validateUpdate(dto);

    try {
      const company = await this.prisma.$transaction(
        async (transaction) => {
          const membership = await transaction.companyMember.findUnique({
            where: { userId: recruiterId },
            select: {
              companyId: true,
              role: true,
              company: {
                select: {
                  name: true,
                  taxCode: true,
                  logoFileId: true,
                  verifiedStatus: true,
                  media: {
                    select: {
                      fileId: true,
                      type: true,
                    },
                  },
                },
              },
            },
          });

          if (
            !membership ||
            membership.companyId !== companyId ||
            membership.role !== CompanyMemberRole.OWNER
          ) {
            throw new ApiException(
              'COMPANY_OWNER_REQUIRED',
              'Only the company owner can update this profile',
              HttpStatus.FORBIDDEN,
            );
          }

          const effectiveLogoFileId =
            dto.removeLogo === true
              ? undefined
              : (dto.logo?.fileId ?? membership.company.logoFileId);
          const effectiveMedia = dto.media ?? membership.company.media;
          this.validateMedia(effectiveLogoFileId, effectiveMedia);

          const data: Prisma.CompanyUpdateInput = {};
          const cleanedName =
            dto.name === undefined
              ? undefined
              : this.cleanCompanyName(dto.name);
          const normalizedTaxCode =
            dto.taxCode === undefined
              ? undefined
              : this.normalizeTaxCode(dto.taxCode);

          if (cleanedName !== undefined) {
            data.name = cleanedName;
            data.normalizedName = this.normalizeCompanyName(cleanedName);
            data.slug = this.createSlug(cleanedName, companyId);
          }
          if (dto.description !== undefined) {
            data.description = dto.description;
          }
          if (dto.industry !== undefined) {
            data.industry = dto.industry;
          }
          if (dto.size !== undefined) {
            data.size = dto.size;
          }
          if (dto.address !== undefined) {
            data.address = dto.address;
          }
          if (dto.website !== undefined) {
            data.website = dto.website;
          }
          if (normalizedTaxCode !== undefined) {
            data.taxCode = normalizedTaxCode;
          }
          if (dto.removeLogo === true) {
            data.logoFileId = null;
            data.logoUrl = null;
          } else if (dto.logo) {
            data.logoFileId = dto.logo.fileId;
            data.logoUrl = dto.logo.url;
          }
          if (dto.media !== undefined) {
            data.media = {
              deleteMany: {},
              create: dto.media.map((item, index) => ({
                fileId: item.fileId,
                url: item.url,
                type: item.type,
                sortOrder: item.sortOrder ?? index,
              })),
            };
          }

          const criticalFieldChanged =
            (cleanedName !== undefined &&
              cleanedName !== membership.company.name) ||
            (normalizedTaxCode !== undefined &&
              normalizedTaxCode !== membership.company.taxCode);

          if (
            criticalFieldChanged &&
            membership.company.verifiedStatus ===
              CompanyVerificationStatus.VERIFIED
          ) {
            data.verifiedStatus = CompanyVerificationStatus.PENDING;
            data.rejectReason = null;
          }

          return transaction.company.update({
            where: { id: companyId },
            data,
            ...COMPANY_WITH_MEDIA,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      return this.toProfile(company);
    } catch (error) {
      this.throwPersistenceError(error);
    }
  }

  private validateUpdate(dto: UpdateCompanyDto): void {
    this.validateNoUnexpectedNulls(dto, new Set(['website']));

    if (dto.logo && dto.removeLogo === true) {
      throw new ApiException(
        'INVALID_LOGO_UPDATE',
        'logo and removeLogo=true cannot be used together',
        HttpStatus.BAD_REQUEST,
      );
    }

    const hasEffectiveUpdate = Object.entries(dto).some(
      ([key, value]) =>
        value !== undefined && (key !== 'removeLogo' || value === true),
    );

    if (!hasEffectiveUpdate) {
      throw new ApiException(
        'EMPTY_UPDATE',
        'At least one company profile field must be provided',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private validateNoUnexpectedNulls(
    value: object,
    nullableFields: ReadonlySet<string>,
  ): void {
    const nullField = Object.entries(value).find(
      ([field, fieldValue]) =>
        fieldValue === null && !nullableFields.has(field),
    );

    if (nullField) {
      throw new ApiException(
        'NULL_FIELD_NOT_ALLOWED',
        nullField[0] + ' cannot be null',
        HttpStatus.BAD_REQUEST,
        { field: nullField[0] },
      );
    }
  }

  private validateMedia(
    logoFileId: string | null | undefined,
    media: ReadonlyArray<{ fileId: string; type: CompanyMediaType }>,
  ): void {
    const imageCount = media.filter(
      (item) => item.type === CompanyMediaType.IMAGE,
    ).length;
    const videoCount = media.filter(
      (item) => item.type === CompanyMediaType.VIDEO,
    ).length;

    if (imageCount > 10 || videoCount > 1) {
      throw new ApiException(
        'MEDIA_LIMIT_EXCEEDED',
        'A company can reference at most 10 images and 1 video',
        HttpStatus.BAD_REQUEST,
        { maxImages: 10, maxVideos: 1 },
      );
    }

    const fileIds = [
      ...(logoFileId ? [logoFileId] : []),
      ...media.map((item) => item.fileId),
    ];

    if (new Set(fileIds).size !== fileIds.length) {
      throw new ApiException(
        'DUPLICATE_MEDIA_REFERENCE',
        'Each fileId can only be referenced once in a company profile',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private cleanCompanyName(value: string): string {
    const cleaned = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (cleaned.length < 2 || cleaned.length > 160) {
      throw new ApiException(
        'VALIDATION_ERROR',
        'name must contain between 2 and 160 normalized characters',
        HttpStatus.BAD_REQUEST,
        { field: 'name' },
      );
    }

    return cleaned;
  }

  private normalizeCompanyName(value: string): string {
    return this.cleanCompanyName(value).toLocaleLowerCase('vi');
  }

  private normalizeTaxCode(value: string): string {
    const normalized = value.normalize('NFKC').trim().toUpperCase();
    if (normalized.length < 1 || normalized.length > 32) {
      throw new ApiException(
        'VALIDATION_ERROR',
        'taxCode must contain between 1 and 32 normalized characters',
        HttpStatus.BAD_REQUEST,
        { field: 'taxCode' },
      );
    }

    return normalized;
  }

  private createSlug(name: string, companyId: string): string {
    const base =
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 157) || 'company';

    return base + '-' + companyId.replace(/-/g, '');
  }

  private toPublicProfile(
    company: CompanyWithMedia,
  ): PublicCompanyProfileDto {
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      description: company.description,
      industry: company.industry,
      size: company.size,
      address: company.address,
      website: company.website,
      taxCode: company.taxCode,
      logoUrl: company.logoUrl,
      media: company.media.map((item) => ({
        url: item.url,
        type: item.type,
        sortOrder: item.sortOrder,
      })),
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
    };
  }

  private toProfile(company: CompanyWithMedia): CompanyProfileDto {
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      description: company.description,
      industry: company.industry,
      size: company.size,
      address: company.address,
      website: company.website,
      taxCode: company.taxCode,
      logo:
        company.logoFileId && company.logoUrl
          ? {
              fileId: company.logoFileId,
              url: company.logoUrl,
            }
          : null,
      media: company.media.map((item) => ({
        fileId: item.fileId,
        url: item.url,
        type: item.type,
        sortOrder: item.sortOrder,
      })),
      verifiedStatus: company.verifiedStatus,
      rejectReason: company.rejectReason,
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
    };
  }

  private throwPersistenceError(error: unknown): never {
    if (error instanceof ApiException) {
      throw error;
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    ) {
      throw new ApiException(
        'COMPANY_UPDATE_CONFLICT',
        'The company changed concurrently; retry the request',
        HttpStatus.CONFLICT,
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new ApiException(
        'COMPANY_NOT_FOUND',
        'Company was not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = String(error.meta?.target ?? '')
        .replace(/_/g, '')
        .toLowerCase();

      if (target.includes('normalizedname')) {
        throw new ApiException(
          'COMPANY_NAME_ALREADY_EXISTS',
          'A company with this name already exists',
          HttpStatus.CONFLICT,
        );
      }
      if (target.includes('taxcode')) {
        throw new ApiException(
          'COMPANY_TAX_CODE_ALREADY_EXISTS',
          'A company with this tax code already exists',
          HttpStatus.CONFLICT,
        );
      }
      if (target.includes('userid')) {
        throw new ApiException(
          'RECRUITER_ALREADY_HAS_COMPANY',
          'This recruiter already belongs to a company',
          HttpStatus.CONFLICT,
        );
      }
      if (target.includes('fileid')) {
        throw new ApiException(
          'MEDIA_ALREADY_REFERENCED',
          'A media file is already linked to another company',
          HttpStatus.CONFLICT,
        );
      }

      throw new ApiException(
        'COMPANY_CONFLICT',
        'Company data conflicts with an existing record',
        HttpStatus.CONFLICT,
      );
    }

    throw error;
  }
}
