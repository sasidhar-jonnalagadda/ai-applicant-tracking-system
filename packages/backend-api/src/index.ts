import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { connectToDatabase } from '@repo/shared/models';
import { env } from './config/env';
import jobsRouter from './routes/jobs';
import candidatesRouter from './routes/candidates';
import uploadRouter from './routes/upload';

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

const app = express();
const port = env.PORT;

/**
 * Global Security & Performance Middleware
 */
app.set('trust proxy', 1); // Required for rate limiting behind load balancers
app.use(helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
    crossOriginEmbedderPolicy: false, // Required for S3 file serving
}));

/**
 * [S-1] CORS Configuration
 * 
 * Production: Restrict to FRONTEND_URL environment variable.
 * Development/Test: Allow all origins for local development.
 */
const corsOptions: cors.CorsOptions = env.NODE_ENV === 'production' && env.FRONTEND_URL
    ? {
        origin: env.FRONTEND_URL,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
    }
    : {};

app.use(cors(corsOptions));
app.use(compression()); // Gzip compression for smaller payloads
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev')); // HTTP Request logging
app.use(express.json());

/**
 * Differentiated Rate Limiting
 * 
 * Strict limiter: Protects mutation endpoints (upload, job creation, search).
 * Polling limiter: Relaxed limit for high-frequency task status checks.
 *   The frontend polls GET /api/jobs/tasks/:taskId every 3s per task.
 *   With 50 files, that's ~1000 req/min from a single IP.
 */
const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

const pollingLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute window
    max: 300,               // 300 req/min allows 50 tasks × 20 polls/min
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Polling rate exceeded. Slow down status checks.' }
});

// Route-specific limiter MUST be registered before the catch-all
app.use('/api/jobs/tasks', pollingLimiter);
app.use('/api/', strictLimiter);

// API Routes
app.use('/api/jobs', jobsRouter);
app.use('/api/candidates', candidatesRouter);
app.use('/api/upload', uploadRouter);

/**
 * Enhanced Health Check
 * Returns current system readiness including DB connection status.
 */
app.get('/health', (_req, res) => {
    const isDbConnected = mongoose.connection.readyState === 1;
    res.status(isDbConnected ? 200 : 503).json({
        status: isDbConnected ? 'ok' : 'unhealthy',
        database: isDbConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
        env: env.NODE_ENV
    });
});

/**
 * Centralized Global Error Handler
 * 
 * Catches Zod validation errors, Mongoose errors, and generic exceptions.
 * Returns standardized JSON envelopes instead of crashing the Node process.
 */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // --- Zod Validation Errors (from schema.parse() in routes) ---
    if (err && typeof err === 'object' && 'issues' in err) {
        const zodErr = err as { issues: { path: (string | number)[]; message: string }[] };
        console.error('[SERVER:VALIDATION]', JSON.stringify(zodErr.issues));
        return res.status(400).json({
            error: 'Validation Error',
            details: zodErr.issues.map(i => ({
                field: i.path.join('.'),
                message: i.message
            }))
        });
    }

    // --- Mongoose Validation Errors ---
    if (err instanceof Error && err.name === 'ValidationError') {
        console.error('[SERVER:DB_VALIDATION]', err.message);
        return res.status(400).json({
            error: 'Database Validation Error',
            message: err.message
        });
    }

    // --- Mongoose CastError (invalid ObjectId) ---
    if (err instanceof Error && err.name === 'CastError') {
        return res.status(400).json({
            error: 'Invalid ID format',
            message: 'The provided resource ID is malformed.'
        });
    }

    // --- Generic Server Errors ---
    const message = err instanceof Error ? err.message : 'Unknown error';
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[SERVER:ERROR]', message, env.NODE_ENV === 'development' ? stack : '');

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
            console.info(`[BACKEND:API] Listening on port ${port} (${env.NODE_ENV} mode)`);
        });

        /**
         * Graceful Shutdown Handler
         */
        const gracefulShutdown = async () => {
            console.info('\n[SERVER] Graceful shutdown initiated...');

            server.close(async () => {
                console.info('[SERVER] HTTP server closed.');
                try {
                    await mongoose.connection.close();
                    console.info('[SERVER] MongoDB connection closed.');
                    process.exit(0);
                } catch (error) {
                    console.error('[SERVER] Error during DB close:', error);
                    process.exit(1);
                }
            });

            // Force close after 10 seconds
            setTimeout(() => {
                console.error('[SERVER] Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
    })
    .catch((err) => {
        console.error('[SERVER:FATAL] Application failed to start:', err);
        process.exit(1);
    });