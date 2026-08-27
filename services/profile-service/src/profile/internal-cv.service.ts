import { HttpStatus, Injectable } from '@nestjs/common';
import { Cv, Prisma } from '@prisma/client';
import { ApiException } from '../common/http/api-exception';
import {
  ProfileMediaClient,
  ProfileMediaType,
} from '../media/profile-media.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  InternalCvDownloadDto,
  InternalCvDto,
  InternalCvVerificationDto,
  VerifyInternalCvRequestDto,
} from './dto/internal-cv.dto';

const MEDIA_BACKED_CV = {
  fileUrl: null,
  mediaReferenceId: { not: null },
} satisfies Prisma.CvWhereInput;

@Injectable()
export class InternalCvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: ProfileMediaClient,
  ) {}

  async verifyCandidateCv(
    authenticatedCandidateId: string,
    request: VerifyInternalCvRequestDto,
  ): Promise<InternalCvVerificationDto> {
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

    const cv = await this.prisma.cv.findFirst({
      where: {
        id: cvId,
        userId: candidateId,
        isDeleted: false,
        ...MEDIA_BACKED_CV,
      },
    });
    return {
      candidateId,
      cvId,
      available: cv !== null,
      cv: cv ? this.toInternalCv(cv) : null,
    };
  }

  async listCandidateCvs(
    candidateIdInput: string,
  ): Promise<InternalCvDto[]> {
    const candidateId = this.canonicalUuid(candidateIdInput);
    const cvs = await this.prisma.$transaction(
      (transaction) =>
        transaction.cv.findMany({
          where: {
            userId: candidateId,
            isDeleted: false,
            ...MEDIA_BACKED_CV,
          },
          orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' },
            { id: 'asc' },
          ],
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return cvs.map((cv) => this.toInternalCv(cv));
  }

  async getCandidateCv(
    candidateIdInput: string,
    cvIdInput: string,
  ): Promise<InternalCvDto> {
    return this.toInternalCv(
      await this.findMediaBackedCv(candidateIdInput, cvIdInput),
    );
  }

  async createDownloadUrl(
    candidateIdInput: string,
    cvIdInput: string,
  ): Promise<InternalCvDownloadDto> {
    const cv = await this.findMediaBackedCv(
      candidateIdInput,
      cvIdInput,
    );
    const download = await this.media.createUserDownloadUrl(
      cv.fileId,
      cv.userId,
      ProfileMediaType.CV,
    );
    return {
      candidateId: cv.userId,
      cvId: cv.id,
      url: download.url,
      expiresAt: download.expiresAt,
    };
  }

  private async findMediaBackedCv(
    candidateIdInput: string,
    cvIdInput: string,
  ): Promise<Cv> {
    const cv = await this.prisma.cv.findFirst({
      where: {
        id: this.canonicalUuid(cvIdInput),
        userId: this.canonicalUuid(candidateIdInput),
        ...MEDIA_BACKED_CV,
      },
    });
    if (!cv) {
      throw new ApiException(
        'CV_NOT_FOUND',
        'The requested CV was not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return cv;
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
