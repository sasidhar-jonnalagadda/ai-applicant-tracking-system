import { Router, Request, Response } from 'express';
import { JobPostingSchema } from '@repo/shared';
import { JobPostingModel, Task } from '@repo/shared/models';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/**
 * GET /api/jobs
 * Returns all active job postings for context selection.
 */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  // [T-3] Removed `as any` cast — model is now properly typed
  const jobs = await JobPostingModel.find().sort({ createdAt: -1 });
  return res.json(jobs);
}));

/**
 * POST /api/jobs
 * Creates a new job posting.
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const validatedData = JobPostingSchema.parse(req.body);
  // [T-3] Removed `as any` cast
  const job = new JobPostingModel(validatedData);
  await job.save();
  return res.status(201).json(job);
}));

/**
 * GET /api/jobs/tasks/:taskId
 * Polls for the status of a resume ingestion task.
 */
router.get('/tasks/:taskId', asyncHandler(async (req: Request, res: Response) => {
  const { taskId } = req.params;
  // [T-3] Removed `as any` cast
  const task = await Task.findById(taskId);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  return res.json({
    status: task.status,
    candidateId: task.candidateId,
    error: task.error
  });
}));

/**
 * DELETE /api/jobs/:id
 * Removes a job posting.
 */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  // [T-3] Removed `as any` cast
  const job = await JobPostingModel.findByIdAndDelete(id);
  
  if (!job) {
    return res.status(404).json({ error: 'Job Posting not found' });
  }

  return res.json({ message: 'Job Posting deleted successfully' });
}));

export default router;
