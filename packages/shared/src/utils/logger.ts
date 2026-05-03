import pino from 'pino';

/**
 * Production-Grade Centralized Logger
 * 
 * Provides structured JSON logging in production for log aggregators (ELK, Datadog)
 * and human-readable 'pino-pretty' logging in development.
 */
export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production' ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'SYS:standard',
        },
    } : undefined,
});

export default logger;
