import Redis from 'ioredis';
import { env } from './env';

/**
 * Shared Redis connection for the API's queue producers.
 */
const redisOptions = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    maxRetriesPerRequest: null,
};

export const redisConnection = new Redis(redisOptions);

// Production monitoring listeners
redisConnection.on('connect', () => {
    console.info('[Redis] API Connected successfully');
});

redisConnection.on('error', (err: Error) => {
    console.error('[Redis] API Connection error:', err);
});

redisConnection.on('reconnecting', () => {
    console.warn('[Redis] API Attempting to reconnect...');
});
