import {
  CompanyMediaType,
  CompanyMemberRole,
  CompanyVerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

const RECRUITER_ID = '18c604a4-4be6-4c3d-85ea-c1f45daf17c8';
const COMPANY_ID = '90eec7f1-fb6e-49d0-89ff-7d65d2438ff7';
const NOW = new Date('2026-08-22T00:00:00.000Z');

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
  verifiedStatus: CompanyVerificationStatus.PENDING,
  rejectReason: null,
  createdAt: NOW,
  updatedAt: NOW,
  media: [],
  ...overrides,
});

describe('CompanyService', () => {
  let service: CompanyService;
  let prisma: {
    $transaction: jest.Mock;
    companyMember: { findUnique: jest.Mock };
    company: { findFirst: jest.Mock; update: jest.Mock };
  };
  let transaction: {
    companyMember: { findUnique: jest.Mock };
    company: { create: jest.Mock; update: jest.Mock };
  };

  beforeEach(() => {
    transaction = {
      companyMember: { findUnique: jest.fn() },
      company: { create: jest.fn(), update: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn(async (callback) => callback(transaction)),
      companyMember: { findUnique: jest.fn() },
      company: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new CompanyService(prisma as unknown as PrismaService);
  });

  it('creates the company and OWNER membership in one transaction', async () => {
    transaction.companyMember.findUnique.mockResolvedValue(null);
    transaction.company.create.mockImplementation(async ({ data }) =>
      companyRecord({
        id: data.id,
        name: data.name,
        normalizedName: data.normalizedName,
        slug: data.slug,
      }),
    );

    const result = await service.create(RECRUITER_ID, createDto());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verifiedStatus: CompanyVerificationStatus.PENDING,
          members: {
            create: {
              userId: RECRUITER_ID,
              role: CompanyMemberRole.OWNER,
            },
          },
        }),
      }),
    );
    expect(result.verifiedStatus).toBe(CompanyVerificationStatus.PENDING);
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

  it('normalizes company names case-insensitively before persistence', async () => {
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

    const createCall = transaction.company.create.mock.calls[0][0];
    expect(createCall.data.name).toBe('Công Ty Ánh');
    expect(createCall.data.normalizedName).toBe('công ty ánh');
  });

  it('lets the recruiter see a REJECTED company and its reason through /me logic', async () => {
    prisma.companyMember.findUnique.mockResolvedValue({
      company: companyRecord({
        verifiedStatus: CompanyVerificationStatus.REJECTED,
        rejectReason: 'Tax document is unreadable',
      }),
    });

    const result = await service.getMine(RECRUITER_ID);

    expect(result.verifiedStatus).toBe(CompanyVerificationStatus.REJECTED);
    expect(result.rejectReason).toBe('Tax document is unreadable');
  });

  it('only queries VERIFIED companies through the public endpoint', async () => {
    prisma.company.findFirst.mockResolvedValue(null);

    await expect(service.getPublicById(COMPANY_ID)).rejects.toMatchObject({
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

  it('redacts workflow fields and raw file ids from the public profile', async () => {
    prisma.company.findFirst.mockResolvedValue(
      companyRecord({
        logoFileId: '6105e846-3bb5-4dc0-a6ed-d0f0148c5bc8',
        logoUrl: 'https://cdn.example/logo',
        verifiedStatus: CompanyVerificationStatus.VERIFIED,
        rejectReason: 'must never be exposed publicly',
        media: [
          {
            id: 'f86befcc-d2eb-472a-895f-5d581c47c39b',
            companyId: COMPANY_ID,
            fileId: '9a3b4da7-5e84-4b2c-9abd-c39afc8fc501',
            url: 'https://cdn.example/image',
            type: CompanyMediaType.IMAGE,
            sortOrder: 0,
            createdAt: NOW,
          },
        ],
      }),
    );

    const result = await service.getPublicById(COMPANY_ID);

    expect(result.logoUrl).toBe('https://cdn.example/logo');
    expect(result).not.toHaveProperty('verifiedStatus');
    expect(result).not.toHaveProperty('rejectReason');
    expect(result.media[0]).not.toHaveProperty('fileId');
  });

  it('lets the OWNER update and resets VERIFIED after a critical change', async () => {
    transaction.companyMember.findUnique.mockResolvedValue({
      companyId: COMPANY_ID,
      role: CompanyMemberRole.OWNER,
      company: {
        name: 'Acme Vietnam',
        taxCode: '0312345678',
        logoFileId: null,
        verifiedStatus: CompanyVerificationStatus.VERIFIED,
        media: [],
      },
    });
    transaction.company.update.mockResolvedValue(
      companyRecord({
        name: 'Acme Global',
        verifiedStatus: CompanyVerificationStatus.PENDING,
      }),
    );

    await service.update(RECRUITER_ID, COMPANY_ID, {
      name: 'Acme Global',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        isolationLevel: 'Serializable',
      },
    );
    expect(transaction.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: COMPANY_ID },
        data: expect.objectContaining({
          name: 'Acme Global',
          verifiedStatus: CompanyVerificationStatus.PENDING,
          rejectReason: null,
        }),
      }),
    );
  });

  it('does not turn a REJECTED company into an implicit resubmission', async () => {
    transaction.companyMember.findUnique.mockResolvedValue({
      companyId: COMPANY_ID,
      role: CompanyMemberRole.OWNER,
      company: {
        name: 'Acme Vietnam',
        taxCode: '0312345678',
        logoFileId: null,
        verifiedStatus: CompanyVerificationStatus.REJECTED,
        media: [],
      },
    });
    transaction.company.update.mockResolvedValue(
      companyRecord({
        name: 'Acme Global',
        verifiedStatus: CompanyVerificationStatus.REJECTED,
        rejectReason: 'Missing legal document',
      }),
    );

    await service.update(RECRUITER_ID, COMPANY_ID, {
      name: 'Acme Global',
    });

    const updateData = transaction.company.update.mock.calls[0][0].data;
    expect(updateData.verifiedStatus).toBeUndefined();
    expect(updateData.rejectReason).toBeUndefined();
  });

  it('rejects updates from a non-owner member', async () => {
    transaction.companyMember.findUnique.mockResolvedValue({
      companyId: COMPANY_ID,
      role: CompanyMemberRole.MEMBER,
      company: {
        name: 'Acme Vietnam',
        taxCode: '0312345678',
        verifiedStatus: CompanyVerificationStatus.PENDING,
      },
    });

    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        description: 'Unauthorized change',
      }),
    ).rejects.toMatchObject({
      code: 'COMPANY_OWNER_REQUIRED',
    });
    expect(transaction.company.update).not.toHaveBeenCalled();
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
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('checks duplicate references against the existing logo and media', async () => {
    const existingLogoFileId = '6105e846-3bb5-4dc0-a6ed-d0f0148c5bc8';
    transaction.companyMember.findUnique.mockResolvedValue({
      companyId: COMPANY_ID,
      role: CompanyMemberRole.OWNER,
      company: {
        name: 'Acme Vietnam',
        taxCode: '0312345678',
        logoFileId: existingLogoFileId,
        verifiedStatus: CompanyVerificationStatus.PENDING,
        media: [],
      },
    });

    await expect(
      service.update(RECRUITER_ID, COMPANY_ID, {
        media: [
          {
            fileId: existingLogoFileId,
            url: 'https://cdn.example/image',
            type: CompanyMediaType.IMAGE,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_MEDIA_REFERENCE',
    });
    expect(transaction.company.update).not.toHaveBeenCalled();
  });

  it('enforces the media limits and unique file references', async () => {
    const videoIds = [
      '9a3b4da7-5e84-4b2c-9abd-c39afc8fc501',
      '9a3b4da7-5e84-4b2c-9abd-c39afc8fc502',
    ];
    const videos = videoIds.map((fileId, index) => ({
      fileId,
      url: 'https://cdn.example/video-' + index,
      type: CompanyMediaType.VIDEO,
    }));

    await expect(
      service.create(RECRUITER_ID, createDto({ media: videos })),
    ).rejects.toMatchObject({
      code: 'MEDIA_LIMIT_EXCEEDED',
    });

    const duplicateFileId = '6105e846-3bb5-4dc0-a6ed-d0f0148c5bc8';
    await expect(
      service.create(
        RECRUITER_ID,
        createDto({
          logo: {
            fileId: duplicateFileId,
            url: 'https://cdn.example/logo',
          },
          media: [
            {
              fileId: duplicateFileId,
              url: 'https://cdn.example/image',
              type: CompanyMediaType.IMAGE,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_MEDIA_REFERENCE',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
