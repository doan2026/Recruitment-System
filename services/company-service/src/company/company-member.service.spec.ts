import {
  CompanyAuditAction,
  CompanyInvitationStatus,
  CompanyMemberRole,
  CompanyVerificationStatus,
} from '@prisma/client';
import { HttpStatus } from '@nestjs/common';
import { CurrentAuthAccountClient } from '../common/auth/current-auth-account.client';
import { SystemRole } from '../common/auth/system-role.enum';
import { ApiException } from '../common/errors/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyMemberService } from './company-member.service';

const OWNER_ID = '18c604a4-4be6-4c3d-85ea-c1f45daf17c8';
const MEMBER_ID = '35ed14a5-b031-4789-bec5-a80a1c19d60b';
const OTHER_ID = 'b48e3158-9f12-4fdb-b616-4944918cadc8';
const COMPANY_ID = '90eec7f1-fb6e-49d0-89ff-7d65d2438ff7';
const INVITATION_ID = 'cc38030f-2af0-451a-8e97-50c17ff95d0e';
const NOW = new Date('2026-08-24T00:00:00.000Z');
const ACCESS_TOKEN = 'header.payload.signature';

const memberRecord = (
  userId: string,
  role: CompanyMemberRole,
) => ({
  id: userId,
  companyId: COMPANY_ID,
  userId,
  role,
  joinedAt: NOW,
});

const invitationRecord = (
  overrides: Record<string, unknown> = {},
) => ({
  id: INVITATION_ID,
  companyId: COMPANY_ID,
  email: 'member@example.com',
  normalizedEmail: 'member@example.com',
  emailNormalizationVersion: 1,
  status: CompanyInvitationStatus.PENDING,
  tokenHash: 'a'.repeat(64),
  invitedBy: OWNER_ID,
  acceptedBy: null,
  expiresAt: new Date(Date.now() + 60_000),
  acceptedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  company: {
    id: COMPANY_ID,
    name: 'Acme Vietnam',
    verifiedStatus: CompanyVerificationStatus.VERIFIED,
  },
  ...overrides,
});

