'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { CvType, PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const USER_ID = '10000000-0000-4000-8000-000000000001';
const DEFAULT_FILE_ID = '20000000-0000-4000-8000-000000000001';
const ONLINE_FILE_ID = '20000000-0000-4000-8000-000000000002';

async function truncateProfileSchema() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "profile"."profiles" CASCADE',
  );
}

async function createCompleteProfile() {
  return prisma.profile.create({
    data: {
      userId: USER_ID,
      fullName: 'Nguyen Van An',
      headline: 'Backend Engineer',
      summary: 'Builds reliable distributed systems.',
      phone: '+84 912 345 678',
      address: 'Ha Noi',
      githubUrl: 'https://github.com/nguyenvanan',
      linkedinUrl: 'https://www.linkedin.com/in/nguyenvanan',
      portfolioUrl: 'https://example.com',
      completionPercent: 100,
      educations: {
        create: {
          school: 'Hanoi University of Science and Technology',
          major: 'Computer Science',
          degree: 'Engineer',
          startDate: new Date('2018-09-01T00:00:00.000Z'),
          endDate: new Date('2023-06-30T00:00:00.000Z'),
        },
      },
      experiences: {
        create: {
          companyName: 'Recruitment Co',
          position: 'Backend Engineer',
          startDate: new Date('2023-07-01T00:00:00.000Z'),
          isCurrent: true,
        },
      },
      skills: {
        create: { name: 'TypeScript', normalizedName: 'typescript', level: 'Advanced' },
      },
      certificates: {
        create: {
          name: 'Cloud Developer',
          issuer: 'Example Academy',
          issuedAt: new Date('2024-01-15T00:00:00.000Z'),
          credentialUrl: 'https://example.com/certificates/cloud-developer',
        },
      },
      projects: {
        create: {
          name: 'Recruitment Platform',
          role: 'Backend Engineer',
          description: 'Designed transactional event pipelines.',
          url: 'https://example.com/projects/recruitment-platform',
        },
      },
    },
    include: {
      educations: true,
      experiences: true,
      skills: true,
      certificates: true,
      projects: true,
    },
  });
}

before(truncateProfileSchema);
after(async () => {
  await truncateProfileSchema();
  await prisma.$disconnect();
});

