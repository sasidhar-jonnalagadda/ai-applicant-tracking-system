import { z } from 'zod';

/**
 * Skill Categories supported by the AI extractor and UI.
 */
export const SkillCategoryEnum = z.enum(['Frontend', 'Backend', 'DevOps', 'Database', 'Other']);
export type SkillCategory = z.infer<typeof SkillCategoryEnum>;

/**
 * Personal Information extracted from the resume.
 */
export const PersonalInfoSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().nullable(),
  linkedinUrl: z.string().nullable().optional(),
  githubUrl: z.string().nullable().optional(),
});
export type IPersonalInfo = z.infer<typeof PersonalInfoSchema>;

/**
 * Skill entry with category and name.
 */
export const SkillSchema = z.object({
  category: SkillCategoryEnum,
  name: z.string().min(1),
});
export type ISkill = z.infer<typeof SkillSchema>;

/**
 * Professional experience entry.
 */
export const ExperienceSchema = z.object({
  company: z.string().min(1),
  role: z.string().min(1),
  startDate: z.string(),
  endDate: z.string().or(z.literal("Present")),
  highlights: z.array(z.string()),
});
export type IExperience = z.infer<typeof ExperienceSchema>;

/**
 * Education entry.
 */
export const EducationSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().min(1),
  graduationYear: z.number().nullable(),
});
export type IEducation = z.infer<typeof EducationSchema>;

/**
 * Explainable AI Match Analysis.
 */
export const AnalysisSchema = z.object({
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  interviewQuestions: z.array(z.string()),
});
export type IAnalysis = z.infer<typeof AnalysisSchema>;

/**
 * The complete structured profile of a candidate as extracted from a resume.
 */
export const CandidateProfileSchema = z.object({
  personalInfo: PersonalInfoSchema,
  summary: z.string(),
  totalYearsExperience: z.number().nonnegative(),
  skills: z.array(SkillSchema),
  experience: z.array(ExperienceSchema),
  education: z.array(EducationSchema),
  analysis: AnalysisSchema,
});

export type ICandidateProfile = z.infer<typeof CandidateProfileSchema>;

/**
 * Frontend-Safe Candidate DTO [T-7]
 * 
 * This type represents what the frontend actually receives via the API:
 * a plain JSON object (not a Mongoose Document) with `_id` as string
 * and an optional semantic `score` from vector search.
 * 
 * Replaces the ad-hoc `ICandidate & { score?: number }` pattern in page.tsx.
 */
export interface ICandidateDTO extends ICandidateProfile {
  _id: string;
  jobPostingId: string;
  resumeUrl: string;
  score?: number;
  createdAt: string;
  updatedAt: string;
}