describe('CompanyMemberService', () => {
  let service: CompanyMemberService;
  let prisma: {
    $transaction: jest.Mock;
    companyMember: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let currentAuthAccount: {
    getCurrentRecruiter: jest.Mock;
  };
  let transaction: {
    companyMember: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    companyInvitation: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
    company: { update: jest.Mock };
    companyAuditLog: { create: jest.Mock };
  };

  beforeEach(() => {
    transaction = {
      companyMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      companyInvitation: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      company: {
        update: jest.fn().mockResolvedValue({ aggregateVersion: 7 }),
      },
      companyAuditLog: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn(
        async (
          callback: (client: typeof transaction) => Promise<unknown>,
        ) => callback(transaction),
      ),
      companyMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    currentAuthAccount = {
      getCurrentRecruiter: jest.fn().mockResolvedValue({
        id: MEMBER_ID,
        normalizedEmail: 'member@example.com',
      }),
    };
    service = new CompanyMemberService(
      prisma as unknown as PrismaService,
      currentAuthAccount as unknown as CurrentAuthAccountClient,
    );
  });

  it('creates an invitation as OWNER and persists only a token hash', async () => {
    transaction.companyMember.findUnique.mockResolvedValue(
      memberRecord(OWNER_ID, CompanyMemberRole.OWNER),
    );
    transaction.companyInvitation.upsert.mockImplementation(
      async ({ create }) => invitationRecord(create),
    );

    const result = await service.invite(OWNER_ID, COMPANY_ID, {
      email: '  Member@Example.com ',
    });

    const upsert =
      transaction.companyInvitation.upsert.mock.calls[0][0];
    expect(upsert.create.normalizedEmail).toBe('member@example.com');
    expect(upsert.create.emailNormalizationVersion).toBe(1);
    expect(upsert.create.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(upsert.create.tokenHash).not.toBe(result.invitationToken);
    expect(result.invitationToken.length).toBeGreaterThanOrEqual(32);
  });

  it('uses Auth-compatible NFC email canonicalization without compatibility folding', async () => {
    transaction.companyMember.findUnique.mockResolvedValue(
      memberRecord(OWNER_ID, CompanyMemberRole.OWNER),
    );
    transaction.companyInvitation.upsert.mockImplementation(
      async ({ create }) => invitationRecord(create),
    );

    await service.invite(OWNER_ID, COMPANY_ID, {
      email: '  Me\u0301mber@Example.com ',
    });
    const canonical =
      transaction.companyInvitation.upsert.mock.calls[0][0].create
        .normalizedEmail;
    expect(canonical).toBe('mémber@example.com');

    await service.invite(OWNER_ID, COMPANY_ID, {
      email: 'ｍember@example.com',
    });
    const compatibilityDistinct =
      transaction.companyInvitation.upsert.mock.calls[1][0].create
        .normalizedEmail;
    expect(compatibilityDistinct).toBe('ｍember@example.com');
    expect(compatibilityDistinct).not.toBe('member@example.com');
  });

  it('does not let a MEMBER invite another recruiter', async () => {
    transaction.companyMember.findUnique.mockResolvedValue(
      memberRecord(OWNER_ID, CompanyMemberRole.MEMBER),
    );

    await expect(
      service.invite(OWNER_ID, COMPANY_ID, {
        email: 'member@example.com',
      }),
    ).rejects.toMatchObject({ code: 'COMPANY_OWNER_REQUIRED' });
    expect(transaction.companyInvitation.upsert).not.toHaveBeenCalled();
  });

  it('accepts an active invitation and creates a MEMBER atomically', async () => {
    transaction.companyInvitation.findUnique.mockResolvedValue(
      invitationRecord(),
    );
    transaction.companyMember.findUnique.mockResolvedValue(null);
    transaction.companyMember.create.mockResolvedValue(
      memberRecord(MEMBER_ID, CompanyMemberRole.MEMBER),
    );
    transaction.companyInvitation.update.mockResolvedValue(
      invitationRecord({
        status: CompanyInvitationStatus.ACCEPTED,
        acceptedBy: MEMBER_ID,
      }),
    );

    const result = await service.accept(MEMBER_ID, ACCESS_TOKEN, {
      token: 'x'.repeat(43),
    });

    expect(currentAuthAccount.getCurrentRecruiter).toHaveBeenCalledWith(
      ACCESS_TOKEN,
      MEMBER_ID,
    );
    expect(transaction.companyMember.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_ID,
        userId: MEMBER_ID,
        role: CompanyMemberRole.MEMBER,
      },
    });
    expect(transaction.companyInvitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CompanyInvitationStatus.ACCEPTED,
          acceptedBy: MEMBER_ID,
        }),
      }),
    );
    expect(result).toEqual({
      companyId: COMPANY_ID,
      name: 'Acme Vietnam',
      verifiedStatus: CompanyVerificationStatus.VERIFIED,
      memberRole: CompanyMemberRole.MEMBER,
    });
  });

  it('fails before opening a transaction when durable Auth recheck fails', async () => {
    currentAuthAccount.getCurrentRecruiter.mockRejectedValue(
      new ApiException(
        'AUTH_ACCOUNT_INACTIVE',
        'The authenticated account cannot accept invitations',
        HttpStatus.FORBIDDEN,
      ),
    );

    await expect(
      service.accept(MEMBER_ID, ACCESS_TOKEN, {
        token: 'x'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_INACTIVE' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(transaction.companyMember.create).not.toHaveBeenCalled();
    expect(transaction.companyInvitation.update).not.toHaveBeenCalled();
  });

  it('denies a stolen invitation token when the durable Auth email differs', async () => {
    currentAuthAccount.getCurrentRecruiter.mockResolvedValue({
      id: MEMBER_ID,
      normalizedEmail: 'attacker@example.com',
    });
    transaction.companyInvitation.findUnique.mockResolvedValue(
      invitationRecord(),
    );

    await expect(
      service.accept(MEMBER_ID, ACCESS_TOKEN, {
        token: 'x'.repeat(43),
      }),
    ).rejects.toMatchObject({
      code: 'INVITATION_EMAIL_MISMATCH',
      details: null,
    });
    expect(transaction.companyMember.findUnique).not.toHaveBeenCalled();
    expect(transaction.companyMember.create).not.toHaveBeenCalled();
    expect(transaction.companyInvitation.update).not.toHaveBeenCalled();
  });

  it('requires every pending pre-NFC invitation to be reissued', async () => {
    transaction.companyInvitation.findUnique.mockResolvedValue(
      invitationRecord({ emailNormalizationVersion: null }),
    );

    await expect(
      service.accept(MEMBER_ID, ACCESS_TOKEN, {
        token: 'x'.repeat(43),
      }),
    ).rejects.toMatchObject({
      code: 'INVITATION_REISSUE_REQUIRED',
      details: null,
    });
    expect(transaction.companyMember.findUnique).not.toHaveBeenCalled();
    expect(transaction.companyMember.create).not.toHaveBeenCalled();
    expect(transaction.companyInvitation.update).not.toHaveBeenCalled();
  });

  it('does not collapse compatibility-distinct Auth emails during acceptance', async () => {
    transaction.companyInvitation.findUnique.mockResolvedValue(
      invitationRecord({
        email: 'member@example.com',
        normalizedEmail: 'member@example.com',
      }),
    );
    currentAuthAccount.getCurrentRecruiter.mockResolvedValue({
      id: MEMBER_ID,
      normalizedEmail: 'ｍember@example.com',
    });

    await expect(
      service.accept(MEMBER_ID, ACCESS_TOKEN, {
        token: 'x'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'INVITATION_EMAIL_MISMATCH' });
    expect(transaction.companyMember.create).not.toHaveBeenCalled();
  });

  it('rechecks durable identity before a legacy accepted retry', async () => {
    transaction.companyInvitation.findUnique.mockResolvedValue(
      invitationRecord({
        emailNormalizationVersion: 0,
        status: CompanyInvitationStatus.ACCEPTED,
        acceptedBy: MEMBER_ID,
      }),
    );
    transaction.companyMember.findUnique.mockResolvedValue(
      memberRecord(MEMBER_ID, CompanyMemberRole.MEMBER),
    );

    await expect(
      service.accept(MEMBER_ID, ACCESS_TOKEN, {
        token: 'x'.repeat(43),
      }),
    ).resolves.toMatchObject({
      companyId: COMPANY_ID,
      memberRole: CompanyMemberRole.MEMBER,
    });
    expect(currentAuthAccount.getCurrentRecruiter).toHaveBeenCalledTimes(1);
    expect(transaction.companyMember.create).not.toHaveBeenCalled();
    expect(transaction.companyInvitation.update).not.toHaveBeenCalled();
  });

  it('rejects an accepted retry after the durable account email changes', async () => {
    currentAuthAccount.getCurrentRecruiter.mockResolvedValue({
      id: MEMBER_ID,
      normalizedEmail: 'changed@example.com',
    });
    transaction.companyInvitation.findUnique.mockResolvedValue(
      invitationRecord({
        status: CompanyInvitationStatus.ACCEPTED,
        acceptedBy: MEMBER_ID,
      }),
    );

    await expect(
      service.accept(MEMBER_ID, ACCESS_TOKEN, {
        token: 'x'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'INVITATION_EMAIL_MISMATCH' });
    expect(transaction.companyMember.findUnique).not.toHaveBeenCalled();
    expect(transaction.companyMember.create).not.toHaveBeenCalled();
    expect(transaction.companyInvitation.update).not.toHaveBeenCalled();
  });

  it('marks an expired legacy invitation before requiring reissue', async () => {
    transaction.companyInvitation.findUnique.mockResolvedValue(
      invitationRecord({
        emailNormalizationVersion: null,
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );
    transaction.companyInvitation.update.mockResolvedValue(
      invitationRecord({ status: CompanyInvitationStatus.EXPIRED }),
    );

    await expect(
      service.accept(MEMBER_ID, ACCESS_TOKEN, {
        token: 'x'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
    expect(transaction.companyInvitation.update).toHaveBeenCalledWith({
      where: { id: INVITATION_ID },
      data: { status: CompanyInvitationStatus.EXPIRED },
    });
    expect(transaction.companyMember.create).not.toHaveBeenCalled();
  });

  it('blocks acceptance when recruiter already belongs to a company', async () => {
    transaction.companyInvitation.findUnique.mockResolvedValue(
      invitationRecord(),
    );
    transaction.companyMember.findUnique.mockResolvedValue({
      companyId: 'a4c1e4e7-00f1-4387-826d-d43164047522',
    });

    await expect(
      service.accept(MEMBER_ID, ACCESS_TOKEN, {
        token: 'x'.repeat(43),
      }),
    ).rejects.toMatchObject({
      code: 'RECRUITER_ALREADY_HAS_COMPANY',
    });
    expect(transaction.companyMember.create).not.toHaveBeenCalled();
  });

  it('removes a MEMBER but never removes the OWNER', async () => {
    transaction.companyMember.findUnique
      .mockResolvedValueOnce(
        memberRecord(OWNER_ID, CompanyMemberRole.OWNER),
      )
      .mockResolvedValueOnce(
        memberRecord(MEMBER_ID, CompanyMemberRole.MEMBER),
      );

    const result = await service.removeMember(
      OWNER_ID,
      COMPANY_ID,
      MEMBER_ID,
    );

    expect(transaction.companyMember.delete).toHaveBeenCalledWith({
      where: { userId: MEMBER_ID },
    });
    expect(result).toEqual({ removedUserId: MEMBER_ID });

    transaction.companyMember.findUnique
      .mockResolvedValueOnce(
        memberRecord(OWNER_ID, CompanyMemberRole.OWNER),
      )
      .mockResolvedValueOnce(
        memberRecord(OWNER_ID, CompanyMemberRole.OWNER),
      );

    await expect(
      service.removeMember(OWNER_ID, COMPANY_ID, OWNER_ID),
    ).rejects.toMatchObject({
      code: 'COMPANY_OWNER_CANNOT_BE_REMOVED',
    });
  });

  it('transfers ownership to an existing MEMBER in one transaction', async () => {
    transaction.companyMember.findUnique
      .mockResolvedValueOnce(
        memberRecord(OWNER_ID, CompanyMemberRole.OWNER),
      )
      .mockResolvedValueOnce(
        memberRecord(MEMBER_ID, CompanyMemberRole.MEMBER),
      );
    transaction.companyMember.findMany.mockResolvedValue([
      memberRecord(MEMBER_ID, CompanyMemberRole.OWNER),
      memberRecord(OWNER_ID, CompanyMemberRole.MEMBER),
    ]);

    const result = await service.transferOwnership(
      OWNER_ID,
      COMPANY_ID,
      MEMBER_ID,
    );

    expect(transaction.companyMember.update).toHaveBeenNthCalledWith(
      1,
      {
        where: { userId: OWNER_ID },
        data: { role: CompanyMemberRole.MEMBER },
      },
    );
    expect(transaction.companyMember.update).toHaveBeenNthCalledWith(
      2,
      {
        where: { userId: MEMBER_ID },
        data: { role: CompanyMemberRole.OWNER },
      },
    );
    expect(transaction.company.update).toHaveBeenCalledWith({
      where: { id: COMPANY_ID },
      data: { aggregateVersion: { increment: 1 } },
      select: { aggregateVersion: true },
    });
    expect(transaction.companyAuditLog.create).toHaveBeenCalledWith({
      data: {
        companyId: COMPANY_ID,
        action: CompanyAuditAction.OWNERSHIP_TRANSFERRED,
        actorId: OWNER_ID,
        targetUserId: MEMBER_ID,
        resultingAggregateVersion: 7,
        fromVerificationStatus: null,
        toVerificationStatus: null,
        reason: null,
      },
    });
    expect(result[0].role).toBe(CompanyMemberRole.OWNER);
  });

  it('fails the ownership transaction when its audit insert fails', async () => {
    transaction.companyMember.findUnique
      .mockResolvedValueOnce(
        memberRecord(OWNER_ID, CompanyMemberRole.OWNER),
      )
      .mockResolvedValueOnce(
        memberRecord(MEMBER_ID, CompanyMemberRole.MEMBER),
      );
    transaction.companyAuditLog.create.mockRejectedValue(
      new Error('forced audit failure'),
    );

    await expect(
      service.transferOwnership(OWNER_ID, COMPANY_ID, MEMBER_ID),
    ).rejects.toThrow('forced audit failure');
    expect(transaction.companyMember.findMany).not.toHaveBeenCalled();
  });

  it('allows self lookup and ADMIN lookup but blocks other recruiters', async () => {
    prisma.companyMember.findUnique.mockResolvedValue({
      ...memberRecord(MEMBER_ID, CompanyMemberRole.MEMBER),
      company: {
        id: COMPANY_ID,
        name: 'Acme Vietnam',
        verifiedStatus: CompanyVerificationStatus.VERIFIED,
      },
    });

    const ownCompany = await service.getByUser(
      MEMBER_ID,
      SystemRole.RECRUITER,
      MEMBER_ID,
    );
    expect(ownCompany.companyId).toBe(COMPANY_ID);

    const adminCompany = await service.getByUser(
      OWNER_ID,
      SystemRole.ADMIN,
      MEMBER_ID,
    );
    expect(adminCompany.companyId).toBe(COMPANY_ID);

    await expect(
      service.getByUser(
        OTHER_ID,
        SystemRole.RECRUITER,
        MEMBER_ID,
      ),
    ).rejects.toMatchObject({
      code: 'RECRUITER_COMPANY_ACCESS_DENIED',
    });
  });
});
