import { Queue, QueueOptions } from 'bullmq';
import { IResumeJobData, ResumeJobDataSchema } from '@repo/shared';
import { logger } from '@repo/shared/logger';
import { redisConnection } from '../config/redis';

/**
 * Resume Parsing Queue Configuration
 * 
 * We implement job pruning to prevent Redis OOM and an exponential
 * backoff strategy to handle transient failures in the ingestion pipeline.
 */
const RESUME_QUEUE_OPTIONS: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    // Retry strategy for transient failures (S3 blips, AI rate limits)
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s -> 4s -> 8s -> 16s -> 32s
    },
    // Resource Management: Automatically clean up metadata to save memory
    removeOnComplete: {
      age: 3600, // Keep for 1 hour
      count: 100, // Max 100 entries
    },
    removeOnFail: {
      age: 24 * 3600, // Keep for 24 hours for debugging
      count: 1000,
    },
  },
};

/**
 * Strictly Typed Resume Parsing Queue
 */
export const resumeQueue = new Queue<IResumeJobData>('resume-parsing', RESUME_QUEUE_OPTIONS);

/**
 * Helper to enqueue a resume processing job.
 * Performs runtime validation to ensure data integrity before queue entry.
 * 
 * @param data - The job payload containing taskId and S3 pointers.
 */
export const enqueueResumeJob = async (data: IResumeJobData): Promise<void> => {
  try {
    // 1. Runtime Boundary Validation
    const validatedData = ResumeJobDataSchema.parse(data);

    // 2. Queue Admission
    await resumeQueue.add('parse-resume', validatedData);
    logger.info({ taskId: data.taskId }, '[QUEUE:SERVICE] Job enqueued');
  } catch (error) {
    logger.error({ taskId: data.taskId, err: error }, '[QUEUE:SERVICE] Failed to enqueue job');
    
    // standardized domain error for API consumer
    throw new Error('QUEUE_ENQUEUE_FAILED');
  }
};