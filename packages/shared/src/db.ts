import mongoose from 'mongoose';
import { logger } from './utils/logger';

/**
 * Module-level guard to prevent event listener accumulation [D-5].
 */
let listenersAttached = false;

/**
 * Centralized Database Connection Utility.
 */
export async function connectToDatabase(uri: string) {
    if (mongoose.connection.readyState >= 1) {
        return;
    }

    if (!listenersAttached) {
        mongoose.connection.on('connected', () => {
            logger.info('[DB] Connected to MongoDB');
        });

        mongoose.connection.on('error', (err: unknown) => {
            logger.error({ err }, '[DB:ERROR] Connection error');
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('[DB:WARN] Disconnected from MongoDB');
        });

        listenersAttached = true;
    }

    try {
        await mongoose.connect(uri, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
    } catch (error) {
        logger.fatal({ err: error }, '[DB:FATAL] Initial connection failed');
        throw error;
    }
}