import Redis from 'ioredis';
import { logger } from '@repo/shared/logger';
import { env } from './env';

/**
 * Shared Redis connection for BullMQ.
 * maxRetriesPerRequest must be null for compatibility with BullMQ.
 */
export const redisConnection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
});

// Production monitoring listeners
redisConnection.on('connect', () => {
    logger.info('[Redis] Connected successfully');
});

redisConnection.on('error', (err: Error) => {
    logger.error({ err }, '[Redis] Connection error');
});

redisConnection.on('reconnecting', () => {
    logger.warn('[Redis] Attempting to reconnect...');
});
