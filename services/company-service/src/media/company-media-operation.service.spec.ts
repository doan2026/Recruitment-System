import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CompanyMediaAssetType,
  CompanyMediaOperation,
  CompanyMediaOperationKind,
} from '@prisma/client';
import { ApiException } from '../common/errors/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyMediaClient } from './company-media.client';
import { CompanyMediaOperationService } from './company-media-operation.service';

const COMPANY_ID = '90eec7f1-fb6e-49d0-89ff-7d65d2438ff7';
const FILE_ID = '6105e846-3bb5-4dc0-a6ed-d0f0148c5bc8';
const REFERENCE_ID = 'f86befcc-d2eb-472a-895f-5d581c47c39b';
const BINDING_GENERATION_ID = 'd75eed6a-4ae5-4aef-9e72-92318223b5ba';
const OPERATION_ID = '9a3b4da7-5e84-4b2c-9abd-c39afc8fc501';
const NOW = new Date('2026-08-28T00:00:00.000Z');

const operation = (
  overrides: Partial<CompanyMediaOperation> = {},
): CompanyMediaOperation => ({
  id: OPERATION_ID,
  kind: CompanyMediaOperationKind.DETACH_CLEANUP,
  companyId: COMPANY_ID,
  fileId: FILE_ID,
  assetType: CompanyMediaAssetType.COMPANY_LOGO,
  referenceType: 'COMPANY_LOGO',
  referenceId: BINDING_GENERATION_ID,
  localMediaId: null,
  mediaReferenceId: REFERENCE_ID,
  attemptCount: 1,
  nextAttemptAt: NOW,
  leaseToken: '80a6b6c6-b46c-4fa4-b3d2-f6492cd98a4c',
  leaseExpiresAt: new Date('2026-08-28T00:01:00.000Z'),
  lastErrorCode: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const uploadIntentCleanupOperation = (
  overrides: Partial<CompanyMediaOperation> = {},
): CompanyMediaOperation =>
  operation({
    id: FILE_ID,
    kind: CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP,
    referenceType: 'COMPANY_UPLOAD_INTENT',
    referenceId: FILE_ID,
    mediaReferenceId: null,
    ...overrides,
  });

describe('CompanyMediaOperationService', () => {
  let prisma: {
    $transaction: jest.Mock;
    companyMediaOperation: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    company: { findFirst: jest.Mock };
    companyMedia: { findFirst: jest.Mock };
  };
  let transaction: {
    companyMediaOperation: { deleteMany: jest.Mock };
    companyMediaUploadIntent: { deleteMany: jest.Mock };
  };
  let media: {
    verifyCompanyFile: jest.Mock;
    bindCompanyFile: jest.Mock;
    releaseReference: jest.Mock;
    deleteCompanyFile: jest.Mock;
  };
  let service: CompanyMediaOperationService;

  beforeEach(() => {
    transaction = {
      companyMediaOperation: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      companyMediaUploadIntent: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      $transaction: jest.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
      companyMediaOperation: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      company: { findFirst: jest.fn() },
      companyMedia: { findFirst: jest.fn() },
    };
    media = {
      verifyCompanyFile: jest.fn().mockResolvedValue({ id: FILE_ID }),
      bindCompanyFile: jest.fn().mockResolvedValue({ id: REFERENCE_ID }),
      releaseReference: jest.fn().mockResolvedValue(undefined),
      deleteCompanyFile: jest.fn().mockResolvedValue(undefined),
    };
    service = new CompanyMediaOperationService(
      prisma as unknown as PrismaService,
      media as unknown as CompanyMediaClient,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
    );
  });

  const arrangeClaim = (claimed: CompanyMediaOperation): void => {
    prisma.companyMediaOperation.findFirst
      .mockResolvedValueOnce(claimed)
      .mockResolvedValueOnce(claimed)
      .mockResolvedValueOnce(null);
    prisma.companyMediaOperation.updateMany.mockResolvedValueOnce({ count: 1 });
  };

  it('does not process a candidate when another instance wins its lease', async () => {
    prisma.companyMediaOperation.findFirst
      .mockResolvedValueOnce(operation())
      .mockResolvedValueOnce(null);
    prisma.companyMediaOperation.updateMany.mockResolvedValueOnce({ count: 0 });

    await service.processDueOnce();

    expect(media.releaseReference).not.toHaveBeenCalled();
    expect(media.deleteCompanyFile).not.toHaveBeenCalled();
  });

  it('drops a stale operation without releasing an exact local attachment', async () => {
    const claimed = operation({
      kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
    });
    arrangeClaim(claimed);
    prisma.company.findFirst.mockResolvedValue({ id: COMPANY_ID });

    await service.processDueOnce();

    expect(media.releaseReference).not.toHaveBeenCalled();
    expect(media.deleteCompanyFile).not.toHaveBeenCalled();
    expect(prisma.companyMediaOperation.deleteMany).toHaveBeenCalledWith({
      where: { id: OPERATION_ID, leaseToken: claimed.leaseToken },
    });
  });

  it('does not release a stale logo DETACH when its exact reference is attached again', async () => {
    const claimed = operation();
    arrangeClaim(claimed);
    prisma.company.findFirst.mockResolvedValue({ id: COMPANY_ID });

    await service.processDueOnce();

    expect(claimed.referenceId).toBe(BINDING_GENERATION_ID);
    expect(media.releaseReference).not.toHaveBeenCalled();
    expect(media.deleteCompanyFile).not.toHaveBeenCalled();
    expect(prisma.companyMediaOperation.deleteMany).toHaveBeenCalledWith({
      where: { id: OPERATION_ID, leaseToken: claimed.leaseToken },
    });
  });

  it('recovers an unpersisted bind before checking the local attachment guard', async () => {
    const claimed = operation({
      kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
      mediaReferenceId: null,
    });
    arrangeClaim(claimed);
    prisma.companyMediaOperation.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.company.findFirst.mockResolvedValue({ id: COMPANY_ID });

    await service.processDueOnce();

    expect(media.verifyCompanyFile).toHaveBeenCalledWith(
      FILE_ID,
      COMPANY_ID,
      CompanyMediaAssetType.COMPANY_LOGO,
    );
    expect(media.bindCompanyFile).toHaveBeenCalledWith(
      FILE_ID,
      COMPANY_ID,
      CompanyMediaAssetType.COMPANY_LOGO,
      'COMPANY_LOGO',
      BINDING_GENERATION_ID,
    );
    expect(media.releaseReference).not.toHaveBeenCalled();
    expect(media.deleteCompanyFile).not.toHaveBeenCalled();
    expect(prisma.companyMediaOperation.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does not blindly delete when an unpersisted bind is terminally invalid', async () => {
    const claimed = operation({
      kind: CompanyMediaOperationKind.ATTACH_COMPENSATION,
      mediaReferenceId: null,
    });
    arrangeClaim(claimed);
    media.verifyCompanyFile.mockRejectedValue(
      new ApiException(
        'FILE_OWNERSHIP_MISMATCH',
        'not this company file',
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    );

    await service.processDueOnce();

    expect(media.bindCompanyFile).not.toHaveBeenCalled();
    expect(media.releaseReference).not.toHaveBeenCalled();
    expect(media.deleteCompanyFile).not.toHaveBeenCalled();
    expect(prisma.companyMediaOperation.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('releases a detached reference but preserves a file reused locally', async () => {
    const claimed = operation();
    arrangeClaim(claimed);
    prisma.company.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: COMPANY_ID });
    prisma.companyMedia.findFirst.mockResolvedValue(null);

    await service.processDueOnce();

    expect(media.releaseReference).toHaveBeenCalledWith(REFERENCE_ID);
    expect(media.deleteCompanyFile).not.toHaveBeenCalled();
    expect(prisma.companyMediaOperation.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('backs off with a redacted stable error code when Media is unavailable', async () => {
    const claimed = operation();
    arrangeClaim(claimed);
    prisma.company.findFirst.mockResolvedValue(null);
    media.releaseReference.mockRejectedValue(
      new ApiException(
        'MEDIA_SERVICE_UNAVAILABLE',
        'upstream included sensitive diagnostics',
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
    );
    prisma.companyMediaOperation.updateMany.mockResolvedValueOnce({ count: 1 });

    await service.processDueOnce();

    expect(media.deleteCompanyFile).not.toHaveBeenCalled();
    expect(prisma.companyMediaOperation.deleteMany).not.toHaveBeenCalled();
    expect(prisma.companyMediaOperation.updateMany).toHaveBeenLastCalledWith({
      where: { id: OPERATION_ID, leaseToken: claimed.leaseToken },
      data: expect.objectContaining({
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: 'MEDIA_SERVICE_UNAVAILABLE',
      }),
    });
  });

  it('treats an ownership mismatch during delete as terminal-safe', async () => {
    const claimed = operation();
    arrangeClaim(claimed);
    prisma.company.findFirst.mockResolvedValue(null);
    prisma.companyMedia.findFirst.mockResolvedValue(null);
    media.deleteCompanyFile.mockRejectedValue(
      new ApiException(
        'FILE_OWNERSHIP_MISMATCH',
        'not this company file',
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    );

    await service.processDueOnce();

    expect(media.releaseReference).toHaveBeenCalledWith(REFERENCE_ID);
    expect(prisma.companyMediaOperation.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('deletes an abandoned confirmed upload and its intent to recover Media quota', async () => {
    const claimed = uploadIntentCleanupOperation();
    arrangeClaim(claimed);
    prisma.company.findFirst.mockResolvedValue(null);
    prisma.companyMedia.findFirst.mockResolvedValue(null);

    await service.processDueOnce();

    expect(media.deleteCompanyFile).toHaveBeenCalledWith(
      FILE_ID,
      COMPANY_ID,
      CompanyMediaAssetType.COMPANY_LOGO,
    );
    expect(transaction.companyMediaUploadIntent.deleteMany).toHaveBeenCalledWith({
      where: {
        fileId: FILE_ID,
        companyId: COMPANY_ID,
        assetType: CompanyMediaAssetType.COMPANY_LOGO,
      },
    });
    expect(transaction.companyMediaOperation.deleteMany).toHaveBeenCalledWith({
      where: {
        id: FILE_ID,
        kind: CompanyMediaOperationKind.UPLOAD_INTENT_CLEANUP,
        leaseToken: claimed.leaseToken,
      },
    });
  });

  it('consumes an expired upload intent without deleting a locally attached file', async () => {
    const claimed = uploadIntentCleanupOperation();
    arrangeClaim(claimed);
    prisma.company.findFirst.mockResolvedValue({ id: COMPANY_ID });
    prisma.companyMedia.findFirst.mockResolvedValue(null);

    await service.processDueOnce();

    expect(media.deleteCompanyFile).not.toHaveBeenCalled();
    expect(transaction.companyMediaUploadIntent.deleteMany).toHaveBeenCalledTimes(
      1,
    );
    expect(transaction.companyMediaOperation.deleteMany).toHaveBeenCalledTimes(
      1,
    );
  });

  it('deletes the matching intent after retry changes the operation schedule', async () => {
    const firstAttempt = uploadIntentCleanupOperation();
    arrangeClaim(firstAttempt);
    prisma.company.findFirst.mockResolvedValue(null);
    prisma.companyMedia.findFirst.mockResolvedValue(null);
    media.deleteCompanyFile.mockRejectedValueOnce(
      new ApiException(
        'MEDIA_SERVICE_UNAVAILABLE',
        'temporary outage',
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
    );
    prisma.companyMediaOperation.updateMany.mockResolvedValueOnce({ count: 1 });

    await service.processDueOnce();
    expect(transaction.companyMediaUploadIntent.deleteMany).not.toHaveBeenCalled();

    const retried = uploadIntentCleanupOperation({
      attemptCount: 2,
      nextAttemptAt: new Date(NOW.getTime() + 5_000),
    });
    arrangeClaim(retried);
    await service.processDueOnce();

    expect(transaction.companyMediaUploadIntent.deleteMany).toHaveBeenCalledWith({
      where: {
        fileId: FILE_ID,
        companyId: COMPANY_ID,
        assetType: CompanyMediaAssetType.COMPANY_LOGO,
      },
    });
  });

  it('rejects a lease shorter than the four-call recovery deadline', () => {
    const values: Record<string, string> = {
      MEDIA_REQUEST_TIMEOUT_MS: '10000',
      COMPANY_MEDIA_OPERATION_LEASE_SECONDS: '44',
    };

    expect(
      () =>
        new CompanyMediaOperationService(
          prisma as unknown as PrismaService,
          media as unknown as CompanyMediaClient,
          {
            get: jest.fn((name: string) => values[name]),
          } as unknown as ConfigService,
        ),
    ).toThrow('Company media operation configuration is invalid');
  });
});
