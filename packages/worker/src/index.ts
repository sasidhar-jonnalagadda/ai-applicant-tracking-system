import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { connectToDatabase } from '@repo/shared/models';
import { logger } from '@repo/shared/logger';
import { redisConnection } from './config/redis';
import { env } from './config/env';
import { processResume } from './processors/resumeProcessor';

/**
 * Process-Level Safety Net
 */
process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, '[PROCESS:FATAL] Unhandled Rejection');
  process.exit(1);
});

process.on('uncaughtException', (error: Error) => {
  logger.fatal({ error }, '[PROCESS:FATAL] Uncaught Exception');
  process.exit(1);
});

/**
 * Background Worker Lifecycle Orchestration
 */
async function startWorker() {
  try {
    // 1. Centralized Database Initialization
    await connectToDatabase(env.MONGODB_URI);
    logger.info(`[WORKER] Connected to MongoDB in ${env.NODE_ENV} mode`);

    // 2. Worker Instance Initialization
    const worker = new Worker('resume-parsing', processResume, {
      connection: redisConnection,
      prefix: 'ats-project',
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 1000, 
      },
    });

    // 3. Operational Monitoring
    worker.on('completed', (job) => {
      logger.info({ jobId: job.id, taskId: job.data.taskId }, '[WORKER] Job Completed');
    });

    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, taskId: job?.data?.taskId, err: err.message }, '[WORKER] Job Failed');
    });

    worker.on('error', (err) => {
      logger.error({ err: err.message }, '[WORKER] Unexpected worker error');
    });

    logger.info('[WORKER] Listening for jobs on queue: resume-parsing...');

    /**
     * [Q-2] Unified Graceful Shutdown Handler
     */
    let isShuttingDown = false;

    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;

      logger.info({ signal }, `[WORKER] ${signal} received. Graceful shutdown initiated...`);

      setTimeout(() => {
        logger.fatal('[WORKER] Forced shutdown after 15s timeout.');
        process.exit(1);
      }, 15000).unref();

      try {
        await worker.close();
        logger.info('[WORKER] BullMQ worker closed.');

        await redisConnection.quit();
        logger.info('[WORKER] Redis connection closed.');

        await mongoose.connection.close();
        logger.info('[WORKER] MongoDB connection closed.');

        process.exit(0);
      } catch (error) {
        logger.error({ error }, '[WORKER] Error during graceful shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.fatal({ error }, '[WORKER:FATAL] Worker failed to start');
    process.exit(1);
  }
}

startWorker();
