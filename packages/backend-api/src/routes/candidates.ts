import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Candidate } from '@repo/shared/models';
import { aiService } from '../services/ai.service';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/**
 * Maximum number of results allowed per search request [D-2].
 * Prevents resource exhaustion from unbounded limit values.
 */
const MAX_SEARCH_LIMIT = 50;

/**
 * POST /api/candidates/search
 * Semantic search using vector embeddings.
 */
router.post('/search', asyncHandler(async (req: Request, res: Response) => {
  const { query, jobPostingId, limit = 10 } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  // [D-2] Clamp limit to prevent resource exhaustion from unbounded values
  const safeLimit = Math.min(Math.max(1, Number(limit) || 10), MAX_SEARCH_LIMIT);

  // 1. Generate embedding for the search query
  const queryVector = await aiService.generateEmbedding(query);

  // 2. Perform vector search using MongoDB Aggregation Pipeline
  // [D-1] Typed pipeline stages — $vectorSearch is an Atlas-specific stage
  // that is not in the standard Mongoose PipelineStage union, so we use
  // a typed array of pipeline stage objects.
  const pipeline: mongoose.PipelineStage[] = [
    {
      $vectorSearch: {
        index: "vector_index", // This must match the index name in Atlas
        path: "embedding",
        queryVector: queryVector,
        numCandidates: 100,
        limit: safeLimit,
        // Pre-filter by job context BEFORE the limit is applied
        ...(jobPostingId && {
          filter: {
            jobPostingId: new mongoose.Types.ObjectId(jobPostingId)
          }
        })
      }
    } as mongoose.PipelineStage,
    // Project results with score (exclude raw embedding)
    {
      $project: {
        embedding: 0,
        score: { $meta: "vectorSearchScore" }
      }
    }
  ];

  // [T-3] Removed `as any` cast — Candidate model is now properly typed
  const results = await Candidate.aggregate(pipeline);
  return res.json(results);
}));

/**
 * GET /api/candidates/:id
 * Retrieves full candidate profile.
 */
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  // [T-3] Removed `as any` cast
  const candidate = await Candidate.findById(req.params.id);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  return res.json(candidate);
}));

export default router;
