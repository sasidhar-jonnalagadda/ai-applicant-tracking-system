import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Explicitly load environment variables from the workspace root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

/**
 * Environment variable schema for the Backend API.
 * Ensures all required services (Express, Redis, S3, MongoDB, AI) are configured.
 */
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  
  // Infrastructure
  MONGODB_URI: z.string().min(1, "MongoDB URI is required"),
  
  // Redis (Queue Producer)
  REDIS_URL: z.string().url(),
  
  // AWS (S3 Storage)
  AWS_REGION: z.string().min(1, "AWS Region is required"),
  AWS_ACCESS_KEY_ID: z.string().min(1, "AWS Access Key is required"),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, "AWS Secret Access Key is required"),
  AWS_S3_BUCKET: z.string().min(1, "S3 Bucket Name is required"),
  
  // AI (Gemini)
  GEMINI_API_KEY: z.string().min(1, "Gemini API Key is required"),

  // CORS [S-1] — strictly required in production
  FRONTEND_URL: z.string().url(),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('[ENV:FATAL] Invalid environment variables in Backend API:');
  console.error(JSON.stringify(_env.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = _env.data;
