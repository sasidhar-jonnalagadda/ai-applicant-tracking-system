import Redis from 'ioredis';
import { env } from './env';

/**
 * Shared Redis connection for BullMQ.
 * maxRetriesPerRequest must be null for compatibility with BullMQ.
 */
const redisOptions = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    maxRetriesPerRequest: null,
};

export const redisConnection = new Redis(redisOptions);

// Production monitoring listeners
redisConnection.on('connect', () => {
    console.info('[Redis] Connected successfully');
});

redisConnection.on('error', (err: Error) => {
    console.error('[Redis] Connection error:', err);
});

redisConnection.on('reconnecting', () => {
    console.warn('[Redis] Attempting to reconnect...');
});
