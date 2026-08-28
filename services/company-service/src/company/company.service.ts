import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Company,
  CompanyAuditAction,
  CompanyMediaAssetType as PrismaCompanyMediaAssetType,
  CompanyMediaOperationKind,
  CompanyMedia,
  CompanyMediaUploadIntent,
  CompanyMediaType,
  CompanyMemberRole,
  CompanyVerificationStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { ApiException } from '../common/errors/api-exception';
import {
  ApiSuccessResponse,
  apiSuccess,
} from '../common/http/api-response.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import {
  CompanyFileReference,
  CompanyMediaAssetType,
  CompanyMediaClient,
  VerifiedCompanyFile,
} from '../media/company-media.client';
import { CompanyMediaOperationService } from '../media/company-media-operation.service';
import { CompanyProfileDto } from './dto/company-profile.dto';
import {
  CompanyMediaUploadCapabilityDto,
  CompanyMediaUploadResultDto,
  ConfirmCompanyMediaUploadDto,
  CreateCompanyMediaUploadDto,
} from './dto/company-media-upload.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { ListCompaniesQueryDto } from './dto/list-companies-query.dto';
import { PublicCompanyProfileDto } from './dto/public-company-profile.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import {
  CompanyVerificationDecision,
  VerifyCompanyDto,
} from './dto/verify-company.dto';

type CompanyWithMedia = Company & { media: CompanyMedia[] };

interface PlannedLogo {
  fileId: string;
  url?: string;
  mediaReferenceId?: string;
}

interface PlannedGalleryItem {
  id: string;
  fileId: string;
  type: CompanyMediaType;
  sortOrder: number;
  url?: string;
  mediaReferenceId?: string;
}

interface PendingAttachment {
  operationId: string;
  fileId: string;
  assetType: CompanyMediaAssetType;
  referenceType: string;
  referenceId: string;
  localMediaId: string | null;
  apply: (
    verified: VerifiedCompanyFile,
    reference: CompanyFileReference,
  ) => void;
}

interface MediaMutationPlan {
  logo: PlannedLogo | null | undefined;
  gallery: PlannedGalleryItem[] | undefined;
  attachments: PendingAttachment[];
  detachments: Array<{
    id: string;
    companyId: string;
    fileId: string;
    assetType: CompanyMediaAssetType;
    referenceType: string;
    referenceId: string;
    localMediaId: string | null;
    mediaReferenceId: string;
  }>;
}

interface ForegroundAttachmentLease {
  token: string;
}

