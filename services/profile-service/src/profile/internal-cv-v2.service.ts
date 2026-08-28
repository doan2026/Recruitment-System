import { HttpStatus, Injectable } from '@nestjs/common';
import { Cv, Prisma } from '@prisma/client';
import { ApiException } from '../common/http/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  InternalCvDto,
  VerifyInternalCvRequestDto,
} from './dto/internal-cv.dto';
import { InternalCvVerificationV2Dto } from './dto/internal-cv-v2.dto';

const PROFILE_SKILL_SNAPSHOT_SCHEMA_VERSION = 1 as const;
const PROFILE_SKILL_SNAPSHOT_LIMIT = 100;
const MEDIA_BACKED_CV = {
  fileUrl: null,
  mediaReferenceId: { not: null },
} satisfies Prisma.CvWhereInput;

@Injectable()
export class InternalCvV2Service {
  constructor(private readonly prisma: PrismaService) {}

  async verifyCandidateCv(
    authenticatedCandidateId: string,
    request: VerifyInternalCvRequestDto,
  ): Promise<InternalCvVerificationV2Dto> {
    const candidateId = this.canonicalUuid(request.candidateId);
    const cvId = this.canonicalUuid(request.cvId);
    if (
      this.canonicalUuid(authenticatedCandidateId) !== candidateId
    ) {
      throw new ApiException(
        'PROFILE_OWNER_REQUIRED',
        'The Candidate access token must belong to candidateId',
        HttpStatus.FORBIDDEN,
      );
    }

    const verified = await this.prisma.$transaction(
      async (transaction) => {
        const cv = await transaction.cv.findFirst({
          where: {
            id: cvId,
            userId: candidateId,
            isDeleted: false,
            ...MEDIA_BACKED_CV,
          },
        });
        if (!cv) return null;

        const profile = await transaction.profile.findUnique({
          where: { userId: candidateId },
          select: {
            aggregateVersion: true,
            skills: {
              select: { name: true },
              orderBy: [
                { sortOrder: 'asc' },
                { id: 'asc' },
              ],
              take: PROFILE_SKILL_SNAPSHOT_LIMIT + 1,
            },
          },
        });
        if (
          profile &&
          profile.skills.length > PROFILE_SKILL_SNAPSHOT_LIMIT
        ) {
          throw new ApiException(
            'PROFILE_SKILL_SNAPSHOT_INVALID',
            'Candidate skill snapshot exceeds the supported limit',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
        return profile ? { cv, profile } : null;
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );

    if (!verified) {
      return {
        candidateId,
        cvId,
        available: false,
        cv: null,
        profileSkillSnapshot: null,
      };
    }

    return {
      candidateId,
      cvId,
      available: true,
      cv: this.toInternalCv(verified.cv),
      profileSkillSnapshot: {
        schemaVersion: PROFILE_SKILL_SNAPSHOT_SCHEMA_VERSION,
        profileAggregateVersion: verified.profile.aggregateVersion,
        skills: verified.profile.skills.map(({ name }) => name),
      },
    };
  }

  private toInternalCv(cv: Cv): InternalCvDto {
    return {
      cvId: cv.id,
      candidateId: cv.userId,
      title: cv.title,
      type: cv.type,
      fileId: cv.fileId,
      isDefault: cv.isDefault,
      isDeleted: cv.isDeleted,
      firstUsedAt: cv.firstUsedAt?.toISOString() ?? null,
      aggregateVersion: cv.aggregateVersion,
      createdAt: cv.createdAt.toISOString(),
      updatedAt: cv.updatedAt.toISOString(),
    };
  }

  private canonicalUuid(value: string): string {
    return value.toLowerCase();
  }
}
