import Redis from 'ioredis';
import { logger } from '@repo/shared/logger';
import { env } from './env';

/**
 * Shared Redis connection for the API's queue producers.
 */
export const redisConnection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
});

// Production monitoring listeners
redisConnection.on('connect', () => {
    logger.info('[Redis] API Connected successfully');
});

redisConnection.on('error', (err: Error) => {
    logger.error({ err }, '[Redis] API Connection error');
});

redisConnection.on('reconnecting', () => {
    logger.warn('[Redis] API Attempting to reconnect...');
});
