import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CompanyInvitation,
  CompanyInvitationStatus,
  CompanyMember,
  CompanyMemberRole,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { SystemRole } from '../common/auth/system-role.enum';
import { ApiException } from '../common/errors/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptCompanyInvitationDto } from './dto/accept-company-invitation.dto';
import {
  CompanyInvitationDto,
  CompanyMemberDto,
  CreatedCompanyInvitationDto,
  RecruiterCompanyDto,
} from './dto/company-member.dto';
import { InviteCompanyMemberDto } from './dto/invite-company-member.dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CompanyMemberService {
  constructor(private readonly prisma: PrismaService) {}

  async invite(
    ownerId: string,
    companyId: string,
    dto: InviteCompanyMemberDto,
  ): Promise<CreatedCompanyInvitationDto> {
    const email = dto.email.normalize('NFKC').trim().toLowerCase();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    try {
      const invitation = await this.prisma.$transaction(
        async (transaction) => {
          await this.requireOwner(transaction, ownerId, companyId);

          return transaction.companyInvitation.upsert({
            where: {
              companyId_normalizedEmail: {
                companyId,
                normalizedEmail: email,
              },
            },
            create: {
              companyId,
              email,
              normalizedEmail: email,
              tokenHash,
              invitedBy: ownerId,
              expiresAt,
            },
            update: {
              email,
              status: CompanyInvitationStatus.PENDING,
              tokenHash,
              invitedBy: ownerId,
              acceptedBy: null,
              acceptedAt: null,
              expiresAt,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return {
        ...this.toInvitation(invitation),
        invitationToken: token,
      };
    } catch (error) {
      this.throwPersistenceError(error);
    }
  }

  async listMembers(
    ownerId: string,
    companyId: string,
  ): Promise<CompanyMemberDto[]> {
    const members = await this.prisma.$transaction(
      async (transaction) => {
        await this.requireOwner(transaction, ownerId, companyId);
        return transaction.companyMember.findMany({
          where: { companyId },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return members.map((member) => this.toMember(member));
  }

  async accept(
    userId: string,
    dto: AcceptCompanyInvitationDto,
  ): Promise<RecruiterCompanyDto> {
    const tokenHash = this.hashToken(dto.token);

    try {
      const outcome = await this.prisma.$transaction(
        async (transaction) => {
          const invitation = await transaction.companyInvitation.findUnique({
            where: { tokenHash },
            include: {
              company: {
                select: {
                  id: true,
                  name: true,
                  verifiedStatus: true,
                },
              },
            },
          });

          if (!invitation) {
            throw new ApiException(
              'INVITATION_NOT_FOUND',
              'Company invitation was not found',
              HttpStatus.NOT_FOUND,
            );
          }

          if (
            invitation.status === CompanyInvitationStatus.ACCEPTED &&
            invitation.acceptedBy === userId
          ) {
            const membership =
              await transaction.companyMember.findUnique({
                where: { userId },
              });

            if (membership?.companyId === invitation.companyId) {
              return {
                expired: false as const,
                company: invitation.company,
                membership,
              };
            }
          }

          if (invitation.status !== CompanyInvitationStatus.PENDING) {
            throw new ApiException(
              'INVITATION_NOT_ACTIVE',
              'Company invitation is no longer active',
              HttpStatus.CONFLICT,
              { status: invitation.status },
            );
          }

          if (invitation.expiresAt.getTime() <= Date.now()) {
            await transaction.companyInvitation.update({
              where: { id: invitation.id },
              data: { status: CompanyInvitationStatus.EXPIRED },
            });
            return { expired: true as const };
          }

          const existingMembership =
            await transaction.companyMember.findUnique({
              where: { userId },
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

          const membership = await transaction.companyMember.create({
            data: {
              companyId: invitation.companyId,
              userId,
              role: CompanyMemberRole.MEMBER,
            },
          });
          await transaction.companyInvitation.update({
            where: { id: invitation.id },
            data: {
              status: CompanyInvitationStatus.ACCEPTED,
              acceptedBy: userId,
              acceptedAt: new Date(),
            },
          });

          return {
            expired: false as const,
            company: invitation.company,
            membership,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (outcome.expired) {
        throw new ApiException(
          'INVITATION_EXPIRED',
          'Company invitation has expired',
          HttpStatus.GONE,
        );
      }

      return {
        companyId: outcome.company.id,
        name: outcome.company.name,
        verifiedStatus: outcome.company.verifiedStatus,
        memberRole: outcome.membership.role,
      };
    } catch (error) {
      this.throwPersistenceError(error);
    }
  }

  async removeMember(
    ownerId: string,
    companyId: string,
    targetUserId: string,
  ): Promise<{ removedUserId: string }> {
    try {
      await this.prisma.$transaction(
        async (transaction) => {
          await this.requireOwner(transaction, ownerId, companyId);
          const target = await transaction.companyMember.findUnique({
            where: { userId: targetUserId },
          });

          if (!target || target.companyId !== companyId) {
            throw new ApiException(
              'COMPANY_MEMBER_NOT_FOUND',
              'Company member was not found',
              HttpStatus.NOT_FOUND,
            );
          }
          if (target.role === CompanyMemberRole.OWNER) {
            throw new ApiException(
              'COMPANY_OWNER_CANNOT_BE_REMOVED',
              'Transfer ownership before removing the current owner',
              HttpStatus.CONFLICT,
            );
          }

          await transaction.companyMember.delete({
            where: { userId: targetUserId },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return { removedUserId: targetUserId };
    } catch (error) {
      this.throwPersistenceError(error);
    }
  }

  async transferOwnership(
    ownerId: string,
    companyId: string,
    targetUserId: string,
  ): Promise<CompanyMemberDto[]> {
    if (ownerId === targetUserId) {
      throw new ApiException(
        'NEW_OWNER_REQUIRED',
        'Select another company member as the new owner',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const members = await this.prisma.$transaction(
        async (transaction) => {
          await this.requireOwner(transaction, ownerId, companyId);
          const target = await transaction.companyMember.findUnique({
            where: { userId: targetUserId },
          });

          if (
            !target ||
            target.companyId !== companyId ||
            target.role !== CompanyMemberRole.MEMBER
          ) {
            throw new ApiException(
              'NEW_OWNER_MUST_BE_MEMBER',
              'The new owner must be a MEMBER of this company',
              HttpStatus.CONFLICT,
            );
          }

          await transaction.companyMember.update({
            where: { userId: ownerId },
            data: { role: CompanyMemberRole.MEMBER },
          });
          await transaction.companyMember.update({
            where: { userId: targetUserId },
            data: { role: CompanyMemberRole.OWNER },
          });

          return transaction.companyMember.findMany({
            where: { companyId },
            orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return members.map((member) => this.toMember(member));
    } catch (error) {
      this.throwPersistenceError(error);
    }
  }

  async getByUser(
    requesterId: string,
    requesterRole: SystemRole,
    targetUserId: string,
  ): Promise<RecruiterCompanyDto> {
    if (
      requesterRole !== SystemRole.ADMIN &&
      requesterId !== targetUserId
    ) {
      throw new ApiException(
        'RECRUITER_COMPANY_ACCESS_DENIED',
        'Recruiters can only query their own company membership',
        HttpStatus.FORBIDDEN,
      );
    }

    const membership = await this.prisma.companyMember.findUnique({
      where: { userId: targetUserId },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            verifiedStatus: true,
          },
        },
      },
    });

    if (!membership) {
      throw new ApiException(
        'COMPANY_NOT_FOUND',
        'No company is associated with this recruiter',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      companyId: membership.company.id,
      name: membership.company.name,
      verifiedStatus: membership.company.verifiedStatus,
      memberRole: membership.role,
    };
  }

  private async requireOwner(
    client: Prisma.TransactionClient,
    userId: string,
    companyId: string,
  ): Promise<void> {
    const membership = await client.companyMember.findUnique({
      where: { userId },
      select: { companyId: true, role: true },
    });

    if (
      !membership ||
      membership.companyId !== companyId ||
      membership.role !== CompanyMemberRole.OWNER
    ) {
      throw new ApiException(
        'COMPANY_OWNER_REQUIRED',
        'Only the company owner can manage members',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private toMember(member: CompanyMember): CompanyMemberDto {
    return {
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt.toISOString(),
    };
  }

  private toInvitation(
    invitation: CompanyInvitation,
  ): CompanyInvitationDto {
    return {
      id: invitation.id,
      companyId: invitation.companyId,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
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
        'COMPANY_MEMBER_CONFLICT',
        'Company membership changed concurrently; retry the request',
        HttpStatus.CONFLICT,
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ApiException(
        'RECRUITER_ALREADY_HAS_COMPANY',
        'This recruiter already belongs to a company',
        HttpStatus.CONFLICT,
      );
    }

    throw error;
  }
}
