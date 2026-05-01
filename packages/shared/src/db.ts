import mongoose from 'mongoose';

/**
 * Module-level guard to prevent event listener accumulation [D-5].
 * Without this, calling connectToDatabase() multiple times (e.g., in tests)
 * would register duplicate listeners on each call.
 */
let listenersAttached = false;

/**
 * Centralized Database Connection Utility.
 * 
 * Ensures a singleton connection and attaches standard error listeners
 * for production monitoring.
 */
export async function connectToDatabase(uri: string) {
  if (mongoose.connection.readyState >= 1) {
    return;
  }

  if (!listenersAttached) {
    const connection = mongoose.connection as any;

    connection.on('connected', () => {
      console.info('[DB] Connected to MongoDB.');
    });

    connection.on('error', (err: any) => {
      console.error('[DB:ERROR] Connection error:', err);
    });

    connection.on('disconnected', () => {
      console.warn('[DB:WARN] Disconnected. Reconnecting...');
    });

    listenersAttached = true;
  }

  try {
    await mongoose.connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    } as any);
  } catch (error) {
    console.error('[DB:FATAL] Initial connection failed:', error);
    throw error;
  }
}