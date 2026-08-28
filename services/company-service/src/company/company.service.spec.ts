import { HttpStatus } from '@nestjs/common';
import {
  CompanyAuditAction,
  CompanyMediaOperationKind,
  CompanyMediaType,
  CompanyMemberRole,
  CompanyVerificationStatus,
} from '@prisma/client';
import { ApiException } from '../common/errors/api-exception';
import {
  CompanyFileReference,
  CompanyMediaAssetType,
  CompanyMediaClient,
  CompanyUploadCapability,
  VerifiedCompanyFile,
} from '../media/company-media.client';
import { CompanyMediaOperationService } from '../media/company-media-operation.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import {
  CompanyVerificationDecision,
  VerifyCompanyDto,
} from './dto/verify-company.dto';

const RECRUITER_ID = '18c604a4-4be6-4c3d-85ea-c1f45daf17c8';
const ADMIN_ID = '48c604a4-4be6-4c3d-85ea-c1f45daf17c8';
const OTHER_RECRUITER_ID = '22c604a4-4be6-4c3d-85ea-c1f45daf17c8';
const COMPANY_ID = '90eec7f1-fb6e-49d0-89ff-7d65d2438ff7';
const LOGO_FILE_ID = '6105e846-3bb5-4dc0-a6ed-d0f0148c5bc8';
const IMAGE_FILE_ID = '9a3b4da7-5e84-4b2c-9abd-c39afc8fc501';
const VIDEO_FILE_ID = '9a3b4da7-5e84-4b2c-9abd-c39afc8fc502';
const OLD_LOGO_FILE_ID = '7a3b4da7-5e84-4b2c-9abd-c39afc8fc503';
const OLD_IMAGE_FILE_ID = '8a3b4da7-5e84-4b2c-9abd-c39afc8fc504';
const LOGO_REFERENCE_ID = '01bda5e8-5ed4-4146-84d2-b06a85655421';
const IMAGE_REFERENCE_ID = '02bda5e8-5ed4-4146-84d2-b06a85655422';
const VIDEO_REFERENCE_ID = '03bda5e8-5ed4-4146-84d2-b06a85655423';
const OLD_LOGO_REFERENCE_ID = '04bda5e8-5ed4-4146-84d2-b06a85655424';
const OLD_IMAGE_REFERENCE_ID = '05bda5e8-5ed4-4146-84d2-b06a85655425';
const OLD_MEDIA_ROW_ID = '11bda5e8-5ed4-4146-84d2-b06a85655431';
const NOW = new Date('2026-08-22T00:00:00.000Z');
const FOREGROUND_LEASE_EXPIRY = new Date('2026-08-22T00:01:00.000Z');

const createDto = (
  overrides: Partial<CreateCompanyDto> = {},
): CreateCompanyDto => ({
  name: 'Acme Vietnam',
  description: 'A recruitment technology company',
  industry: 'Technology',
  size: '51-200',
  address: 'Ho Chi Minh City',
  website: 'https://acme.example',
  taxCode: '0312345678',
  ...overrides,
});

const mediaRecord = (overrides: Record<string, unknown> = {}) => ({
  id: OLD_MEDIA_ROW_ID,
  companyId: COMPANY_ID,
  fileId: OLD_IMAGE_FILE_ID,
  mediaReferenceId: OLD_IMAGE_REFERENCE_ID,
  url: 'https://media.example/old-image.jpg',
  type: CompanyMediaType.IMAGE,
  sortOrder: 0,
  createdAt: NOW,
  ...overrides,
});

const companyRecord = (overrides: Record<string, unknown> = {}) => ({
  id: COMPANY_ID,
  name: 'Acme Vietnam',
  normalizedName: 'acme vietnam',
  slug: 'acme-vietnam-90eec7f1',
  description: 'A recruitment technology company',
  industry: 'Technology',
  size: '51-200',
  address: 'Ho Chi Minh City',
  website: 'https://acme.example',
  taxCode: '0312345678',
  logoFileId: null,
  logoUrl: null,
  logoMediaReferenceId: null,
  aggregateVersion: 0,
  verifiedStatus: CompanyVerificationStatus.PENDING,
  rejectReason: null,
  createdAt: NOW,
  updatedAt: NOW,
  media: [],
  ...overrides,
});

const ownerMembership = (company = companyRecord()) => ({
  companyId: COMPANY_ID,
  role: CompanyMemberRole.OWNER,
  company,
});

