import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../common/http/api-exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCertificateDto,
  CreateEducationDto,
  CreateExperienceDto,
  CreateProjectDto,
  CreateSkillDto,
  UpdateCertificateDto,
  UpdateEducationDto,
  UpdateExperienceDto,
  UpdateProfileDto,
  UpdateProjectDto,
  UpdateSkillDto,
} from './dto/profile-input.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import {
  calculateProfileCompletion,
  PROFILE_COMPLETION_RULE_VERSION,
} from './profile-completion';

const PROFILE_WITH_BLOCKS = {
  educations: {
    orderBy: [
      { sortOrder: 'asc' as const },
      { startDate: 'desc' as const },
      { id: 'asc' as const },
    ],
  },
  experiences: {
    orderBy: [
      { sortOrder: 'asc' as const },
      { startDate: 'desc' as const },
      { id: 'asc' as const },
    ],
  },
  skills: {
    orderBy: [
      { sortOrder: 'asc' as const },
      { id: 'asc' as const },
    ],
  },
  certificates: {
    orderBy: [
      { sortOrder: 'asc' as const },
      { issuedAt: 'desc' as const },
      { id: 'asc' as const },
    ],
  },
  projects: {
    orderBy: [
      { sortOrder: 'asc' as const },
      { id: 'asc' as const },
    ],
  },
} satisfies Prisma.ProfileInclude;

type ProfileAggregate = Prisma.ProfileGetPayload<{
  include: typeof PROFILE_WITH_BLOCKS;
}>;
type Transaction = Prisma.TransactionClient;
type BlockName =
  | 'education'
  | 'experience'
  | 'skill'
  | 'certificate'
  | 'project';

export const PROFILE_COLLECTION_LIMITS = {
  education: 20,
  experience: 30,
  skill: 100,
  certificate: 50,
  project: 50,
} as const satisfies Record<BlockName, number>;

