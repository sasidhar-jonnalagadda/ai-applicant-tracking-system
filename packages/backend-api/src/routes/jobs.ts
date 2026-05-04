import { Router, Request, Response } from 'express';
import { JobPostingSchema } from '@repo/shared';
import { JobPostingModel, Task } from '@repo/shared/models';
import { logger } from '@repo/shared/logger';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/**
 * GET /api/jobs
 * Returns all active job postings for context selection.
 */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const jobs = await JobPostingModel.find().sort({ createdAt: -1 });
  return res.json(jobs);
}));

/**
 * POST /api/jobs
 * Creates a new job posting.
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const validatedData = JobPostingSchema.parse(req.body);
  const job = new JobPostingModel(validatedData);
  await job.save();
  logger.info({ jobId: job._id, title: job.title }, '[ROUTE:JOBS] New Job Posting created');
  return res.status(201).json(job);
}));

/**
 * GET /api/jobs/tasks/:taskId
 * Polls for the status of a resume ingestion task.
 */
router.get('/tasks/:taskId', asyncHandler(async (req: Request, res: Response) => {
  const { taskId } = req.params;
  const task = await Task.findById(taskId);
  
  if (!task) {
    logger.warn({ taskId }, '[ROUTE:JOBS] Task status poll failed: Not found');
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
  const job = await JobPostingModel.findByIdAndDelete(id);
  
  if (!job) {
    logger.warn({ jobId: id }, '[ROUTE:JOBS] Delete failed: Not found');
    return res.status(404).json({ error: 'Job Posting not found' });
  }

  logger.info({ jobId: id }, '[ROUTE:JOBS] Job Posting deleted');
  return res.json({ message: 'Job Posting deleted successfully' });
}));

export default router;
