/**
 * @repo/shared
 * 
 * Frontend-Safe Entry Point.
 * This file exports only pure TypeScript interfaces, Zod schemas, and Enums.
 * NO Mongoose models or database-specific logic should be exported from here.
 */

// 1. Candidate Domain (Types & Schemas Only)
export {
  CandidateProfileSchema,
  PersonalInfoSchema,
  SkillSchema,
  ExperienceSchema,
  EducationSchema,
  SkillCategoryEnum,
} from './types/candidate';

export type {
  ICandidateProfile,
  IPersonalInfo,
  ISkill,
  IExperience,
  IEducation,
  SkillCategory,
  ICandidateDTO,
} from './types/candidate';

/**
 * [T-7] Re-export ICandidate (Mongoose Document type) for backend consumers only.
 * Frontend consumers should use ICandidateDTO instead.
 */
export type { ICandidate } from './models/Candidate';
export type { IJobPosting } from './models/JobPosting';

// 2. Job & Task Domain (Types & Schemas Only)
export {
  JobStatus,
  JobStatusSchema,
  JobPostingSchema,
  ResumeJobDataSchema,
} from './types/job';

export type {
  JobPosting,
  IResumeJobData,
} from './types/job';