const verifiedFile = (
  fileId: string,
  type: CompanyMediaAssetType,
  url = `https://media.example/${fileId}`,
): VerifiedCompanyFile => ({
  id: fileId,
  ownerType: 'COMPANY',
  ownerId: COMPANY_ID,
  type,
  status: 'ACTIVE',
  originalFilename: 'asset.bin',
  mimeType:
    type === CompanyMediaAssetType.COMPANY_VIDEO ? 'video/mp4' : 'image/png',
  format: type === CompanyMediaAssetType.COMPANY_VIDEO ? 'mp4' : 'png',
  bytes: 1024,
  url,
  privateDelivery: false,
  aggregateVersion: 1,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

const fileReference = (
  fileId: string,
  id: string,
  referenceType = 'COMPANY_MEDIA',
  referenceId = OLD_MEDIA_ROW_ID,
): CompanyFileReference => ({
  id,
  fileId,
  callerService: 'company-service',
  referenceType,
  referenceId,
  createdAt: NOW.toISOString(),
});

const uploadCapability = (): CompanyUploadCapability => ({
  fileId: LOGO_FILE_ID,
  uploadUrl: 'https://api.cloudinary.example/upload',
  cloudName: 'recruitment',
  apiKey: 'public-key',
  resourceType: 'image',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  maxBytes: 2_000_000,
  allowedFormats: ['png', 'jpg'],
  params: { public_id: 'companies/acme/logo' },
  signature: 'signed-value',
});

const uploadIntentRecord = (overrides: Record<string, unknown> = {}) => ({
  fileId: LOGO_FILE_ID,
  companyId: COMPANY_ID,
  requestedBy: RECRUITER_ID,
  assetType: CompanyMediaAssetType.COMPANY_LOGO,
  expiresAt: new Date(Date.now() + 60_000),
  cleanupAt: new Date(Date.now() + 16 * 60_000),
  confirmedAt: null,
  canonicalUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('CompanyService', () => {
  let service: CompanyService;
  let prisma: {
    $transaction: jest.Mock;
    companyMember: { findUnique: jest.Mock };
    company: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    companyMediaOperation: {
      createMany: jest.Mock;
      updateMany: jest.Mock;
    };
    companyMediaUploadIntent: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let transaction: {
    companyMember: { findUnique: jest.Mock };
    company: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    companyMediaOperation: {
      createMany: jest.Mock;
      deleteMany: jest.Mock;
      upsert: jest.Mock;
    };
    companyMediaUploadIntent: {
      deleteMany: jest.Mock;
      upsert: jest.Mock;
    };
    companyAuditLog: { create: jest.Mock };
  };
  let media: {
    createCompanyUploadIntent: jest.Mock;
    confirmCompanyFile: jest.Mock;
    verifyCompanyFile: jest.Mock;
    bindCompanyFile: jest.Mock;
    releaseReference: jest.Mock;
    deleteCompanyFile: jest.Mock;
  };
  let mediaOperations: {
    kick: jest.Mock;
    foregroundLeaseExpiresAt: jest.Mock;
    uploadIntentCleanupAt: jest.Mock;
  };

  beforeEach(() => {
    let storedUploadIntent: Record<string, unknown> | null = null;
    transaction = {
      companyMember: { findUnique: jest.fn() },
      company: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      companyMediaOperation: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn(async ({ where }) => ({
          count: where.id?.in?.length ?? 0,
        })),
        upsert: jest.fn(async ({ create }) => ({
          ...create,
          attemptCount: 0,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          createdAt: NOW,
          updatedAt: NOW,
        })),
      },
      companyMediaUploadIntent: {
        deleteMany: jest.fn(async () => {
          const count = storedUploadIntent ? 1 : 0;
          storedUploadIntent = null;
          return { count };
        }),
        upsert: jest.fn(async ({ create }) => {
          storedUploadIntent = storedUploadIntent ?? {
            ...create,
            confirmedAt: null,
            canonicalUrl: null,
            createdAt: NOW,
            updatedAt: NOW,
          };
          return storedUploadIntent;
        }),
      },
      companyAuditLog: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn(async (input: unknown) => {
        if (Array.isArray(input)) return Promise.all(input);
        return (input as (client: typeof transaction) => Promise<unknown>)(
          transaction,
        );
      }),
      companyMember: { findUnique: jest.fn() },
      company: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      companyMediaOperation: {
        createMany: jest.fn(async ({ data }) => ({ count: data.length })),
        updateMany: jest.fn(async ({ where }) => ({
          count: where.id?.in?.length ?? 1,
        })),
      },
      companyMediaUploadIntent: {
        upsert: jest.fn(async ({ create }) => {
          storedUploadIntent = {
            ...create,
            confirmedAt: null,
            canonicalUrl: null,
            createdAt: NOW,
            updatedAt: NOW,
          };
          return storedUploadIntent;
        }),
        findUnique: jest.fn(async () => storedUploadIntent),
        updateMany: jest.fn(async ({ data }) => {
          storedUploadIntent = storedUploadIntent
            ? { ...storedUploadIntent, ...data }
            : null;
          return { count: storedUploadIntent ? 1 : 0 };
        }),
      },
    };
    media = {
      createCompanyUploadIntent: jest.fn(),
      confirmCompanyFile: jest.fn(),
      verifyCompanyFile: jest.fn(async (fileId, _companyId, type) =>
        verifiedFile(fileId, type),
      ),
      bindCompanyFile: jest.fn(
        async (
          fileId,
          _companyId,
          _type,
          referenceType,
          referenceId,
        ) =>
          fileReference(
            fileId,
            fileId === LOGO_FILE_ID
              ? LOGO_REFERENCE_ID
              : IMAGE_REFERENCE_ID,
            referenceType,
            referenceId,
          ),
      ),
      releaseReference: jest.fn(),
      deleteCompanyFile: jest.fn(),
    };
    mediaOperations = {
      kick: jest.fn(),
      foregroundLeaseExpiresAt: jest
        .fn()
        .mockReturnValue(FOREGROUND_LEASE_EXPIRY),
      uploadIntentCleanupAt: jest.fn((expiresAt: Date) =>
        new Date(expiresAt.getTime() + 15 * 60_000),
      ),
    };

    service = new CompanyService(
      prisma as unknown as PrismaService,
      media as unknown as CompanyMediaClient,
      mediaOperations as unknown as CompanyMediaOperationService,
    );
  });

  it('creates the company and OWNER membership atomically without accepting media', async () => {
    transaction.companyMember.findUnique.mockResolvedValue(null);
    transaction.company.create.mockImplementation(async ({ data }) =>
      companyRecord({
        id: data.id,
        name: data.name,
        normalizedName: data.normalizedName,
        slug: data.slug,
      }),
    );

    const maliciousLegacyDto = {
      ...createDto(),
      logo: {
        fileId: LOGO_FILE_ID,
        url: 'https://attacker.example/logo',
      },
      media: [
        {
          fileId: IMAGE_FILE_ID,
          url: 'https://attacker.example/image',
          type: CompanyMediaType.IMAGE,
        },
      ],
    } as unknown as CreateCompanyDto;
    const result = await service.create(RECRUITER_ID, maliciousLegacyDto);

    const data = transaction.company.create.mock.calls[0][0].data;
    expect(data).toEqual(
      expect.objectContaining({
        verifiedStatus: CompanyVerificationStatus.PENDING,
        members: {
          create: {
            userId: RECRUITER_ID,
            role: CompanyMemberRole.OWNER,
          },
        },
      }),
    );
    expect(data).not.toHaveProperty('logoFileId');
    expect(data).not.toHaveProperty('logoUrl');
    expect(data).not.toHaveProperty('media');
    expect(media.verifyCompanyFile).not.toHaveBeenCalled();
    expect(media.bindCompanyFile).not.toHaveBeenCalled();
    expect(result.logo).toBeNull();
  });

  it('rejects a recruiter who already belongs to a company', async () => {
    transaction.companyMember.findUnique.mockResolvedValue({
      companyId: COMPANY_ID,
    });

    await expect(
      service.create(RECRUITER_ID, createDto()),
    ).rejects.toMatchObject({
      code: 'RECRUITER_ALREADY_HAS_COMPANY',
    });
    expect(transaction.company.create).not.toHaveBeenCalled();
  });

  it('normalizes company names before persistence', async () => {
    transaction.companyMember.findUnique.mockResolvedValue(null);
    transaction.company.create.mockImplementation(async ({ data }) =>
      companyRecord({
        id: data.id,
        name: data.name,
        normalizedName: data.normalizedName,
        slug: data.slug,
      }),
    );

    await service.create(
      RECRUITER_ID,
      createDto({ name: '  Công   Ty Ánh  ' }),
    );

    const data = transaction.company.create.mock.calls[0][0].data;
    expect(data.name).toBe('Công Ty Ánh');
    expect(data.normalizedName).toBe('công ty ánh');
  });

  it('checks OWNER membership before every upload or attachment media call', async () => {
    prisma.companyMember.findUnique.mockResolvedValue({
      companyId: COMPANY_ID,
      role: CompanyMemberRole.MEMBER,
      company: companyRecord(),
    });

    await expect(
      service.createMediaUploadIntent(RECRUITER_ID, COMPANY_ID, {
        type: CompanyMediaAssetType.COMPANY_LOGO,
        originalFilename: 'logo.png',
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_OWNER_REQUIRED' });
    await expect(
      service.confirmMediaUpload(RECRUITER_ID, COMPANY_ID, {
        fileId: LOGO_FILE_ID,
        type: CompanyMediaAssetType.COMPANY_LOGO,
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_OWNER_REQUIRED' });
    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        logo: { fileId: LOGO_FILE_ID },
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_OWNER_REQUIRED' });

    expect(media.createCompanyUploadIntent).not.toHaveBeenCalled();
    expect(media.confirmCompanyFile).not.toHaveBeenCalled();
    expect(media.verifyCompanyFile).not.toHaveBeenCalled();
    expect(media.bindCompanyFile).not.toHaveBeenCalled();
    expect(prisma.companyMediaOperation.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('derives company/requester/type for upload signature and company/type for confirm', async () => {
    prisma.companyMember.findUnique.mockResolvedValue(ownerMembership());
    const capability = uploadCapability();
    media.createCompanyUploadIntent.mockResolvedValue(capability);
    media.confirmCompanyFile.mockResolvedValue(
      verifiedFile(
        LOGO_FILE_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
        'https://media.example/canonical-logo.png',
      ),
    );

    const signature = await service.createMediaUploadIntent(
      RECRUITER_ID,
      COMPANY_ID.toUpperCase(),
      {
        type: CompanyMediaAssetType.COMPANY_LOGO,
        originalFilename: 'logo.png',
      },
      'upload-once',
    );
    const confirmed = await service.confirmMediaUpload(
      RECRUITER_ID,
      COMPANY_ID.toUpperCase(),
      {
        fileId: LOGO_FILE_ID,
        type: CompanyMediaAssetType.COMPANY_LOGO,
      },
    );

    expect(media.createCompanyUploadIntent).toHaveBeenCalledWith(
      COMPANY_ID,
      RECRUITER_ID,
      CompanyMediaAssetType.COMPANY_LOGO,
      'logo.png',
      'upload-once',
    );
    const cleanupAt = new Date(
      new Date(capability.expiresAt).getTime() + 15 * 60_000,
    );
    expect(transaction.companyMediaUploadIntent.upsert).toHaveBeenCalledWith({
      where: { fileId: LOGO_FILE_ID },
      create: {
        fileId: LOGO_FILE_ID,
        companyId: COMPANY_ID,
        requestedBy: RECRUITER_ID,
        assetType: CompanyMediaAssetType.COMPANY_LOGO,
        expiresAt: new Date(capability.expiresAt),
        cleanupAt,
      },
      update: {},
    });
    expect(transaction.companyMediaOperation.upsert).toHaveBeenCalledWith({
      where: { id: LOGO_FILE_ID },
      create: expect.objectContaining({
        id: LOGO_FILE_ID,
        kind: CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP,
        companyId: COMPANY_ID,
        fileId: LOGO_FILE_ID,
        referenceType: 'COMPANY_UPLOAD_INTENT',
        referenceId: LOGO_FILE_ID,
        nextAttemptAt: cleanupAt,
      }),
      update: {},
    });
    expect(media.confirmCompanyFile).toHaveBeenCalledWith(
      LOGO_FILE_ID,
      COMPANY_ID,
      CompanyMediaAssetType.COMPANY_LOGO,
    );
    expect(signature).toBe(capability);
    expect(confirmed).toEqual({
      fileId: LOGO_FILE_ID,
      type: CompanyMediaAssetType.COMPANY_LOGO,
      url: 'https://media.example/canonical-logo.png',
    });
  });

  it('rejects a leaked file id before Media confirm when no matching Company intent exists', async () => {
    prisma.companyMember.findUnique.mockResolvedValue(ownerMembership());
    prisma.companyMediaUploadIntent.findUnique.mockResolvedValue(null);

    await expect(
      service.confirmMediaUpload(RECRUITER_ID, COMPANY_ID, {
        fileId: LOGO_FILE_ID,
        type: CompanyMediaAssetType.COMPANY_LOGO,
      }),
    ).rejects.toMatchObject({
      code: 'COMPANY_MEDIA_UPLOAD_INTENT_INVALID',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });

    expect(media.confirmCompanyFile).not.toHaveBeenCalled();
  });

  it.each([
    ['company', { companyId: OTHER_RECRUITER_ID }],
    ['requester', { requestedBy: OTHER_RECRUITER_ID }],
    ['type', { assetType: CompanyMediaAssetType.COMPANY_IMAGE }],
  ])('rejects an upload intent with mismatched %s before Media confirm', async (_field, mismatch) => {
    prisma.companyMember.findUnique.mockResolvedValue(ownerMembership());
    prisma.companyMediaUploadIntent.findUnique.mockResolvedValue(
      uploadIntentRecord(mismatch),
    );

    await expect(
      service.confirmMediaUpload(RECRUITER_ID, COMPANY_ID, {
        fileId: LOGO_FILE_ID,
        type: CompanyMediaAssetType.COMPANY_LOGO,
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_MEDIA_UPLOAD_INTENT_INVALID' });

    expect(media.confirmCompanyFile).not.toHaveBeenCalled();
  });

  it('rejects an expired pending upload intent before Media confirm', async () => {
    prisma.companyMember.findUnique.mockResolvedValue(ownerMembership());
    prisma.companyMediaUploadIntent.findUnique.mockResolvedValue(
      uploadIntentRecord({ expiresAt: new Date(Date.now() - 1) }),
    );

    await expect(
      service.confirmMediaUpload(RECRUITER_ID, COMPANY_ID, {
        fileId: LOGO_FILE_ID,
        type: CompanyMediaAssetType.COMPANY_LOGO,
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_MEDIA_UPLOAD_INTENT_INVALID' });

    expect(media.confirmCompanyFile).not.toHaveBeenCalled();
  });

  it('returns a persisted confirmation idempotently without calling Media again', async () => {
    prisma.companyMember.findUnique.mockResolvedValue(ownerMembership());
    prisma.companyMediaUploadIntent.findUnique.mockResolvedValue(
      uploadIntentRecord({
        expiresAt: new Date(Date.now() - 1),
        confirmedAt: NOW,
        canonicalUrl: 'https://media.example/canonical-logo.png',
      }),
    );

    await expect(
      service.confirmMediaUpload(RECRUITER_ID, COMPANY_ID, {
        fileId: LOGO_FILE_ID,
        type: CompanyMediaAssetType.COMPANY_LOGO,
      }),
    ).resolves.toEqual({
      fileId: LOGO_FILE_ID,
      type: CompanyMediaAssetType.COMPANY_LOGO,
      url: 'https://media.example/canonical-logo.png',
    });

    expect(media.confirmCompanyFile).not.toHaveBeenCalled();
  });

  it('rejects a cached confirmation at cleanup time or after its intent was deleted', async () => {
    prisma.companyMember.findUnique.mockResolvedValue(ownerMembership());
    prisma.companyMediaUploadIntent.findUnique
      .mockResolvedValueOnce(
        uploadIntentRecord({
          expiresAt: new Date(Date.now() - 60_000),
          cleanupAt: new Date(Date.now() - 1),
          confirmedAt: NOW,
          canonicalUrl: 'https://media.example/canonical-logo.png',
        }),
      )
      .mockResolvedValueOnce(null);

    const confirm = () =>
      service.confirmMediaUpload(RECRUITER_ID, COMPANY_ID, {
        fileId: LOGO_FILE_ID,
        type: CompanyMediaAssetType.COMPANY_LOGO,
      });
    await expect(confirm()).rejects.toMatchObject({
      code: 'COMPANY_MEDIA_UPLOAD_INTENT_INVALID',
    });
    await expect(confirm()).rejects.toMatchObject({
      code: 'COMPANY_MEDIA_UPLOAD_INTENT_INVALID',
    });
    expect(media.confirmCompanyFile).not.toHaveBeenCalled();
  });

  it('verifies and binds logo/gallery then stores only canonical Media URLs and reference ids', async () => {
    const baseline = companyRecord({ aggregateVersion: 7 });
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    media.verifyCompanyFile.mockImplementation(
      async (fileId, _companyId, type) =>
        verifiedFile(
          fileId,
          type,
          `https://media.example/canonical/${fileId}`,
        ),
    );
    media.bindCompanyFile
      .mockImplementationOnce(
        async (
          fileId,
          _companyId,
          _type,
          referenceType,
          referenceId,
        ) =>
          fileReference(
            fileId,
            LOGO_REFERENCE_ID,
            referenceType,
            referenceId,
          ),
      )
      .mockImplementationOnce(
        async (
          fileId,
          _companyId,
          _type,
          referenceType,
          referenceId,
        ) =>
          fileReference(
            fileId,
            IMAGE_REFERENCE_ID,
            referenceType,
            referenceId,
          ),
      )
      .mockImplementationOnce(
        async (
          fileId,
          _companyId,
          _type,
          referenceType,
          referenceId,
        ) =>
          fileReference(
            fileId,
            VIDEO_REFERENCE_ID,
            referenceType,
            referenceId,
          ),
      );
    transaction.company.update.mockResolvedValue(
      companyRecord({
        logoFileId: LOGO_FILE_ID,
        logoUrl: `https://media.example/canonical/${LOGO_FILE_ID}`,
        logoMediaReferenceId: LOGO_REFERENCE_ID,
        aggregateVersion: 8,
      }),
    );

    await service.update(RECRUITER_ID, COMPANY_ID, {
      logo: { fileId: LOGO_FILE_ID },
      media: [
        { fileId: IMAGE_FILE_ID, type: CompanyMediaType.IMAGE },
        {
          fileId: VIDEO_FILE_ID,
          type: CompanyMediaType.VIDEO,
          sortOrder: 9,
        },
      ],
    });

    expect(media.verifyCompanyFile.mock.calls).toEqual([
      [LOGO_FILE_ID, COMPANY_ID, CompanyMediaAssetType.COMPANY_LOGO],
      [IMAGE_FILE_ID, COMPANY_ID, CompanyMediaAssetType.COMPANY_IMAGE],
      [VIDEO_FILE_ID, COMPANY_ID, CompanyMediaAssetType.COMPANY_VIDEO],
    ]);
    expect(media.bindCompanyFile).toHaveBeenNthCalledWith(
      1,
      LOGO_FILE_ID,
      COMPANY_ID,
      CompanyMediaAssetType.COMPANY_LOGO,
      'COMPANY_LOGO',
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    );
    const updateData = transaction.company.update.mock.calls[0][0].data;
    expect(updateData).toEqual(
      expect.objectContaining({
        logoFileId: LOGO_FILE_ID,
        logoUrl: `https://media.example/canonical/${LOGO_FILE_ID}`,
        logoMediaReferenceId: LOGO_REFERENCE_ID,
        aggregateVersion: { increment: 1 },
      }),
    );
    expect(updateData.media.create).toEqual([
      expect.objectContaining({
        fileId: IMAGE_FILE_ID,
        url: `https://media.example/canonical/${IMAGE_FILE_ID}`,
        mediaReferenceId: IMAGE_REFERENCE_ID,
        type: CompanyMediaType.IMAGE,
        sortOrder: 0,
      }),
      expect.objectContaining({
        fileId: VIDEO_FILE_ID,
        url: `https://media.example/canonical/${VIDEO_FILE_ID}`,
        mediaReferenceId: VIDEO_REFERENCE_ID,
        type: CompanyMediaType.VIDEO,
        sortOrder: 9,
      }),
    ]);
    expect(
      transaction.companyMediaOperation.deleteMany,
    ).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: expect.arrayContaining([expect.any(String)]) },
        kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
        leaseToken: expect.any(String),
      }),
    });
    expect(
      transaction.companyMediaUploadIntent.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        fileId: {
          in: expect.arrayContaining([
            LOGO_FILE_ID,
            IMAGE_FILE_ID,
            VIDEO_FILE_ID,
          ]),
        },
        companyId: COMPANY_ID,
      },
    });
    expect(transaction.companyMediaOperation.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: expect.arrayContaining([
            LOGO_FILE_ID,
            IMAGE_FILE_ID,
            VIDEO_FILE_ID,
          ]),
        },
        companyId: COMPANY_ID,
        kind: CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP,
      },
    });
  });

  it('uses a fresh logo binding generation when the same file is reattached', async () => {
    const detachedBaseline = companyRecord({ aggregateVersion: 4 });
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(detachedBaseline),
    );
    transaction.companyMember.findUnique.mockResolvedValue(
      ownerMembership(detachedBaseline),
    );
    transaction.company.update.mockResolvedValue(
      companyRecord({
        logoFileId: LOGO_FILE_ID,
        logoUrl: `https://media.example/${LOGO_FILE_ID}`,
        logoMediaReferenceId: LOGO_REFERENCE_ID,
        aggregateVersion: 5,
      }),
    );

    await service.update(RECRUITER_ID, COMPANY_ID, {
      logo: { fileId: LOGO_FILE_ID },
    });
    await service.update(RECRUITER_ID, COMPANY_ID, {
      logo: { fileId: LOGO_FILE_ID },
    });

    const firstGeneration = media.bindCompanyFile.mock.calls[0][4];
    const secondGeneration = media.bindCompanyFile.mock.calls[1][4];
    expect(firstGeneration).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(secondGeneration).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(firstGeneration).not.toBe(COMPANY_ID);
    expect(secondGeneration).not.toBe(firstGeneration);
  });

  it('leaves Company untouched and makes the staged operation due when Media rejects ownership', async () => {
    const baseline = companyRecord();
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    media.verifyCompanyFile.mockRejectedValue(
      new ApiException(
        'MEDIA_FILE_MISMATCH',
        'File ownership does not match',
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    );

    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        logo: { fileId: LOGO_FILE_ID },
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_FILE_MISMATCH' });

    expect(prisma.companyMediaOperation.createMany).toHaveBeenCalledTimes(1);
    expect(
      prisma.companyMediaOperation.createMany.mock.calls[0][0].data[0],
    ).toEqual(
      expect.objectContaining({
        leaseToken: expect.any(String),
        leaseExpiresAt: FOREGROUND_LEASE_EXPIRY,
      }),
    );
    expect(prisma.companyMediaOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nextAttemptAt: expect.any(Date),
          leaseToken: null,
          leaseExpiresAt: null,
        }),
      }),
    );
    expect(media.bindCompanyFile).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(transaction.company.update).not.toHaveBeenCalled();
    expect(mediaOperations.kick).toHaveBeenCalledTimes(1);
  });

  it('keeps every staged operation durable when a later bind in a batch fails', async () => {
    const baseline = companyRecord();
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    media.bindCompanyFile
      .mockResolvedValueOnce(
        fileReference(
          IMAGE_FILE_ID,
          IMAGE_REFERENCE_ID,
          'COMPANY_MEDIA',
          OLD_MEDIA_ROW_ID,
        ),
      )
      .mockRejectedValueOnce(
        new ApiException(
          'MEDIA_UNAVAILABLE',
          'Media Service unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
        ),
      );

    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        media: [
          { fileId: IMAGE_FILE_ID, type: CompanyMediaType.IMAGE },
          { fileId: VIDEO_FILE_ID, type: CompanyMediaType.VIDEO },
        ],
      }),
    ).rejects.toMatchObject({ code: 'MEDIA_UNAVAILABLE' });

    expect(prisma.companyMediaOperation.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.companyMediaOperation.updateMany).toHaveBeenCalledTimes(4);
    const markDue =
      prisma.companyMediaOperation.updateMany.mock.calls[3][0];
    const stagedIds =
      prisma.companyMediaOperation.createMany.mock.calls[0][0].data.map(
        (input: { id: string }) => input.id,
      );
    expect(markDue.where.id.in).toEqual(
      expect.arrayContaining(stagedIds),
    );
    expect(markDue.data.nextAttemptAt).toEqual(expect.any(Date));
    expect(
      transaction.companyMediaOperation.deleteMany,
    ).not.toHaveBeenCalled();
    expect(transaction.company.update).not.toHaveBeenCalled();
    expect(mediaOperations.kick).toHaveBeenCalledTimes(1);
  });

  it('heartbeats the entire slow batch and stops before the next HTTP call after losing its lease', async () => {
    const baseline = companyRecord();
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    let heartbeat = 0;
    prisma.companyMediaOperation.updateMany.mockImplementation(
      async ({ where, data }) => {
        const batchSize = where.id?.in?.length;
        if (batchSize === 2 && data.leaseExpiresAt && !data.nextAttemptAt) {
          heartbeat += 1;
          return { count: heartbeat === 2 ? 1 : 2 };
        }
        return { count: batchSize ?? 1 };
      },
    );

    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        media: [
          { fileId: IMAGE_FILE_ID, type: CompanyMediaType.IMAGE },
          { fileId: VIDEO_FILE_ID, type: CompanyMediaType.VIDEO },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'COMPANY_MEDIA_OPERATION_CONFLICT',
    });

    expect(heartbeat).toBe(2);
    expect(media.verifyCompanyFile).toHaveBeenCalledTimes(1);
    expect(media.bindCompanyFile).toHaveBeenCalledTimes(1);
    expect(transaction.company.update).not.toHaveBeenCalled();
    const staged =
      prisma.companyMediaOperation.createMany.mock.calls[0][0].data;
    const dueCall =
      prisma.companyMediaOperation.updateMany.mock.calls.at(-1)?.[0];
    expect(dueCall.where).toEqual(
      expect.objectContaining({
        id: { in: staged.map((item: { id: string }) => item.id) },
        leaseToken: staged[0].leaseToken,
      }),
    );
    expect(dueCall.data).toEqual(
      expect.objectContaining({
        nextAttemptAt: expect.any(Date),
        leaseToken: null,
        leaseExpiresAt: null,
      }),
    );
  });

  it('aborts the domain transaction when fenced ATTACH deletion is incomplete', async () => {
    const baseline = companyRecord({ aggregateVersion: 2 });
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.company.update.mockResolvedValue(
      companyRecord({ aggregateVersion: 3 }),
    );
    transaction.companyMediaOperation.deleteMany.mockResolvedValue({
      count: 0,
    });

    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        logo: { fileId: LOGO_FILE_ID },
      }),
    ).rejects.toMatchObject({
      code: 'COMPANY_MEDIA_OPERATION_CONFLICT',
    });

    expect(transaction.company.update).toHaveBeenCalledTimes(1);
    expect(transaction.companyMediaOperation.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
        leaseToken: expect.any(String),
      }),
    });
    const markDue =
      prisma.companyMediaOperation.updateMany.mock.calls.at(-1)?.[0];
    expect(markDue.where.leaseToken).toEqual(expect.any(String));
    expect(markDue.data.leaseToken).toBeNull();
  });

  it('atomically creates DETACH jobs and deletes successful ATTACH operations on replacement', async () => {
    const baseline = companyRecord({
      aggregateVersion: 3,
      logoFileId: OLD_LOGO_FILE_ID,
      logoUrl: 'https://media.example/old-logo.png',
      logoMediaReferenceId: OLD_LOGO_REFERENCE_ID,
      media: [mediaRecord()],
    });
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.company.update.mockResolvedValue(
      companyRecord({
        aggregateVersion: 4,
        logoFileId: LOGO_FILE_ID,
        logoUrl: 'https://media.example/new-logo.png',
        logoMediaReferenceId: LOGO_REFERENCE_ID,
      }),
    );
    media.verifyCompanyFile.mockResolvedValue(
      verifiedFile(
        LOGO_FILE_ID,
        CompanyMediaAssetType.COMPANY_LOGO,
        'https://media.example/new-logo.png',
      ),
    );
    media.bindCompanyFile.mockResolvedValue(
      fileReference(
        LOGO_FILE_ID,
        LOGO_REFERENCE_ID,
        'COMPANY_LOGO',
        COMPANY_ID,
      ),
    );

    await service.update(RECRUITER_ID, COMPANY_ID, {
      logo: { fileId: LOGO_FILE_ID },
      media: [],
    });

    const detachCall =
      transaction.companyMediaOperation.createMany.mock.calls[0][0];
    expect(detachCall).not.toHaveProperty('skipDuplicates');
    expect(detachCall.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: CompanyMediaOperationKind.DETACH_CLEANUP,
          fileId: OLD_LOGO_FILE_ID,
          mediaReferenceId: OLD_LOGO_REFERENCE_ID,
          referenceType: 'COMPANY_LOGO',
          referenceId: OLD_LOGO_REFERENCE_ID,
        }),
        expect.objectContaining({
          kind: CompanyMediaOperationKind.DETACH_CLEANUP,
          fileId: OLD_IMAGE_FILE_ID,
          mediaReferenceId: OLD_IMAGE_REFERENCE_ID,
          referenceType: 'COMPANY_MEDIA',
          referenceId: OLD_MEDIA_ROW_ID,
        }),
      ]),
    );
    const stagedAttach =
      prisma.companyMediaOperation.createMany.mock.calls[0][0].data[0];
    const attachOperationId = stagedAttach.id;
    expect(
      transaction.companyMediaOperation.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        id: { in: [attachOperationId] },
        kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
        leaseToken: stagedAttach.leaseToken,
      },
    });
    expect(
      transaction.companyMediaOperation.createMany.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      transaction.company.update.mock.invocationCallOrder[0],
    );
    expect(
      transaction.company.update.mock.invocationCallOrder[0],
    ).toBeLessThan(
      transaction.companyMediaOperation.deleteMany.mock
        .invocationCallOrder[0],
    );
    expect(media.releaseReference).not.toHaveBeenCalled();
    expect(mediaOperations.kick).toHaveBeenCalledTimes(1);
  });

  it('preserves a bound ATTACH operation for cleanup when aggregate version changed', async () => {
    const baseline = companyRecord({ aggregateVersion: 10 });
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.companyMember.findUnique.mockResolvedValue(
      ownerMembership(companyRecord({ aggregateVersion: 11 })),
    );

    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        logo: { fileId: LOGO_FILE_ID },
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_UPDATE_CONFLICT' });

    expect(media.bindCompanyFile).toHaveBeenCalledTimes(1);
    expect(prisma.companyMediaOperation.updateMany).toHaveBeenCalledTimes(4);
    const stagedId =
      prisma.companyMediaOperation.createMany.mock.calls[0][0].data[0].id;
    expect(
      prisma.companyMediaOperation.updateMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [stagedId] } }),
        data: expect.objectContaining({
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
    expect(transaction.company.update).not.toHaveBeenCalled();
    expect(
      transaction.companyMediaOperation.deleteMany,
    ).not.toHaveBeenCalled();
    expect(mediaOperations.kick).toHaveBeenCalledTimes(1);
  });

  it('detects a concurrent aggregate version change before a non-media update', async () => {
    const baseline = companyRecord({ aggregateVersion: 20 });
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.companyMember.findUnique.mockResolvedValue(
      ownerMembership(companyRecord({ aggregateVersion: 21 })),
    );

    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        description: 'new text',
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_UPDATE_CONFLICT' });

    expect(transaction.company.update).not.toHaveBeenCalled();
    expect(media.verifyCompanyFile).not.toHaveBeenCalled();
    expect(prisma.companyMediaOperation.createMany).not.toHaveBeenCalled();
  });
  it('removes references asynchronously through durable DETACH work', async () => {
    const baseline = companyRecord({
      aggregateVersion: 1,
      logoFileId: OLD_LOGO_FILE_ID,
      logoUrl: 'https://media.example/old-logo.png',
      logoMediaReferenceId: OLD_LOGO_REFERENCE_ID,
      media: [mediaRecord()],
    });
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.company.update.mockResolvedValue(
      companyRecord({ aggregateVersion: 2 }),
    );

    await service.update(RECRUITER_ID, COMPANY_ID, {
      removeLogo: true,
      media: [],
    });

    expect(
      transaction.companyMediaOperation.createMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            kind: CompanyMediaOperationKind.DETACH_CLEANUP,
            mediaReferenceId: OLD_LOGO_REFERENCE_ID,
          }),
          expect.objectContaining({
            kind: CompanyMediaOperationKind.DETACH_CLEANUP,
            mediaReferenceId: OLD_IMAGE_REFERENCE_ID,
          }),
        ]),
      }),
    );
    expect(transaction.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          logoFileId: null,
          logoUrl: null,
          logoMediaReferenceId: null,
          media: { deleteMany: {}, create: [] },
        }),
      }),
    );
    expect(media.releaseReference).not.toHaveBeenCalled();
    expect(media.deleteCompanyFile).not.toHaveBeenCalled();
    expect(mediaOperations.kick).toHaveBeenCalledTimes(1);
  });

  it('hides legacy rows without a verified Media reference from owner and public views', async () => {
    const legacy = companyRecord({
      verifiedStatus: CompanyVerificationStatus.VERIFIED,
      logoFileId: OLD_LOGO_FILE_ID,
      logoUrl: 'https://legacy.example/unverified-logo.png',
      logoMediaReferenceId: null,
      media: [
        mediaRecord({
          id: '12bda5e8-5ed4-4146-84d2-b06a85655432',
          fileId: IMAGE_FILE_ID,
          mediaReferenceId: null,
          url: 'https://legacy.example/unverified-image.png',
        }),
        mediaRecord(),
      ],
    });
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(legacy),
    );
    prisma.company.findFirst.mockResolvedValue(legacy);

    const mine = await service.getMine(RECRUITER_ID);
    const publicProfile = await service.getPublicById(COMPANY_ID);

    expect(mine.logo).toBeNull();
    expect(mine.media).toEqual([
      expect.objectContaining({ fileId: OLD_IMAGE_FILE_ID }),
    ]);
    expect(publicProfile.logoUrl).toBeNull();
    expect(publicProfile.media).toEqual([
      expect.objectContaining({
        url: 'https://media.example/old-image.jpg',
      }),
    ]);
    expect(publicProfile.media[0]).not.toHaveProperty('fileId');
  });

  it('enforces limits and duplicate file ids before staging media work', async () => {
    prisma.companyMember.findUnique.mockResolvedValue(ownerMembership());
    const videos = [VIDEO_FILE_ID, OLD_IMAGE_FILE_ID].map((fileId) => ({
      fileId,
      type: CompanyMediaType.VIDEO,
    }));

    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, { media: videos }),
    ).rejects.toMatchObject({ code: 'MEDIA_LIMIT_EXCEEDED' });
    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        logo: { fileId: LOGO_FILE_ID },
        media: [
          {
            fileId: LOGO_FILE_ID,
            type: CompanyMediaType.IMAGE,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_MEDIA_REFERENCE' });

    expect(prisma.companyMediaOperation.createMany).not.toHaveBeenCalled();
    expect(media.verifyCompanyFile).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets the OWNER update ordinary fields and resets VERIFIED after a critical change', async () => {
    const baseline = companyRecord({
      aggregateVersion: 2,
      verifiedStatus: CompanyVerificationStatus.VERIFIED,
    });
    prisma.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.companyMember.findUnique.mockResolvedValue(
      ownerMembership(baseline),
    );
    transaction.company.update.mockResolvedValue(
      companyRecord({
        name: 'Acme Global',
        aggregateVersion: 3,
        verifiedStatus: CompanyVerificationStatus.PENDING,
      }),
    );

    await service.update(RECRUITER_ID, COMPANY_ID, {
      name: 'Acme Global',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(transaction.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: COMPANY_ID },
        data: expect.objectContaining({
          name: 'Acme Global',
          verifiedStatus: CompanyVerificationStatus.PENDING,
          rejectReason: null,
          aggregateVersion: { increment: 1 },
        }),
      }),
    );
    expect(transaction.companyAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects null for non-nullable update fields before persistence', async () => {
    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        media: null,
      } as unknown as UpdateCompanyDto),
    ).rejects.toMatchObject({
      code: 'NULL_FIELD_NOT_ALLOWED',
      details: { field: 'media' },
    });
    expect(prisma.companyMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('only queries VERIFIED companies through the public endpoint', async () => {
    prisma.company.findFirst.mockResolvedValue(null);

    await expect(
      service.getPublicById(COMPANY_ID),
    ).rejects.toMatchObject({
      code: 'COMPANY_NOT_FOUND',
    });
    expect(prisma.company.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: COMPANY_ID,
          verifiedStatus: CompanyVerificationStatus.VERIFIED,
        },
      }),
    );
  });

  it('lists the selected review queue with pagination metadata', async () => {
    prisma.company.findMany.mockResolvedValue([companyRecord()]);
    prisma.company.count.mockResolvedValue(21);

    const result = await service.listForReview({
      verified_status: CompanyVerificationStatus.PENDING,
      page: 2,
      limit: 10,
    });

    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          verifiedStatus: CompanyVerificationStatus.PENDING,
        },
        skip: 10,
        take: 10,
      }),
    );
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
  });

  it('requires a non-blank reason when rejecting a company', async () => {
    const dto: VerifyCompanyDto = {
      decision: CompanyVerificationDecision.REJECT,
      reason: '   ',
    };

    await expect(
      service.verify(ADMIN_ID, COMPANY_ID, dto),
    ).rejects.toMatchObject({
      code: 'VERIFICATION_REASON_REQUIRED',
      details: { field: 'reason' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('approves a PENDING company and increments its aggregate version', async () => {
    transaction.company.findUnique.mockResolvedValue(companyRecord());
    transaction.company.update.mockResolvedValue(
      companyRecord({
        aggregateVersion: 1,
        verifiedStatus: CompanyVerificationStatus.VERIFIED,
      }),
    );

    const result = await service.verify(ADMIN_ID, COMPANY_ID, {
      decision: CompanyVerificationDecision.APPROVE,
    });

    expect(transaction.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          verifiedStatus: CompanyVerificationStatus.VERIFIED,
          rejectReason: null,
          aggregateVersion: { increment: 1 },
        },
      }),
    );
    expect(result.verifiedStatus).toBe(
      CompanyVerificationStatus.VERIFIED,
    );
    expect(transaction.companyAuditLog.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_ID,
        action: CompanyAuditAction.VERIFICATION_APPROVED,
        actorId: ADMIN_ID,
        targetUserId: null,
        resultingAggregateVersion: 1,
        fromVerificationStatus: CompanyVerificationStatus.PENDING,
        toVerificationStatus: CompanyVerificationStatus.VERIFIED,
        reason: null,
      },
    });
  });

  it('rejects a PENDING company and records only the trimmed reason', async () => {
    transaction.company.findUnique.mockResolvedValue(companyRecord());
    transaction.company.update.mockResolvedValue(
      companyRecord({
        aggregateVersion: 1,
        verifiedStatus: CompanyVerificationStatus.REJECTED,
        rejectReason: 'Missing legal document',
      }),
    );

    await service.verify(ADMIN_ID, COMPANY_ID, {
      decision: CompanyVerificationDecision.REJECT,
      reason: '  Missing legal document  ',
    });

    expect(transaction.companyAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: CompanyAuditAction.VERIFICATION_REJECTED,
        actorId: ADMIN_ID,
        resultingAggregateVersion: 1,
        fromVerificationStatus: CompanyVerificationStatus.PENDING,
        toVerificationStatus: CompanyVerificationStatus.REJECTED,
        reason: 'Missing legal document',
      }),
    });
  });

  it('fails the review transaction when the audit insert fails', async () => {
    transaction.company.findUnique.mockResolvedValue(companyRecord());
    transaction.company.update.mockResolvedValue(
      companyRecord({
        aggregateVersion: 1,
        verifiedStatus: CompanyVerificationStatus.VERIFIED,
      }),
    );
    transaction.companyAuditLog.create.mockRejectedValue(
      new Error('forced audit failure'),
    );

    await expect(
      service.verify(ADMIN_ID, COMPANY_ID, {
        decision: CompanyVerificationDecision.APPROVE,
      }),
    ).rejects.toThrow('forced audit failure');
    expect(transaction.companyAuditLog.create).toHaveBeenCalledTimes(1);
  });

  it('treats an identical completed review as an idempotent retry', async () => {
    transaction.company.findUnique.mockResolvedValue(
      companyRecord({
        verifiedStatus: CompanyVerificationStatus.VERIFIED,
      }),
    );

    const result = await service.verify(ADMIN_ID, COMPANY_ID, {
      decision: CompanyVerificationDecision.APPROVE,
    });

    expect(result.verifiedStatus).toBe(
      CompanyVerificationStatus.VERIFIED,
    );
    expect(transaction.company.update).not.toHaveBeenCalled();
    expect(transaction.companyAuditLog.create).not.toHaveBeenCalled();
  });

  it('lets an OWNER resubmit a REJECTED company and increments its version', async () => {
    transaction.companyMember.findUnique.mockResolvedValue(
      ownerMembership(
        companyRecord({
          aggregateVersion: 4,
          verifiedStatus: CompanyVerificationStatus.REJECTED,
          rejectReason: 'Missing legal document',
        }),
      ),
    );
    transaction.company.update.mockResolvedValue(
      companyRecord({ aggregateVersion: 5 }),
    );

    const result = await service.resubmit(RECRUITER_ID);

    expect(transaction.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          verifiedStatus: CompanyVerificationStatus.PENDING,
          rejectReason: null,
          aggregateVersion: { increment: 1 },
        },
      }),
    );
    expect(result.verifiedStatus).toBe(
      CompanyVerificationStatus.PENDING,
    );
    expect(transaction.companyAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects upload access when the recruiter belongs to another company', async () => {
    prisma.companyMember.findUnique.mockResolvedValue({
      companyId: '99eec7f1-fb6e-49d0-89ff-7d65d2438ff9',
      role: CompanyMemberRole.OWNER,
      company: companyRecord(),
    });

    await expect(
      service.createMediaUploadIntent(
        OTHER_RECRUITER_ID,
        COMPANY_ID,
        {
          type: CompanyMediaAssetType.COMPANY_IMAGE,
          originalFilename: 'office.png',
        },
      ),
    ).rejects.toMatchObject({ code: 'COMPANY_OWNER_REQUIRED' });
    expect(media.createCompanyUploadIntent).not.toHaveBeenCalled();
  });
});
