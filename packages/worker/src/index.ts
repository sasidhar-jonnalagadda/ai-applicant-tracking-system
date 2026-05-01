import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { connectToDatabase } from '@repo/shared/models';
import { redisConnection } from './config/redis';
import { env } from './config/env';
import { processResume } from './processors/resumeProcessor';

/**
 * Process-Level Safety Net
 * Prevents silent crashes from unhandled promise rejections.
 * Must be registered before any async work begins.
 */
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[PROCESS:FATAL] Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error: Error) => {
  console.error('[PROCESS:FATAL] Uncaught Exception:', error);
  process.exit(1);
});

/**
 * Background Worker Lifecycle Orchestration
 */
async function startWorker() {
  try {
    // 1. Centralized Database Initialization
    await connectToDatabase(env.MONGODB_URI);
    console.info(`[WORKER] Connected to MongoDB (${env.NODE_ENV})`);

    // 2. Worker Instance Initialization
    // Concurrency=1 prevents Gemini rate limit saturation for a single replica.
    // [Q-3] limiter config provides cross-replica rate governance when scaling horizontally.
    const worker = new Worker('resume-parsing', processResume, {
      connection: redisConnection,
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 1000, // Max 1 job per second across all replicas sharing this queue
      },
    });

    // 3. Operational Monitoring
    worker.on('completed', (job) => {
      console.info(`[WORKER] Job Completed | ID: ${job.id} | Task: ${job.data.taskId}`);
    });

    worker.on('failed', (job, err) => {
      console.error(`[WORKER] Job Failed | ID: ${job?.id} | Error: ${err.message}`);
    });

    worker.on('error', (err) => {
      console.error('[WORKER] Unexpected worker error:', err);
    });

    console.info(`[WORKER] Listening for jobs on queue: resume-parsing...`);

    /**
     * [Q-2] Unified Graceful Shutdown Handler
     * 
     * Merges the shutdown and force-exit into a single signal handler.
     * The previous implementation registered TWO handlers for each signal,
     * causing the force-exit timer to race with the graceful path.
     * 
     * [Q-1] Properly closes both BullMQ's internal connection AND
     * the explicit shared Redis connection.
     */
    let isShuttingDown = false;

    const shutdown = async () => {
      if (isShuttingDown) {
        return;
      } // Prevent double-shutdown from rapid signals
      isShuttingDown = true;

      console.info('\n[WORKER] Graceful shutdown initiated...');

      // Start force-exit timer INSIDE the handler, not as a separate handler
      const forceExitTimer = setTimeout(() => {
        console.error('[WORKER] Forced shutdown after 15s timeout.');
        process.exit(1);
      }, 15000);
      // Ensure the timer doesn't keep the process alive if shutdown completes
      forceExitTimer.unref();

      try {
        // Stop accepting new jobs and wait for the current one to finish
        await worker.close();
        console.info('[WORKER] BullMQ worker closed.');

        // [Q-1] Close the explicit Redis connection (not closed by worker.close())
        await redisConnection.quit();
        console.info('[WORKER] Redis connection closed.');

        // Close database connection
        await mongoose.connection.close();
        console.info('[WORKER] MongoDB connection closed.');

        process.exit(0);
      } catch (error) {
        console.error('[WORKER] Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('[WORKER:FATAL] Worker failed to start:', error);
    process.exit(1);
  }
}

// Start the worker process
startWorker();