interface LockedProfile {
  id: string;
  created: boolean;
}

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(
    actorId: string,
    userId: string,
  ): Promise<ProfileResponseDto> {
    this.assertOwner(actorId, userId);
    const profile = await this.prisma.$transaction(
      (transaction) =>
        transaction.profile.findUnique({
          where: { userId },
          include: PROFILE_WITH_BLOCKS,
        }),
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );

    if (!profile) {
      throw this.profileNotFound();
    }
    return this.toResponse(profile);
  }

  async updateProfile(
    actorId: string,
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    this.assertOwner(actorId, userId);
    this.requireMutationFields(dto);

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        true,
      );
      await transaction.profile.update({
        where: { id: locked.id },
        data: {
          fullName: dto.fullName,
          headline: dto.headline,
          summary: dto.summary,
          phone: dto.phone,
          address: dto.address,
          githubUrl: dto.githubUrl,
          linkedinUrl: dto.linkedinUrl,
          portfolioUrl: dto.portfolioUrl,
        },
      });
      return this.refreshAggregate(
        transaction,
        locked.id,
        !locked.created,
      );
    });
  }

  async createEducation(
    userId: string,
    dto: CreateEducationDto,
  ): Promise<ProfileResponseDto> {
    const startDate = this.parseDate(dto.startDate);
    this.rejectNulls(dto, ['sortOrder']);
    const endDate = this.parseOptionalDate(dto.endDate);
    this.validateDateRange(startDate, endDate, 'education');

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        true,
      );
      await this.assertCollectionCapacity(
        transaction,
        locked.id,
        'education',
      );
      await transaction.education.create({
        data: {
          profileId: locked.id,
          school: dto.school,
          major: dto.major,
          degree: dto.degree,
          startDate,
          endDate,
          description: dto.description,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      return this.refreshAggregate(
        transaction,
        locked.id,
        !locked.created,
      );
    });
  }

  async updateEducation(
    userId: string,
    educationId: string,
    dto: UpdateEducationDto,
  ): Promise<ProfileResponseDto> {
    this.requireMutationFields(dto);
    this.rejectNulls(dto, ['school', 'startDate', 'sortOrder']);

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        false,
      );
      const current = await transaction.education.findFirst({
        where: { id: educationId, profileId: locked.id },
      });
      if (!current) {
        throw this.blockNotFound('education');
      }

      const startDate =
        dto.startDate === undefined
          ? current.startDate
          : this.parseDate(dto.startDate);
      const endDate =
        dto.endDate === undefined
          ? current.endDate
          : this.parseOptionalDate(dto.endDate);
      this.validateDateRange(startDate, endDate, 'education');

      await transaction.education.update({
        where: { id: educationId },
        data: {
          school: dto.school,
          major: dto.major,
          degree: dto.degree,
          startDate:
            dto.startDate === undefined ? undefined : startDate,
          endDate:
            dto.endDate === undefined ? undefined : endDate,
          description: dto.description,
          sortOrder: dto.sortOrder,
        },
      });
      return this.refreshAggregate(transaction, locked.id, true);
    });
  }

  async deleteEducation(
    userId: string,
    educationId: string,
  ): Promise<ProfileResponseDto> {
    return this.deleteBlock(userId, educationId, 'education');
  }

  async createExperience(
    userId: string,
    dto: CreateExperienceDto,
  ): Promise<ProfileResponseDto> {
    const startDate = this.parseDate(dto.startDate);
    this.rejectNulls(dto, ['isCurrent', 'sortOrder']);
    const endDate = this.parseOptionalDate(dto.endDate);
    const isCurrent = dto.isCurrent ?? false;
    this.validateExperience(startDate, endDate, isCurrent);

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        true,
      );
      await this.assertCollectionCapacity(
        transaction,
        locked.id,
        'experience',
      );
      await transaction.experience.create({
        data: {
          profileId: locked.id,
          companyName: dto.companyName,
          position: dto.position,
          startDate,
          endDate,
          isCurrent,
          description: dto.description,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      return this.refreshAggregate(
        transaction,
        locked.id,
        !locked.created,
      );
    });
  }

  async updateExperience(
    userId: string,
    experienceId: string,
    dto: UpdateExperienceDto,
  ): Promise<ProfileResponseDto> {
    this.requireMutationFields(dto);
    this.rejectNulls(dto, [
      'companyName',
      'position',
      'startDate',
      'isCurrent',
      'sortOrder',
    ]);

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        false,
      );
      const current = await transaction.experience.findFirst({
        where: { id: experienceId, profileId: locked.id },
      });
      if (!current) {
        throw this.blockNotFound('experience');
      }

      const startDate =
        dto.startDate === undefined
          ? current.startDate
          : this.parseDate(dto.startDate);
      const isCurrent = dto.isCurrent ?? current.isCurrent;
      const endDate =
        dto.endDate !== undefined
          ? this.parseOptionalDate(dto.endDate)
          : dto.isCurrent === true
            ? null
            : current.endDate;
      this.validateExperience(startDate, endDate, isCurrent);

      await transaction.experience.update({
        where: { id: experienceId },
        data: {
          companyName: dto.companyName,
          position: dto.position,
          startDate:
            dto.startDate === undefined ? undefined : startDate,
          endDate:
            dto.endDate === undefined && dto.isCurrent !== true
              ? undefined
              : endDate,
          isCurrent: dto.isCurrent,
          description: dto.description,
          sortOrder: dto.sortOrder,
        },
      });
      return this.refreshAggregate(transaction, locked.id, true);
    });
  }

  async deleteExperience(
    userId: string,
    experienceId: string,
  ): Promise<ProfileResponseDto> {
    return this.deleteBlock(userId, experienceId, 'experience');
  }

  async createSkill(
    userId: string,
    dto: CreateSkillDto,
  ): Promise<ProfileResponseDto> {
    this.rejectNulls(dto, ['sortOrder']);

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        true,
      );
      await this.assertCollectionCapacity(
        transaction,
        locked.id,
        'skill',
      );
      await transaction.skill.create({
        data: {
          profileId: locked.id,
          name: dto.name,
          normalizedName: await this.normalizeSkill(
            transaction,
            dto.name,
          ),
          level: dto.level,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      return this.refreshAggregate(
        transaction,
        locked.id,
        !locked.created,
      );
    });
  }

  async updateSkill(
    userId: string,
    skillId: string,
    dto: UpdateSkillDto,
  ): Promise<ProfileResponseDto> {
    this.requireMutationFields(dto);
    this.rejectNulls(dto, ['name', 'sortOrder']);

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        false,
      );
      const current = await transaction.skill.findFirst({
        where: { id: skillId, profileId: locked.id },
        select: { id: true },
      });
      if (!current) {
        throw this.blockNotFound('skill');
      }

      await transaction.skill.update({
        where: { id: skillId },
        data: {
          name: dto.name,
          normalizedName:
            dto.name === undefined
              ? undefined
              : await this.normalizeSkill(transaction, dto.name),
          level: dto.level,
          sortOrder: dto.sortOrder,
        },
      });
      return this.refreshAggregate(transaction, locked.id, true);
    });
  }

  async deleteSkill(
    userId: string,
    skillId: string,
  ): Promise<ProfileResponseDto> {
    return this.deleteBlock(userId, skillId, 'skill');
  }

  async createCertificate(
    userId: string,
    dto: CreateCertificateDto,
  ): Promise<ProfileResponseDto> {
    const issuedAt = this.parseDate(dto.issuedAt);
    this.rejectNulls(dto, ['sortOrder']);

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        true,
      );
      await this.assertCollectionCapacity(
        transaction,
        locked.id,
        'certificate',
      );
      await transaction.certificate.create({
        data: {
          profileId: locked.id,
          name: dto.name,
          issuer: dto.issuer,
          issuedAt,
          credentialUrl: dto.credentialUrl,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      return this.refreshAggregate(
        transaction,
        locked.id,
        !locked.created,
      );
    });
  }

  async updateCertificate(
    userId: string,
    certificateId: string,
    dto: UpdateCertificateDto,
  ): Promise<ProfileResponseDto> {
    this.requireMutationFields(dto);
    this.rejectNulls(dto, [
      'name',
      'issuer',
      'issuedAt',
      'sortOrder',
    ]);

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        false,
      );
      const current = await transaction.certificate.findFirst({
        where: { id: certificateId, profileId: locked.id },
        select: { id: true },
      });
      if (!current) {
        throw this.blockNotFound('certificate');
      }

      await transaction.certificate.update({
        where: { id: certificateId },
        data: {
          name: dto.name,
          issuer: dto.issuer,
          issuedAt:
            dto.issuedAt === undefined
              ? undefined
              : this.parseDate(dto.issuedAt),
          credentialUrl: dto.credentialUrl,
          sortOrder: dto.sortOrder,
        },
      });
      return this.refreshAggregate(transaction, locked.id, true);
    });
  }

  async deleteCertificate(
    userId: string,
    certificateId: string,
  ): Promise<ProfileResponseDto> {
    return this.deleteBlock(
      userId,
      certificateId,
      'certificate',
    );
  }

  async createProject(
    userId: string,
    dto: CreateProjectDto,
  ): Promise<ProfileResponseDto> {
    this.rejectNulls(dto, ['sortOrder']);

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        true,
      );
      await this.assertCollectionCapacity(
        transaction,
        locked.id,
        'project',
      );
      await transaction.project.create({
        data: {
          profileId: locked.id,
          name: dto.name,
          role: dto.role,
          description: dto.description,
          url: dto.url,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      return this.refreshAggregate(
        transaction,
        locked.id,
        !locked.created,
      );
    });
  }

  async updateProject(
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProfileResponseDto> {
    this.requireMutationFields(dto);
    this.rejectNulls(dto, ['name', 'sortOrder']);

    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        false,
      );
      const current = await transaction.project.findFirst({
        where: { id: projectId, profileId: locked.id },
        select: { id: true },
      });
      if (!current) {
        throw this.blockNotFound('project');
      }

      await transaction.project.update({
        where: { id: projectId },
        data: {
          name: dto.name,
          role: dto.role,
          description: dto.description,
          url: dto.url,
          sortOrder: dto.sortOrder,
        },
      });
      return this.refreshAggregate(transaction, locked.id, true);
    });
  }

  async deleteProject(
    userId: string,
    projectId: string,
  ): Promise<ProfileResponseDto> {
    return this.deleteBlock(userId, projectId, 'project');
  }

  private async deleteBlock(
    userId: string,
    blockId: string,
    block: BlockName,
  ): Promise<ProfileResponseDto> {
    return this.runMutation(async (transaction) => {
      const locked = await this.lockProfile(
        transaction,
        userId,
        false,
      );
      let found = false;

      switch (block) {
        case 'education':
          found = Boolean(
            await transaction.education.findFirst({
              where: { id: blockId, profileId: locked.id },
              select: { id: true },
            }),
          );
          if (found) {
            await transaction.education.delete({
              where: { id: blockId },
            });
          }
          break;
        case 'experience':
          found = Boolean(
            await transaction.experience.findFirst({
              where: { id: blockId, profileId: locked.id },
              select: { id: true },
            }),
          );
          if (found) {
            await transaction.experience.delete({
              where: { id: blockId },
            });
          }
          break;
        case 'skill':
          found = Boolean(
            await transaction.skill.findFirst({
              where: { id: blockId, profileId: locked.id },
              select: { id: true },
            }),
          );
          if (found) {
            await transaction.skill.delete({
              where: { id: blockId },
            });
          }
          break;
        case 'certificate':
          found = Boolean(
            await transaction.certificate.findFirst({
              where: { id: blockId, profileId: locked.id },
              select: { id: true },
            }),
          );
          if (found) {
            await transaction.certificate.delete({
              where: { id: blockId },
            });
          }
          break;
        case 'project':
          found = Boolean(
            await transaction.project.findFirst({
              where: { id: blockId, profileId: locked.id },
              select: { id: true },
            }),
          );
          if (found) {
            await transaction.project.delete({
              where: { id: blockId },
            });
          }
          break;
      }

      if (!found) {
        throw this.blockNotFound(block);
      }
      return this.refreshAggregate(transaction, locked.id, true);
    });
  }

  private async lockProfile(
    transaction: Transaction,
    userId: string,
    createIfMissing: boolean,
  ): Promise<LockedProfile> {
    const rows = await transaction.$queryRaw<{ id: string }[]>`
      SELECT "id"::text AS "id"
      FROM "profile"."profiles"
      WHERE "user_id" = ${userId}::uuid
      FOR UPDATE
    `;

    if (rows[0]) {
      return { id: rows[0].id, created: false };
    }
    if (!createIfMissing) {
      throw this.profileNotFound();
    }

    const created = await transaction.profile.create({
      data: {
        userId,
        completionRuleVersion:
          PROFILE_COMPLETION_RULE_VERSION,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  }

  private async refreshAggregate(
    transaction: Transaction,
    profileId: string,
    bumpVersion: boolean,
  ): Promise<ProfileResponseDto> {
    const aggregate = await transaction.profile.findUniqueOrThrow({
      where: { id: profileId },
      include: PROFILE_WITH_BLOCKS,
    });
    const completion = calculateProfileCompletion(aggregate);

    const updated = await transaction.profile.update({
      where: { id: profileId },
      data: {
        completionPercent: completion.percent,
        completionRuleVersion: completion.ruleVersion,
        aggregateVersion: bumpVersion
          ? { increment: 1 }
          : undefined,
      },
      include: PROFILE_WITH_BLOCKS,
    });
    return this.toResponse(updated);
  }

  private async assertCollectionCapacity(
    transaction: Transaction,
    profileId: string,
    block: BlockName,
  ): Promise<void> {
    const counters = {
      education: () =>
        transaction.education.count({ where: { profileId } }),
      experience: () =>
        transaction.experience.count({ where: { profileId } }),
      skill: () =>
        transaction.skill.count({ where: { profileId } }),
      certificate: () =>
        transaction.certificate.count({ where: { profileId } }),
      project: () =>
        transaction.project.count({ where: { profileId } }),
    } satisfies Record<BlockName, () => Promise<number>>;
    const limit = PROFILE_COLLECTION_LIMITS[block];
    const count = await counters[block]();

    if (count >= limit) {
      throw new ApiException(
        'PROFILE_COLLECTION_LIMIT_REACHED',
        `The ${block} collection is limited to ${limit} items`,
        HttpStatus.CONFLICT,
        { collection: block, limit },
      );
    }
  }

  private async runMutation(
    operation: (
      transaction: Transaction,
    ) => Promise<ProfileResponseDto>,
  ): Promise<ProfileResponseDto> {
    const maxAttempts = 8;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        });
      } catch (error) {
        if (
          attempt < maxAttempts &&
          this.isRetryableTransactionError(error)
        ) {
          await this.waitForTransactionRetry(attempt);
          continue;
        }
        this.throwPersistenceError(error);
      }
    }

    throw new ApiException(
      'PROFILE_CONCURRENT_MODIFICATION',
      'Profile could not be updated because of concurrent changes',
      HttpStatus.CONFLICT,
    );
  }

  private async waitForTransactionRetry(
    attempt: number,
  ): Promise<void> {
    const delay =
      Math.min(10 * 2 ** (attempt - 1), 250) +
      Math.floor(Math.random() * 25);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delay);
    });
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError)
    ) {
      return false;
    }
    if (error.code === 'P2034') {
      return true;
    }
    if (
      error.code === 'P2010' &&
      String(error.meta?.code ?? '') === '40001'
    ) {
      return true;
    }
    return (
      error.code === 'P2002' &&
      ['profiles_user_id', 'user_id'].some((name) =>
        JSON.stringify(error.meta?.target ?? '').includes(
          name,
        ),
      )
    );
  }

  private throwPersistenceError(error: unknown): never {
    if (error instanceof ApiException) {
      throw error;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = JSON.stringify(error.meta?.target ?? '');
        if (target.includes('normalized_name')) {
          throw new ApiException(
            'SKILL_ALREADY_EXISTS',
            'This skill already exists in the profile',
            HttpStatus.CONFLICT,
          );
        }
        throw new ApiException(
          'PROFILE_VALUE_CONFLICT',
          'A profile value conflicts with an existing record',
          HttpStatus.CONFLICT,
        );
      }
      if (error.code === 'P2025') {
        throw this.profileNotFound();
      }
      if (
        error.code === 'P2034' ||
        (error.code === 'P2010' &&
          String(error.meta?.code ?? '') === '40001')
      ) {
        throw new ApiException(
          'PROFILE_CONCURRENT_MODIFICATION',
          'Profile changed concurrently; retry the request',
          HttpStatus.CONFLICT,
        );
      }
      if (error.code === 'P2028') {
        throw new ApiException(
          'PROFILE_TRANSACTION_TIMEOUT',
          'Profile transaction timed out; retry the request',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (error.code === 'P2004') {
        throw new ApiException(
          'PROFILE_DATA_INVALID',
          'Profile data violates a business constraint',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    throw error;
  }

  private parseDate(value: string): Date {
    const parsed = new Date(value + 'T00:00:00.000Z');
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new ApiException(
        'INVALID_DATE',
        'Date must be a real calendar date in YYYY-MM-DD format',
        HttpStatus.BAD_REQUEST,
      );
    }
    return parsed;
  }

  private parseOptionalDate(
    value: string | null | undefined,
  ): Date | null {
    return value == null ? null : this.parseDate(value);
  }

  private validateDateRange(
    startDate: Date,
    endDate: Date | null,
    block: string,
  ): void {
    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw new ApiException(
        'INVALID_DATE_RANGE',
        block + ' end date cannot be before its start date',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private validateExperience(
    startDate: Date,
    endDate: Date | null,
    isCurrent: boolean,
  ): void {
    if (isCurrent && endDate) {
      throw new ApiException(
        'CURRENT_EXPERIENCE_END_DATE',
        'A current experience cannot have an end date',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!isCurrent && !endDate) {
      throw new ApiException(
        'EXPERIENCE_END_DATE_REQUIRED',
        'A past experience requires an end date',
        HttpStatus.BAD_REQUEST,
      );
    }
    this.validateDateRange(startDate, endDate, 'experience');
  }

  private async normalizeSkill(
    transaction: Transaction,
    name: string,
  ): Promise<string> {
    const rows = await transaction.$queryRaw<
      { normalizedName: string }[]
    >`
      SELECT LOWER(BTRIM(${name})) AS "normalizedName"
    `;
    return rows[0].normalizedName;
  }

  private assertOwner(actorId: string, userId: string): void {
    if (actorId.toLowerCase() !== userId.toLowerCase()) {
      throw new ApiException(
        'PROFILE_OWNER_REQUIRED',
        'Candidates can only access their own profile',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private requireMutationFields(value: object): void {
    if (Object.keys(value).length === 0) {
      throw new ApiException(
        'EMPTY_PROFILE_UPDATE',
        'At least one mutable field is required',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private rejectNulls(
    value: object,
    fields: readonly string[],
  ): void {
    const record = value as Record<string, unknown>;
    const field = fields.find((name) => record[name] === null);
    if (field) {
      throw new ApiException(
        'NULL_NOT_ALLOWED',
        field + ' cannot be null',
        HttpStatus.BAD_REQUEST,
        { field },
      );
    }
  }

  private profileNotFound(): ApiException {
    return new ApiException(
      'PROFILE_NOT_FOUND',
      'Candidate profile was not found',
      HttpStatus.NOT_FOUND,
    );
  }

  private blockNotFound(block: string): ApiException {
    return new ApiException(
      'PROFILE_BLOCK_NOT_FOUND',
      'The requested profile block was not found',
      HttpStatus.NOT_FOUND,
      { block },
    );
  }

  private toResponse(
    profile: ProfileAggregate,
  ): ProfileResponseDto {
    const completion = calculateProfileCompletion(profile);
    const date = (value: Date): string =>
      value.toISOString().slice(0, 10);

    return {
      id: profile.id,
      userId: profile.userId,
      fullName: profile.fullName,
      headline: profile.headline,
      summary: profile.summary,
      phone: profile.phone,
      address: profile.address,
      avatarFileId: profile.avatarFileId,
      avatarUrl: profile.avatarUrl,
      githubUrl: profile.githubUrl,
      linkedinUrl: profile.linkedinUrl,
      portfolioUrl: profile.portfolioUrl,
      completionPercent: profile.completionPercent,
      completionRuleVersion: profile.completionRuleVersion,
      completionWarning: profile.completionPercent < 50,
      missingSections: completion.missingSections,
      aggregateVersion: profile.aggregateVersion,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      educations: profile.educations.map((item) => ({
        id: item.id,
        school: item.school,
        major: item.major,
        degree: item.degree,
        startDate: date(item.startDate),
        endDate: item.endDate ? date(item.endDate) : null,
        description: item.description,
        sortOrder: item.sortOrder,
      })),
      experiences: profile.experiences.map((item) => ({
        id: item.id,
        companyName: item.companyName,
        position: item.position,
        startDate: date(item.startDate),
        endDate: item.endDate ? date(item.endDate) : null,
        isCurrent: item.isCurrent,
        description: item.description,
        sortOrder: item.sortOrder,
      })),
      skills: profile.skills.map((item) => ({
        id: item.id,
        name: item.name,
        level: item.level,
        sortOrder: item.sortOrder,
      })),
      certificates: profile.certificates.map((item) => ({
        id: item.id,
        name: item.name,
        issuer: item.issuer,
        issuedAt: date(item.issuedAt),
        credentialUrl: item.credentialUrl,
        sortOrder: item.sortOrder,
      })),
      projects: profile.projects.map((item) => ({
        id: item.id,
        name: item.name,
        role: item.role,
        description: item.description,
        url: item.url,
        sortOrder: item.sortOrder,
      })),
    };
  }
}
