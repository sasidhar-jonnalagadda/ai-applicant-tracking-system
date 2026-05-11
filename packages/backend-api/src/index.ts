import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { connectToDatabase } from '@repo/shared/models';
import { logger } from '@repo/shared/logger';
import { env } from './config/env';
import jobsRouter from './routes/jobs';
import candidatesRouter from './routes/candidates';
import uploadRouter from './routes/upload';

/**
 * Process-Level Safety Net
 * Prevents silent crashes from unhandled promise rejections.
 */
process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ reason }, '[PROCESS:FATAL] Unhandled Rejection');
    process.exit(1);
});

process.on('uncaughtException', (error: Error) => {
    logger.fatal({ error }, '[PROCESS:FATAL] Uncaught Exception');
    process.exit(1);
});

const app = express();
const port = env.PORT;

/**
 * Global Security & Performance Middleware
 * 
 * [S-2] Configured Helmet for production-ready security headers.
 */
app.set('trust proxy', 1); // Required for rate limiting behind load balancers
app.use(helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production' ? {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "img-src": ["'self'", "data:", "https:", "*.s3.amazonaws.com"],
        },
    } : false,
    crossOriginEmbedderPolicy: false,
}));

/**
 * [S-1] Bulletproof CORS Configuration
 * Allows the environment variable, local development, and a hardcoded failsafe.
 */
app.use(cors({
    origin: [
        env.FRONTEND_URL,
        'http://localhost:3000',
        'https://ai-applicant-tracking-system-web.vercel.app'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));

app.use(compression()); 
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: { write: (message) => logger.info(message.trim()) }
}));
app.use(express.json());

/**
 * Differentiated Rate Limiting
 */
const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

const pollingLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Polling rate exceeded. Slow down status checks.' }
});

app.use('/api/jobs/tasks', pollingLimiter);
app.use('/api/', strictLimiter);

// API Routes
app.use('/api/jobs', jobsRouter);
app.use('/api/candidates', candidatesRouter);
app.use('/api/upload', uploadRouter);

/**
 * Enhanced Health Check
 */
app.get('/health', (_req, res) => {
    const isDbConnected = mongoose.connection.readyState === 1;
    res.status(isDbConnected ? 200 : 503).json({
        status: isDbConnected ? 'ok' : 'unhealthy',
        database: isDbConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
    });
});

/**
 * Centralized Global Error Handler
 */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err && typeof err === 'object' && 'issues' in err) {
        const zodErr = err as { issues: { path: (string | number)[]; message: string }[] };
        logger.warn({ zodErr: zodErr.issues }, '[SERVER:VALIDATION] Payload rejected');
        return res.status(400).json({
            error: 'Validation Error',
            details: zodErr.issues.map(i => ({
                field: i.path.join('.'),
                message: i.message
            }))
        });
    }

    if (err instanceof Error && err.name === 'ValidationError') {
        logger.error({ error: err.message }, '[SERVER:DB_VALIDATION] Database constraint violation');
        return res.status(400).json({
            error: 'Database Validation Error',
            message: err.message
        });
    }

    const message = err instanceof Error ? err.message : 'Unknown error';
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error({ err: { message, stack } }, '[SERVER:ERROR] Internal exception');

    return res.status(500).json({
        error: 'Internal Server Error',
        message: env.NODE_ENV === 'development' ? message : undefined
    });
});

/**
 * Database Initialization & Server Startup
 */
connectToDatabase(env.MONGODB_URI)
    .then(() => {
        const server = app.listen(port, () => {
            logger.info(`[BACKEND:API] Server listening on port ${port} in ${env.NODE_ENV} mode`);
        });

        const gracefulShutdown = async (signal: string) => {
            logger.info({ signal }, `[SERVER] ${signal} received. Initiating graceful shutdown...`);

            server.close(async () => {
                logger.info('[SERVER] HTTP server closed.');
                try {
                    await mongoose.connection.close();
                    logger.info('[SERVER] MongoDB connection closed.');
                    process.exit(0);
                } catch (error) {
                    logger.error({ error }, '[SERVER] Error during DB close');
                    process.exit(1);
                }
            });

            setTimeout(() => {
                logger.fatal('[SERVER] Shutdown timed out. Forcefully exiting.');
                process.exit(1);
            }, 10000).unref();
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    })
    .catch((err) => {
        logger.fatal({ err }, '[SERVER:FATAL] Application failed to start');
        process.exit(1);
    });