const COMPANY_WITH_MEDIA = {
  include: {
    media: {
      orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    },
  },
};

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: CompanyMediaClient,
    private readonly mediaOperations: CompanyMediaOperationService,
  ) {}

  async create(
    recruiterId: string,
    dto: CreateCompanyDto,
  ): Promise<CompanyProfileDto> {
    this.validateNoUnexpectedNulls(dto, new Set(['website']));
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
            verifiedStatus: CompanyVerificationStatus.PENDING,
            members: {
              create: {
                userId: recruiterId,
                role: CompanyMemberRole.OWNER,
              },
            },
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

  async listForReview(
    query: ListCompaniesQueryDto,
  ): Promise<ApiSuccessResponse<CompanyProfileDto[]>> {
    const where: Prisma.CompanyWhereInput = {
      verifiedStatus: query.verified_status,
    };
    const skip = (query.page - 1) * query.limit;

    const [companies, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...COMPANY_WITH_MEDIA,
      }),
      this.prisma.company.count({ where }),
    ]);

    return apiSuccess(
      companies.map((company) => this.toProfile(company)),
      {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    );
  }

  async verify(
    adminId: string,
    companyId: string,
    dto: VerifyCompanyDto,
  ): Promise<CompanyProfileDto> {
    const reason = dto.reason?.trim();

    if (
      dto.decision === CompanyVerificationDecision.REJECT &&
      !reason
    ) {
      throw new ApiException(
        'VERIFICATION_REASON_REQUIRED',
        'A rejection reason is required',
        HttpStatus.BAD_REQUEST,
        { field: 'reason' },
      );
    }

    if (
      dto.decision === CompanyVerificationDecision.APPROVE &&
      reason !== undefined
    ) {
      throw new ApiException(
        'VERIFICATION_REASON_NOT_ALLOWED',
        'reason must be omitted when approving a company',
        HttpStatus.BAD_REQUEST,
        { field: 'reason' },
      );
    }

    const targetStatus =
      dto.decision === CompanyVerificationDecision.APPROVE
        ? CompanyVerificationStatus.VERIFIED
        : CompanyVerificationStatus.REJECTED;

    try {
      const company = await this.prisma.$transaction(
        async (transaction) => {
          const current = await transaction.company.findUnique({
            where: { id: companyId },
            ...COMPANY_WITH_MEDIA,
          });

          if (!current) {
            throw new ApiException(
              'COMPANY_NOT_FOUND',
              'Company was not found',
              HttpStatus.NOT_FOUND,
            );
          }

          const isIdempotentDecision =
            current.verifiedStatus === targetStatus &&
            (targetStatus === CompanyVerificationStatus.VERIFIED ||
              current.rejectReason === reason);

          if (isIdempotentDecision) {
            return current;
          }

          if (
            current.verifiedStatus !== CompanyVerificationStatus.PENDING
          ) {
            throw new ApiException(
              'INVALID_VERIFICATION_TRANSITION',
              'Only a PENDING company can be reviewed',
              HttpStatus.CONFLICT,
              {
                currentStatus: current.verifiedStatus,
                requestedStatus: targetStatus,
              },
            );
          }

          const updated = await transaction.company.update({
            where: { id: companyId },
            data: {
              verifiedStatus: targetStatus,
              rejectReason:
                targetStatus === CompanyVerificationStatus.REJECTED
                  ? reason
                  : null,
              aggregateVersion: { increment: 1 },
            },
            ...COMPANY_WITH_MEDIA,
          });

          await transaction.companyAuditLog.create({
            data: {
              companyId,
              action:
                targetStatus === CompanyVerificationStatus.VERIFIED
                  ? CompanyAuditAction.VERIFICATION_APPROVED
                  : CompanyAuditAction.VERIFICATION_REJECTED,
              actorId: adminId,
              targetUserId: null,
              resultingAggregateVersion: updated.aggregateVersion,
              fromVerificationStatus: current.verifiedStatus,
              toVerificationStatus: targetStatus,
              reason:
                targetStatus === CompanyVerificationStatus.REJECTED
                  ? reason
                  : null,
            },
          });

          return updated;
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

  async resubmit(recruiterId: string): Promise<CompanyProfileDto> {
    try {
      const company = await this.prisma.$transaction(
        async (transaction) => {
          const membership = await transaction.companyMember.findUnique({
            where: { userId: recruiterId },
            include: {
              company: COMPANY_WITH_MEDIA,
            },
          });

          if (!membership || membership.role !== CompanyMemberRole.OWNER) {
            throw new ApiException(
              'COMPANY_OWNER_REQUIRED',
              'Only the company owner can submit this profile for review',
              HttpStatus.FORBIDDEN,
            );
          }

          if (
            membership.company.verifiedStatus ===
            CompanyVerificationStatus.PENDING
          ) {
            return membership.company;
          }

          if (
            membership.company.verifiedStatus !==
            CompanyVerificationStatus.REJECTED
          ) {
            throw new ApiException(
              'INVALID_RESUBMISSION_TRANSITION',
              'Only a REJECTED company can be resubmitted',
              HttpStatus.CONFLICT,
              { currentStatus: membership.company.verifiedStatus },
            );
          }

          return transaction.company.update({
            where: { id: membership.companyId },
            data: {
              verifiedStatus: CompanyVerificationStatus.PENDING,
              rejectReason: null,
              aggregateVersion: { increment: 1 },
            },
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

  async createMediaUploadIntent(
    recruiterId: string,
    companyId: string,
    dto: CreateCompanyMediaUploadDto,
    idempotencyKey?: string,
  ): Promise<CompanyMediaUploadCapabilityDto> {
    const company = await this.requireOwner(recruiterId, companyId);
    const capability = await this.media.createCompanyUploadIntent(
      company.id,
      recruiterId,
      dto.type,
      dto.originalFilename,
      idempotencyKey,
    );
    const expiresAt = new Date(capability.expiresAt);
    const cleanupAt = this.mediaOperations.uploadIntentCleanupAt(expiresAt);

    try {
      await this.prisma.$transaction(async (transaction) => {
        const stored = await transaction.companyMediaUploadIntent.upsert({
          where: { fileId: capability.fileId },
          create: {
            fileId: capability.fileId,
            companyId: company.id,
            requestedBy: recruiterId.toLowerCase(),
            assetType:
              dto.type as unknown as PrismaCompanyMediaAssetType,
            expiresAt,
            cleanupAt,
          },
          update: {},
        });
        if (
          !this.matchesUploadIntent(stored, company.id, recruiterId, dto) ||
          stored.expiresAt.getTime() !== expiresAt.getTime()
        ) {
          throw new ApiException(
            'COMPANY_MEDIA_UPLOAD_INTENT_CONFLICT',
            'The Media upload intent conflicts with an existing Company intent',
            HttpStatus.CONFLICT,
          );
        }

        const cleanup = await transaction.companyMediaOperation.upsert({
          where: { id: capability.fileId },
          create: {
            id: capability.fileId,
            kind: CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP,
            companyId: company.id,
            fileId: capability.fileId,
            assetType:
              dto.type as unknown as PrismaCompanyMediaAssetType,
            referenceType: 'COMPANY_UPLOAD_INTENT',
            referenceId: capability.fileId,
            localMediaId: null,
            mediaReferenceId: null,
            nextAttemptAt: stored.cleanupAt,
          },
          update: {},
        });
        if (
          cleanup.kind !==
            CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP ||
          cleanup.companyId !== company.id ||
          cleanup.fileId !== capability.fileId ||
          cleanup.assetType !==
            (dto.type as unknown as PrismaCompanyMediaAssetType) ||
          cleanup.referenceType !== 'COMPANY_UPLOAD_INTENT' ||
          cleanup.referenceId !== capability.fileId ||
          cleanup.localMediaId !== null ||
          cleanup.mediaReferenceId !== null ||
          cleanup.nextAttemptAt.getTime() !== stored.cleanupAt.getTime()
        ) {
          throw new ApiException(
            'COMPANY_MEDIA_UPLOAD_INTENT_CONFLICT',
            'The Media upload intent conflicts with an existing cleanup operation',
            HttpStatus.CONFLICT,
          );
        }
      });
      return capability;
    } catch (error) {
      this.throwPersistenceError(error);
    }
  }

  async confirmMediaUpload(
    recruiterId: string,
    companyId: string,
    dto: ConfirmCompanyMediaUploadDto,
  ): Promise<CompanyMediaUploadResultDto> {
    const company = await this.requireOwner(recruiterId, companyId);
    const intent = await this.prisma.companyMediaUploadIntent.findUnique({
      where: { fileId: dto.fileId },
    });
    if (
      !intent ||
      !this.matchesUploadIntent(intent, company.id, recruiterId, dto) ||
      intent.cleanupAt.getTime() <= Date.now()
    ) {
      throw this.invalidUploadIntent();
    }
    if (intent.confirmedAt && intent.canonicalUrl) {
      return {
        fileId: intent.fileId,
        type: dto.type,
        url: intent.canonicalUrl,
      };
    }
    if (intent.expiresAt.getTime() <= Date.now()) {
      throw this.invalidUploadIntent();
    }

    const file = await this.media.confirmCompanyFile(
      dto.fileId,
      company.id,
      dto.type,
    );
    const result = {
      fileId: file.id,
      type: file.type,
      url: file.url,
    };
    const confirmed = await this.prisma.companyMediaUploadIntent.updateMany({
      where: {
        fileId: intent.fileId,
        companyId: company.id,
        requestedBy: recruiterId.toLowerCase(),
        assetType:
          dto.type as unknown as PrismaCompanyMediaAssetType,
        confirmedAt: null,
        expiresAt: { gt: new Date() },
        cleanupAt: { gt: new Date() },
      },
      data: {
        confirmedAt: new Date(),
        canonicalUrl: file.url,
      },
    });
    if (confirmed.count === 1) {
      return result;
    }

    const concurrent = await this.prisma.companyMediaUploadIntent.findUnique({
      where: { fileId: intent.fileId },
    });
    if (
      concurrent &&
      this.matchesUploadIntent(concurrent, company.id, recruiterId, dto) &&
      concurrent.cleanupAt.getTime() > Date.now() &&
      concurrent.confirmedAt &&
      concurrent.canonicalUrl
    ) {
      return {
        fileId: concurrent.fileId,
        type: dto.type,
        url: concurrent.canonicalUrl,
      };
    }
    throw new ApiException(
      'COMPANY_MEDIA_UPLOAD_CONFIRM_CONFLICT',
      'The upload confirmation changed concurrently; retry the request',
      HttpStatus.CONFLICT,
    );
  }

  private matchesUploadIntent(
    intent: CompanyMediaUploadIntent,
    companyId: string,
    recruiterId: string,
    dto: { type: CompanyMediaAssetType },
  ): boolean {
    return (
      intent.companyId === companyId &&
      intent.requestedBy === recruiterId.toLowerCase() &&
      intent.assetType ===
        (dto.type as unknown as PrismaCompanyMediaAssetType)
    );
  }

  private invalidUploadIntent(): ApiException {
    return new ApiException(
      'COMPANY_MEDIA_UPLOAD_INTENT_INVALID',
      'No valid Company upload intent matches this file confirmation',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  async update(
    recruiterId: string,
    companyId: string,
    dto: UpdateCompanyDto,
  ): Promise<CompanyProfileDto> {
    this.validateUpdate(dto);

    const baseline = await this.requireOwner(recruiterId, companyId);
    const targetCompanyId = baseline.id;
    const mediaPlan = this.planMediaMutation(targetCompanyId, baseline, dto);
    const attachmentLease: ForegroundAttachmentLease = {
      token: randomUUID(),
    };
    const effectiveLogoFileId =
      mediaPlan.logo === undefined
        ? baseline.logoFileId
        : (mediaPlan.logo?.fileId ?? undefined);
    const effectiveMedia = mediaPlan.gallery ?? baseline.media;
    this.validateMedia(effectiveLogoFileId, effectiveMedia);

    await this.stageAttachmentOperations(
      targetCompanyId,
      mediaPlan.attachments,
      attachmentLease,
    );
    try {
      await this.resolveAttachments(
        targetCompanyId,
        mediaPlan.attachments,
        attachmentLease,
      );
      this.assertMediaPlanResolved(mediaPlan);
    } catch (error) {
      await this.markAttachmentsDue(mediaPlan.attachments, attachmentLease);
      this.mediaOperations.kick();
      throw error;
    }

    try {
      const company = await this.prisma.$transaction(
        async (transaction) => {
          const membership = await transaction.companyMember.findUnique({
            where: { userId: recruiterId },
            include: {
              company: COMPANY_WITH_MEDIA,
            },
          });

          if (
            !membership ||
            membership.companyId !== targetCompanyId ||
            membership.role !== CompanyMemberRole.OWNER
          ) {
            throw new ApiException(
              'COMPANY_OWNER_REQUIRED',
              'Only the company owner can update this profile',
              HttpStatus.FORBIDDEN,
            );
          }

          if (
            membership.company.aggregateVersion !==
            baseline.aggregateVersion
          ) {
            throw new ApiException(
              'COMPANY_UPDATE_CONFLICT',
              'The company changed concurrently; retry the request',
              HttpStatus.CONFLICT,
            );
          }

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
            data.slug = this.createSlug(cleanedName, targetCompanyId);
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
          if (mediaPlan.logo !== undefined) {
            data.logoFileId = mediaPlan.logo?.fileId ?? null;
            data.logoUrl = mediaPlan.logo?.url ?? null;
            data.logoMediaReferenceId =
              mediaPlan.logo?.mediaReferenceId ?? null;
          }
          if (mediaPlan.gallery !== undefined) {
            data.media = {
              deleteMany: {},
              create: mediaPlan.gallery.map((item) => ({
                id: item.id,
                fileId: item.fileId,
                mediaReferenceId: item.mediaReferenceId!,
                url: item.url!,
                type: item.type,
                sortOrder: item.sortOrder,
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

          data.aggregateVersion = { increment: 1 };

          if (mediaPlan.detachments.length > 0) {
            await transaction.companyMediaOperation.createMany({
              data: mediaPlan.detachments.map((operation) => ({
                ...operation,
                assetType:
                  operation.assetType as unknown as PrismaCompanyMediaAssetType,
                kind: CompanyMediaOperationKind.DETACH_CLEANUP,
              })),
            });
          }

          const updated = await transaction.company.update({
            where: { id: targetCompanyId },
            data,
            ...COMPANY_WITH_MEDIA,
          });

          if (mediaPlan.attachments.length > 0) {
            const attachedFileIds = mediaPlan.attachments.map(
              (attachment) => attachment.fileId,
            );
            await transaction.companyMediaUploadIntent.deleteMany({
              where: {
                fileId: { in: attachedFileIds },
                companyId: targetCompanyId,
              },
            });
            await transaction.companyMediaOperation.deleteMany({
              where: {
                id: { in: attachedFileIds },
                companyId: targetCompanyId,
                kind: CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP,
              },
            });

            const completedAttachments =
              await transaction.companyMediaOperation.deleteMany({
                where: {
                  id: {
                    in: mediaPlan.attachments.map(
                      (attachment) => attachment.operationId,
                    ),
                  },
                  kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
                  leaseToken: attachmentLease.token,
                },
              });
            if (
              completedAttachments.count !== mediaPlan.attachments.length
            ) {
              throw this.mediaOperationConflict();
            }
          }

          return updated;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      this.mediaOperations.kick();
      return this.toProfile(company);
    } catch (error) {
      await this.markAttachmentsDue(mediaPlan.attachments, attachmentLease);
      this.mediaOperations.kick();
      this.throwPersistenceError(error);
    }
  }

  private async requireOwner(
    recruiterId: string,
    companyId: string,
  ): Promise<CompanyWithMedia> {
    const membership = await this.prisma.companyMember.findUnique({
      where: { userId: recruiterId },
      include: { company: COMPANY_WITH_MEDIA },
    });

    if (
      !membership ||
      membership.companyId.toLowerCase() !== companyId.toLowerCase() ||
      membership.role !== CompanyMemberRole.OWNER
    ) {
      throw new ApiException(
        'COMPANY_OWNER_REQUIRED',
        'Only the company owner can manage this profile',
        HttpStatus.FORBIDDEN,
      );
    }
    return membership.company;
  }

  private planMediaMutation(
    companyId: string,
    current: CompanyWithMedia,
    dto: UpdateCompanyDto,
  ): MediaMutationPlan {
    const attachments: PendingAttachment[] = [];
    let logo: PlannedLogo | null | undefined;

    if (dto.removeLogo === true) {
      logo = null;
    } else if (dto.logo !== undefined) {
      if (
        current.logoFileId === dto.logo.fileId &&
        current.logoUrl &&
        current.logoMediaReferenceId
      ) {
        logo = {
          fileId: current.logoFileId,
          url: current.logoUrl,
          mediaReferenceId: current.logoMediaReferenceId,
        };
      } else {
        logo = { fileId: dto.logo.fileId };
        const target = logo;
        const operationId = randomUUID();
        attachments.push({
          operationId,
          fileId: dto.logo.fileId,
          assetType: CompanyMediaAssetType.COMPANY_LOGO,
          referenceType: 'COMPANY_LOGO',
          referenceId: operationId,
          localMediaId: null,
          apply: (verified, reference) => {
            target.url = verified.url;
            target.mediaReferenceId = reference.id;
          },
        });
      }
    }

    let gallery: PlannedGalleryItem[] | undefined;
    if (dto.media !== undefined) {
      gallery = dto.media.map((input, index) => {
        const existing = current.media.find(
          (item) =>
            item.fileId === input.fileId && item.type === input.type,
        );
        const item: PlannedGalleryItem = {
          id: existing?.id ?? randomUUID(),
          fileId: input.fileId,
          type: input.type,
          sortOrder: input.sortOrder ?? index,
        };

        if (existing?.mediaReferenceId && existing.url) {
          item.url = existing.url;
          item.mediaReferenceId = existing.mediaReferenceId;
          return item;
        }

        const assetType = this.toAssetType(input.type);
        attachments.push({
          operationId: randomUUID(),
          fileId: input.fileId,
          assetType,
          referenceType: 'COMPANY_MEDIA',
          referenceId: item.id,
          localMediaId: item.id,
          apply: (verified, reference) => {
            item.url = verified.url;
            item.mediaReferenceId = reference.id;
          },
        });
        return item;
      });
    }

    const detachments: MediaMutationPlan['detachments'] = [];
    if (
      logo !== undefined &&
      current.logoFileId &&
      current.logoMediaReferenceId &&
      current.logoMediaReferenceId !== logo?.mediaReferenceId
    ) {
      detachments.push({
        id: randomUUID(),
        companyId,
        fileId: current.logoFileId,
        assetType: CompanyMediaAssetType.COMPANY_LOGO,
        referenceType: 'COMPANY_LOGO',
        referenceId: current.logoMediaReferenceId,
        localMediaId: null,
        mediaReferenceId: current.logoMediaReferenceId,
      });
    }

    if (gallery !== undefined) {
      const retainedReferences = new Set(
        gallery
          .map((item) => item.mediaReferenceId)
          .filter((value): value is string => value !== undefined),
      );
      for (const oldItem of current.media) {
        if (
          oldItem.mediaReferenceId &&
          !retainedReferences.has(oldItem.mediaReferenceId)
        ) {
          detachments.push({
            id: randomUUID(),
            companyId,
            fileId: oldItem.fileId,
            assetType: this.toAssetType(oldItem.type),
            referenceType: 'COMPANY_MEDIA',
            referenceId: oldItem.id,
            localMediaId: oldItem.id,
            mediaReferenceId: oldItem.mediaReferenceId,
          });
        }
      }
    }

    return { logo, gallery, attachments, detachments };
  }

  private async stageAttachmentOperations(
    companyId: string,
    attachments: PendingAttachment[],
    lease: ForegroundAttachmentLease,
  ): Promise<void> {
    if (attachments.length === 0) return;

    const staged = await this.prisma.companyMediaOperation.createMany({
      data: attachments.map((attachment) => ({
        id: attachment.operationId,
        kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
        companyId,
        fileId: attachment.fileId,
        assetType:
          attachment.assetType as unknown as PrismaCompanyMediaAssetType,
        referenceType: attachment.referenceType,
        referenceId: attachment.referenceId,
        localMediaId: attachment.localMediaId,
        nextAttemptAt: new Date(),
        leaseToken: lease.token,
        leaseExpiresAt: this.mediaOperations.foregroundLeaseExpiresAt(),
      })),
    });
    if (staged.count !== attachments.length) {
      throw this.mediaOperationConflict();
    }
  }

  private async resolveAttachments(
    companyId: string,
    attachments: PendingAttachment[],
    lease: ForegroundAttachmentLease,
  ): Promise<void> {
    for (const attachment of attachments) {
      await this.renewAttachmentLease(attachments, lease);
      const verified = await this.media.verifyCompanyFile(
        attachment.fileId,
        companyId,
        attachment.assetType,
      );
      const reference = await this.media.bindCompanyFile(
        attachment.fileId,
        companyId,
        attachment.assetType,
        attachment.referenceType,
        attachment.referenceId,
      );
      const stored = await this.prisma.companyMediaOperation.updateMany({
        where: {
          id: attachment.operationId,
          kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
          leaseToken: lease.token,
        },
        data: {
          mediaReferenceId: reference.id,
          leaseExpiresAt: this.mediaOperations.foregroundLeaseExpiresAt(),
        },
      });
      if (stored.count !== 1) {
        throw this.mediaOperationConflict();
      }
      attachment.apply(verified, reference);
    }
    await this.renewAttachmentLease(attachments, lease);
  }

  private async renewAttachmentLease(
    attachments: PendingAttachment[],
    lease: ForegroundAttachmentLease,
  ): Promise<void> {
    if (attachments.length === 0) return;
    const renewed = await this.prisma.companyMediaOperation.updateMany({
      where: {
        id: { in: attachments.map((attachment) => attachment.operationId) },
        kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
        leaseToken: lease.token,
      },
      data: {
        leaseExpiresAt: this.mediaOperations.foregroundLeaseExpiresAt(),
      },
    });
    if (renewed.count !== attachments.length) {
      throw this.mediaOperationConflict();
    }
  }

  private async markAttachmentsDue(
    attachments: PendingAttachment[],
    lease: ForegroundAttachmentLease,
  ): Promise<void> {
    if (attachments.length === 0) {
      return;
    }
    try {
      await this.prisma.companyMediaOperation.updateMany({
        where: {
          id: { in: attachments.map((attachment) => attachment.operationId) },
          kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
          leaseToken: lease.token,
        },
        data: {
          nextAttemptAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
    } catch {
      // The staged operation remains durable and becomes due after its short grace period.
    }
  }

  private mediaOperationConflict(): ApiException {
    return new ApiException(
      'COMPANY_MEDIA_OPERATION_CONFLICT',
      'The media operation changed concurrently; retry the request',
      HttpStatus.CONFLICT,
    );
  }

  private assertMediaPlanResolved(plan: MediaMutationPlan): void {
    const unresolvedLogo =
      plan.logo !== undefined &&
      plan.logo !== null &&
      (!plan.logo.url || !plan.logo.mediaReferenceId);
    const unresolvedGallery = plan.gallery?.some(
      (item) => !item.url || !item.mediaReferenceId,
    );
    if (unresolvedLogo || unresolvedGallery) {
      throw new ApiException(
        'COMPANY_MEDIA_OPERATION_INCOMPLETE',
        'The media operation did not produce a complete canonical reference',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private toAssetType(type: CompanyMediaType): CompanyMediaAssetType {
    return type === CompanyMediaType.IMAGE
      ? CompanyMediaAssetType.COMPANY_IMAGE
      : CompanyMediaAssetType.COMPANY_VIDEO;
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
      logoUrl: company.logoMediaReferenceId ? company.logoUrl : null,
      media: company.media
        .filter((item) => item.mediaReferenceId !== null)
        .map((item) => ({
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
        company.logoFileId &&
        company.logoUrl &&
        company.logoMediaReferenceId
          ? {
              fileId: company.logoFileId,
              url: company.logoUrl,
            }
          : null,
      media: company.media
        .filter((item) => item.mediaReferenceId !== null)
        .map((item) => ({
          fileId: item.fileId,
          url: item.url,
          type: item.type,
          sortOrder: item.sortOrder,
        })),
      verifiedStatus: company.verifiedStatus,
      rejectReason: company.rejectReason,
      aggregateVersion: company.aggregateVersion,
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
