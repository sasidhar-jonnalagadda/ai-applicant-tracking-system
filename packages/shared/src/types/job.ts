import { z } from 'zod';

/**
 * Processing status for an ingestion task.
 */
export enum JobStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED'
}

export const JobStatusSchema = z.nativeEnum(JobStatus);

/**
 * Core Job Posting interface.
 */
export const JobPostingSchema = z.object({
    id: z.string().optional(),
    title: z.string().min(1),
    department: z.string(),
    description: z.string(),
    requirements: z.array(z.string()),
    createdAt: z.date().optional(),
    updatedAt: z.date().optional(),
});

export type JobPosting = z.infer<typeof JobPostingSchema>;

/**
 * Data passed to the background worker for resume processing.
 */
export const ResumeJobDataSchema = z.object({
    taskId: z.string(),
    s3Key: z.string(),
    s3Bucket: z.string(),
    jobPostingId: z.string(),
});

export type IResumeJobData = z.infer<typeof ResumeJobDataSchema>;