test('Profile persistence constraints on PostgreSQL 16', async (t) => {
  const profile = await createCompleteProfile();

  await t.test('persists all six profile blocks and JSON CV content', async () => {
    assert.equal(profile.educations.length, 1);
    assert.equal(profile.experiences.length, 1);
    assert.equal(profile.skills.length, 1);
    assert.equal(profile.certificates.length, 1);
    assert.equal(profile.projects.length, 1);

    const uploaded = await prisma.cv.create({
      data: {
        userId: USER_ID,
        title: 'Backend CV',
        type: CvType.UPLOAD,
        fileId: DEFAULT_FILE_ID,
        fileUrl: 'https://media.example.com/cv/backend.pdf',
        isDefault: true,
      },
    });
    const online = await prisma.cv.create({
      data: {
        userId: USER_ID,
        title: 'Online CV',
        type: CvType.ONLINE,
        fileId: ONLINE_FILE_ID,
        fileUrl: 'https://media.example.com/cv/online.pdf',
        templateId: 'clean-v1',
        contentSchemaVersion: 1,
        contentJson: { basics: { fullName: 'Nguyen Van An' }, sections: ['skills'] },
      },
    });
    const reloaded = await prisma.cv.findUniqueOrThrow({ where: { id: online.id } });
    assert.deepEqual(reloaded.contentJson, {
      basics: { fullName: 'Nguyen Van An' },
      sections: ['skills'],
    });
    assert.equal(uploaded.isDefault, true);
  });

  await t.test('rejects invalid profile values and duplicate normalized skills', async () => {
    await assert.rejects(() =>
      prisma.profile.update({ where: { id: profile.id }, data: { completionPercent: 101 } }),
    );
    const identityProfile = await prisma.profile.create({
      data: { userId: '10000000-0000-4000-8000-000000000003' },
    });
    await assert.rejects(
      () =>
        prisma.profile.update({
          where: { id: identityProfile.id },
          data: { userId: '10000000-0000-4000-8000-000000000099' },
        }),
      /profile identity is immutable/i,
    );
    await prisma.profile.delete({ where: { id: identityProfile.id } });
    await assert.rejects(() =>
      prisma.profile.update({
        where: { id: profile.id },
        data: { avatarFileId: '30000000-0000-4000-8000-000000000001' },
      }),
    );
    await assert.rejects(() =>
      prisma.skill.create({
        data: { profileId: profile.id, name: 'Typescript', normalizedName: 'typescript' },
      }),
    );
    await assert.rejects(() =>
      prisma.skill.create({
        data: { profileId: profile.id, name: 'Java', normalizedName: 'python' },
      }),
    );
    await assert.rejects(() =>
      prisma.experience.create({
        data: {
          profileId: profile.id,
          companyName: 'Invalid Co',
          position: 'Engineer',
          startDate: new Date('2024-01-01T00:00:00.000Z'),
          endDate: new Date('2024-02-01T00:00:00.000Z'),
          isCurrent: true,
        },
      }),
    );
  });

  await t.test('enforces one active default and valid CV shapes', async () => {
    await assert.rejects(() =>
      prisma.cv.create({
        data: {
          userId: USER_ID,
          title: 'Second default',
          type: CvType.UPLOAD,
          fileId: '20000000-0000-4000-8000-000000000003',
          fileUrl: 'https://media.example.com/cv/second.pdf',
          isDefault: true,
        },
      }),
    );
    await assert.rejects(() =>
      prisma.cv.create({
        data: {
          userId: USER_ID,
          title: 'Invalid online CV',
          type: CvType.ONLINE,
          fileId: '20000000-0000-4000-8000-000000000004',
          fileUrl: 'https://media.example.com/cv/invalid.pdf',
          templateId: 'clean-v1',
        },
      }),
    );
  });

  await t.test('protects a used CV revision and requires soft delete', async () => {
    const cv = await prisma.cv.findUniqueOrThrow({ where: { fileId: DEFAULT_FILE_ID } });
    const unused = await prisma.cv.findUniqueOrThrow({ where: { fileId: ONLINE_FILE_ID } });
    const ownershipTarget = await prisma.profile.create({
      data: { userId: '10000000-0000-4000-8000-000000000004' },
    });
    await assert.rejects(
      () => prisma.cv.delete({ where: { id: unused.id } }),
      /hard delete is disabled/i,
    );
    await assert.rejects(() =>
      prisma.cv.update({
        where: { id: unused.id },
        data: {
          firstUsedAt: new Date(),
          fileUrl: 'https://media.example.com/cv/changed-during-first-use.pdf',
        },
      }),
    );
    await assert.rejects(
      () =>
        prisma.cv.update({
          where: { id: cv.id },
          data: { userId: ownershipTarget.userId },
        }),
      /CV identity and ownership are immutable/i,
    );
    await assert.rejects(
      () =>
        prisma.cv.update({
          where: { id: cv.id },
          data: { id: '40000000-0000-4000-8000-000000000001' },
        }),
      /CV identity and ownership are immutable/i,
    );
    await prisma.profile.delete({ where: { id: ownershipTarget.id } });
    const usedAt = new Date();
    await prisma.cv.update({ where: { id: cv.id }, data: { firstUsedAt: usedAt } });
    const renamed = await prisma.cv.update({
      where: { id: cv.id },
      data: { title: 'Backend CV 2026' },
    });
    assert.equal(renamed.title, 'Backend CV 2026');
    await assert.rejects(() =>
      prisma.cv.update({
        where: { id: cv.id },
        data: { fileUrl: 'https://media.example.com/cv/replaced.pdf' },
      }),
    );
    await assert.rejects(() => prisma.cv.delete({ where: { id: cv.id } }));
    await assert.rejects(() =>
      prisma.cv.update({
        where: { id: cv.id },
        data: { isDeleted: true, deletedAt: new Date() },
      }),
    );
    const deleted = await prisma.cv.update({
      where: { id: cv.id },
      data: { isDefault: false, isDeleted: true, deletedAt: new Date() },
    });
    assert.equal(deleted.isDeleted, true);
  });

  await t.test('restricts profile deletion while CV exists', async () => {
    await assert.rejects(() => prisma.profile.delete({ where: { id: profile.id } }));
  });

  await t.test('cascades owned profile blocks', async () => {
    const cascadeUserId = '10000000-0000-4000-8000-000000000002';
    const aggregate = await prisma.profile.create({
      data: {
        userId: cascadeUserId,
        educations: {
          create: {
            school: 'Test School',
            startDate: new Date('2020-01-01T00:00:00.000Z'),
          },
        },
        skills: { create: { name: 'PostgreSQL', normalizedName: 'postgresql' } },
        projects: { create: { name: 'Persistence Test' } },
      },
    });
    await prisma.profile.delete({ where: { id: aggregate.id } });
    assert.equal(await prisma.education.count({ where: { profileId: aggregate.id } }), 0);
    assert.equal(await prisma.skill.count({ where: { profileId: aggregate.id } }), 0);
    assert.equal(await prisma.project.count({ where: { profileId: aggregate.id } }), 0);
  });
});
