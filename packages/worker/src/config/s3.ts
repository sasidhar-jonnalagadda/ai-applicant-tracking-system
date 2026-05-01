import { S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

/**
 * Hardened S3 Client using validated production credentials.
 */
export const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

// [S-3] Unified to AWS_S3_BUCKET across all packages
export const BUCKET_NAME = env.AWS_S3_BUCKET;
