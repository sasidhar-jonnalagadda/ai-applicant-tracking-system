import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Candidate } from '@repo/shared/models';
import { ICandidateDTO } from '@repo/shared';
import { aiService } from '../services/ai.service';
import { asyncHandler } from '../utils/asyncHandler';
import { logger } from '@repo/shared/logger';

const router = Router();

/**
 * Maximum number of results allowed per search request [D-2].
 */
const MAX_SEARCH_LIMIT = 50;

/**
 * POST /api/candidates/search
 */
router.post('/search', asyncHandler(async (req: Request, res: Response) => {
  const { query, jobPostingId, limit = 10 } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  const safeLimit = Math.min(Math.max(1, Number(limit) || 10), MAX_SEARCH_LIMIT);

  try {
    const queryVector = await aiService.generateEmbedding(query);

    const pipeline: mongoose.PipelineStage[] = [
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryVector,
          numCandidates: 100,
          limit: safeLimit,
          ...(jobPostingId && {
            filter: {
              jobPostingId: new mongoose.Types.ObjectId(jobPostingId)
            }
          })
        }
      } as mongoose.PipelineStage,
      {
        $project: {
          embedding: 0,
          score: { $meta: "vectorSearchScore" }
        }
      }
    ];

    const results = await Candidate.aggregate<ICandidateDTO>(pipeline);
    logger.info({ query, jobPostingId, resultsCount: results.length }, '[ROUTE:CANDIDATES] Semantic search performed');
    return res.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ err: message, query, jobPostingId }, '[ROUTE:CANDIDATES] Semantic search failed');
    return res.status(500).json({ error: 'Failed to perform semantic search.' });
  }
}));

/**
 * GET /api/candidates/:id
 * Retrieves full candidate profile.
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  try {
    // [T-3] Removed `as any` cast
    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) {
      logger.warn({ candidateId: req.params.id }, '[ROUTE:CANDIDATES] Candidate not found');
      return res.status(404).json({ error: 'Candidate not found' });
    }
    return res.json(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ err: message, candidateId: req.params.id }, '[ROUTE:CANDIDATES] Candidate fetch failure');
    return res.status(500).json({ error: 'Failed to fetch candidate details.' });
  }
}));

export default router;

