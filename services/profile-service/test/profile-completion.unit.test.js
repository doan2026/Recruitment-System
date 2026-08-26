'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  calculateProfileCompletion,
  PROFILE_COMPLETION_RULE_VERSION,
  PROFILE_COMPLETION_WEIGHTS,
} = require('../dist/profile/profile-completion');

const emptyProfile = (overrides = {}) => ({
  fullName: null,
  headline: null,
  summary: null,
  phone: null,
  address: null,
  githubUrl: null,
  linkedinUrl: null,
  portfolioUrl: null,
  educations: [],
  experiences: [],
  skills: [],
  certificates: [],
  projects: [],
  ...overrides,
});

test('completion rule v1 weights add up to 100', () => {
  const total = Object.values(PROFILE_COMPLETION_WEIGHTS).reduce(
    (sum, value) => sum + value,
    0,
  );
  assert.equal(PROFILE_COMPLETION_RULE_VERSION, 1);
  assert.equal(total, 100);
});

test('empty profile is zero percent with a stable missing list', () => {
  const completion = calculateProfileCompletion(emptyProfile());
  assert.equal(completion.percent, 0);
  assert.equal(completion.warning, true);
  assert.deepEqual(
    completion.missingSections,
    Object.keys(PROFILE_COMPLETION_WEIGHTS),
  );
});

test('each completion criterion contributes exactly its fixed weight', () => {
  const sources = {
    fullName: { fullName: 'Candidate' },
    headline: { headline: 'Backend Engineer' },
    summary: { summary: 'Builds reliable systems' },
    phone: { phone: '+84 912 345 678' },
    address: { address: 'Ha Noi' },
    externalLinks: { githubUrl: 'https://github.com/candidate' },
    educations: { educations: [{}] },
    experiences: { experiences: [{}] },
    skills: { skills: [{}] },
    certificates: { certificates: [{}] },
    projects: { projects: [{}] },
  };

  for (const [section, overrides] of Object.entries(sources)) {
    const completion = calculateProfileCompletion(
      emptyProfile(overrides),
    );
    assert.equal(
      completion.percent,
      PROFILE_COMPLETION_WEIGHTS[section],
      section,
    );
    assert.equal(
      completion.missingSections.includes(section),
      false,
      section,
    );
  }
});

test('multiple rows or links never multiply a block weight', () => {
  const completion = calculateProfileCompletion(
    emptyProfile({
      githubUrl: 'https://github.com/candidate',
      linkedinUrl: 'https://linkedin.com/in/candidate',
      portfolioUrl: 'https://candidate.example.com',
      skills: [{}, {}, {}],
    }),
  );
  assert.equal(
    completion.percent,
    PROFILE_COMPLETION_WEIGHTS.externalLinks +
      PROFILE_COMPLETION_WEIGHTS.skills,
  );
});

test('complete profile reaches 100 and the 50 percent boundary is not warned', () => {
  const complete = calculateProfileCompletion(
    emptyProfile({
      fullName: 'Candidate',
      headline: 'Backend Engineer',
      summary: 'Builds reliable systems',
      phone: '+84 912 345 678',
      address: 'Ha Noi',
      githubUrl: 'https://github.com/candidate',
      educations: [{}],
      experiences: [{}],
      skills: [{}],
      certificates: [{}],
      projects: [{}],
    }),
  );
  assert.equal(complete.percent, 100);
  assert.equal(complete.warning, false);
  assert.deepEqual(complete.missingSections, []);

  const exactlyFifty = calculateProfileCompletion(
    emptyProfile({
      fullName: 'Candidate',
      headline: 'Backend Engineer',
      summary: 'Builds reliable systems',
      phone: '+84 912 345 678',
      address: 'Ha Noi',
      githubUrl: 'https://github.com/candidate',
      educations: [{}],
    }),
  );
  assert.equal(exactlyFifty.percent, 50);
  assert.equal(exactlyFifty.warning, false);
});
