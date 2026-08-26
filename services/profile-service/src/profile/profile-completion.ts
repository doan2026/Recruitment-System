export const PROFILE_COMPLETION_RULE_VERSION = 1;

export const PROFILE_COMPLETION_WEIGHTS = {
  fullName: 10,
  headline: 5,
  summary: 5,
  phone: 5,
  address: 5,
  externalLinks: 5,
  educations: 15,
  experiences: 20,
  skills: 20,
  certificates: 5,
  projects: 5,
} as const;

export type MissingProfileSection =
  keyof typeof PROFILE_COMPLETION_WEIGHTS;

export interface ProfileCompletionSource {
  fullName: string | null;
  headline: string | null;
  summary: string | null;
  phone: string | null;
  address: string | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  educations: readonly unknown[];
  experiences: readonly unknown[];
  skills: readonly unknown[];
  certificates: readonly unknown[];
  projects: readonly unknown[];
}

export interface ProfileCompletion {
  percent: number;
  ruleVersion: number;
  warning: boolean;
  missingSections: MissingProfileSection[];
}

const hasText = (value: string | null): boolean =>
  typeof value === 'string' && value.trim().length > 0;

export const calculateProfileCompletion = (
  profile: ProfileCompletionSource,
): ProfileCompletion => {
  const complete: Record<MissingProfileSection, boolean> = {
    fullName: hasText(profile.fullName),
    headline: hasText(profile.headline),
    summary: hasText(profile.summary),
    phone: hasText(profile.phone),
    address: hasText(profile.address),
    externalLinks:
      hasText(profile.githubUrl) ||
      hasText(profile.linkedinUrl) ||
      hasText(profile.portfolioUrl),
    educations: profile.educations.length > 0,
    experiences: profile.experiences.length > 0,
    skills: profile.skills.length > 0,
    certificates: profile.certificates.length > 0,
    projects: profile.projects.length > 0,
  };

  const entries = Object.entries(
    PROFILE_COMPLETION_WEIGHTS,
  ) as [MissingProfileSection, number][];
  const percent = entries.reduce(
    (score, [section, weight]) =>
      score + (complete[section] ? weight : 0),
    0,
  );
  const missingSections = entries
    .filter(([section]) => !complete[section])
    .map(([section]) => section);

  return {
    percent,
    ruleVersion: PROFILE_COMPLETION_RULE_VERSION,
    warning: percent < 50,
    missingSections,
  };
};
