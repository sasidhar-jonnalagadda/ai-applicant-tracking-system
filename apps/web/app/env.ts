import { z } from 'zod';

/**
 * Frontend Environment Variable Schema
 * Validates variables required by the Next.js client and server.
 * 
 * Note: Workspace .env loading is handled during server-side initialization
 * to avoid bundling Node.js modules (fs, path) into the client-side bundle.
 */

// Server-side only environment loading
if (typeof window === 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = require('dotenv');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
  } catch {
    // Gracefully handle if dotenv is missing in certain environments
  }
}

const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().min(1).default('http://localhost:3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const _env = envSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NODE_ENV: process.env.NODE_ENV,
});

if (!_env.success) {
  console.error('❌ Invalid Frontend environment variables:');
  console.error(JSON.stringify(_env.error.flatten().fieldErrors, null, 2));
  throw new Error('Invalid environment variables');
}

export const env = _env.data;
