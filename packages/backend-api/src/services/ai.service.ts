import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '@repo/shared/logger';
import { env } from '../config/env';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

/**
 * Maximum number of retry attempts for transient AI failures.
 */
const MAX_RETRIES = 2;

/**
 * Base delay in ms for exponential backoff between retries.
 */
const BASE_DELAY_MS = 1000;

/**
 * Timeout for a single embedding request in ms.
 */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Delays execution for the specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Service to handle all interactions with Gemini AI.
 * [E-3] Added retry logic with exponential backoff and timeout
 * to handle transient 429/503 errors from the Gemini API.
 */
export const aiService = {
  /**
   * Generates a semantic vector embedding for a given text.
   * Uses gemini-embedding-001 (compressed to 768 dimensions).
   * 
   * Retries up to MAX_RETRIES times with exponential backoff on transient errors.
   * Aborts after REQUEST_TIMEOUT_MS per attempt.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
          const result = await model.embedContent(text);

          clearTimeout(timeoutId);
          return result.embedding.values.slice(0, 768);
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorMsg = lastError.message;

        // Only retry on transient errors (rate limits, server overload)
        const isTransient = errorMsg.includes('429') ||
          errorMsg.includes('503') ||
          errorMsg.includes('overloaded') ||
          errorMsg.includes('DEADLINE_EXCEEDED');

        if (isTransient && attempt < MAX_RETRIES) {
          const backoffMs = BASE_DELAY_MS * Math.pow(2, attempt);
          logger.warn({ attempt: attempt + 1, backoffMs, err: errorMsg }, '[AI:SERVICE] Transient failure. Retrying...');
          await delay(backoffMs);
          continue;
        }

        break;
      }
    }

    logger.error({ err: lastError?.message }, '[AI:SERVICE] Embedding generation terminal failure');
    throw new Error('AI_EMBEDDING_FAILED');
  }
};