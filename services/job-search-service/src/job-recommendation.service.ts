import { HttpStatus, Injectable } from '@nestjs/common';
import { JobStatus, Prisma } from '@prisma/client';
import {
  AiRecommendationClientService,
  AiRecommendationCursorStaleError,
  AiRecommendationInvalidResponseError,
  AiRecommendationUnavailableError,
} from './ai-recommendation-client.service';
import { ApiException } from './common';
import {
  JobRecommendationFallbackReason,
  JobRecommendationQueryDto,
  JobRecommendationResultDto,
  JobRecommendationSource,
} from './job-recommendation.dto';
import { JobSearchItemDto } from './job-search.dto';
import {
  ProfileRecommendationClientService,
  ProfileRecommendationUnavailableError,
} from './profile-recommendation-client.service';
import { PrismaService } from './prisma.service';

const RECOMMENDATION_JOB_SELECT = {
  id: true,
  companyId: true,
  title: true,
  description: true,
  salaryMin: true,
  salaryMax: true,
  isNegotiable: true,
  currency: true,
  location: true,
  jobType: true,
  experienceYears: true,
  skills: true,
  deadline: true,
  publishedAt: true,
} satisfies Prisma.JobSelect;

type RecommendationJob = Prisma.JobGetPayload<{
  select: typeof RECOMMENDATION_JOB_SELECT;
}>;

@Injectable()
export class JobRecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileRecommendationClientService,
    private readonly ai: AiRecommendationClientService,
  ) {}

  isConfigured(): boolean {
    return this.ai.isConfigured();
  }

  async recommend(
    candidateId: string,
    authorization: string,
    query: JobRecommendationQueryDto,
    now = new Date(),
  ): Promise<JobRecommendationResultDto> {
    const isContinuation = query.cursor !== undefined;
    let cvId: string;
    try {
      const cv = await this.profiles.getPreferredCv(
        candidateId,
        authorization,
      );
      if (!cv) {
        if (isContinuation) this.throwCursorStale();
        return this.latest(
          query,
          JobRecommendationFallbackReason.NO_ACTIVE_CV,
          now,
        );
      }
      cvId = cv.cvId;
    } catch (error) {
      if (!(error instanceof ProfileRecommendationUnavailableError)) {
        throw error;
      }
      if (isContinuation) this.throwUnavailable();
      return this.latest(
        query,
        JobRecommendationFallbackReason.PROFILE_UNAVAILABLE,
        now,
      );
    }

    let recommendation;
    try {
      recommendation = await this.ai.recommendJobs(cvId, query);
    } catch (error) {
      if (error instanceof AiRecommendationCursorStaleError) {
        if (isContinuation) this.throwCursorStale();
        return this.latest(
          query,
          JobRecommendationFallbackReason.AI_RESPONSE_INVALID,
          now,
        );
      }
      if (error instanceof AiRecommendationInvalidResponseError) {
        if (isContinuation) this.throwUnavailable();
        return this.latest(
          query,
          JobRecommendationFallbackReason.AI_RESPONSE_INVALID,
          now,
        );
      }
      if (error instanceof AiRecommendationUnavailableError) {
        if (isContinuation) this.throwUnavailable();
        return this.latest(
          query,
          JobRecommendationFallbackReason.AI_UNAVAILABLE,
          now,
        );
      }
      throw error;
    }
    if (recommendation.items.length === 0) {
      if (recommendation.reason === null) {
        if (isContinuation) this.throwUnavailable();
        return this.latest(
          query,
          JobRecommendationFallbackReason.AI_RESPONSE_INVALID,
          now,
        );
      }
      if (isContinuation) this.throwCursorStale();
      return this.latest(
        query,
        JobRecommendationFallbackReason.AI_NOT_READY,
        now,
      );
    }

    const jobs = await this.prisma.job.findMany({
      select: RECOMMENDATION_JOB_SELECT,
      where: {
        ...this.activeFilters(query, now),
        id: { in: recommendation.items.map(({ jobId }) => jobId) },
      },
    });
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const items = recommendation.items.flatMap(({ jobId, score }) => {
      const job = jobsById.get(jobId);
      return job ? [this.toItem(job, score)] : [];
    });
    if (items.length === 0) {
      if (isContinuation) this.throwCursorStale();
      return this.latest(
        query,
        JobRecommendationFallbackReason.AI_RESULTS_STALE,
        now,
      );
    }
    return {
      items,
      nextCursor: recommendation.nextCursor,
      source: JobRecommendationSource.AI,
      fallbackReason: null,
    };
  }

  private throwCursorStale(): never {
    throw new ApiException(
      'RECOMMENDATION_CURSOR_STALE',
      'Recommendation cursor is stale',
      HttpStatus.CONFLICT,
    );
  }

  private throwUnavailable(): never {
    throw new ApiException(
      'RECOMMENDATION_UNAVAILABLE',
      'Recommendation service is temporarily unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private async latest(
    query: JobRecommendationQueryDto,
    fallbackReason: JobRecommendationFallbackReason,
    now: Date,
  ): Promise<JobRecommendationResultDto> {
    const jobs = await this.prisma.job.findMany({
      select: RECOMMENDATION_JOB_SELECT,
      where: this.activeFilters(query, now),
      orderBy: [
        { publishedAt: { sort: 'desc', nulls: 'last' } },
        { id: 'asc' },
      ],
      take: query.limit,
    });
    return {
      items: jobs.map((job) => this.toItem(job, null)),
      nextCursor: null,
      source: JobRecommendationSource.LATEST,
      fallbackReason,
    };
  }

  private activeFilters(
    query: JobRecommendationQueryDto,
    now: Date,
  ): Prisma.JobWhereInput {
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    return {
      status: JobStatus.PUBLISHED,
      deadline: { gte: today },
      ...(query.location !== undefined
        ? {
          location: {
            equals: query.location,
            mode: Prisma.QueryMode.insensitive,
          },
        }
        : {}),
      ...(query.salaryMin !== undefined
        ? {
          OR: [
            { isNegotiable: true },
            { salaryMax: { gte: query.salaryMin } },
          ],
        }
        : {}),
      ...(query.jobType !== undefined
        ? { jobType: query.jobType }
        : {}),
    };
  }

  private toItem(
    job: RecommendationJob,
    score: number | null,
  ): JobSearchItemDto {
    return {
      id: job.id,
      companyId: job.companyId,
      title: job.title,
      description: job.description,
      salaryMin: job.salaryMin?.toString() ?? null,
      salaryMax: job.salaryMax?.toString() ?? null,
      isNegotiable: job.isNegotiable,
      currency: job.currency,
      location: job.location,
      jobType: job.jobType,
      experienceYears: job.experienceYears,
      skills: job.skills,
      deadline: job.deadline.toISOString().slice(0, 10),
      publishedAt: job.publishedAt?.toISOString() ?? null,
      companyName: null,
      score,
    };
  }
}
