import { Router, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import multerS3 from 'multer-s3';
import mongoose from 'mongoose';
import { s3Client, BUCKET_NAME } from '../config/s3';
import { IResumeJobData } from '@repo/shared';
import { Task, JobPostingModel } from '@repo/shared/models';
import { logger } from '@repo/shared/logger';
import { enqueueResumeJob } from '../services/queue';

const router = Router();

/**
 * Production Storage Strategy:
 * Strictly use AWS S3 for all resume uploads. Local fallback is disabled.
 */
const storage = multerS3({
  s3: s3Client,
  bucket: BUCKET_NAME,
  metadata: (_req, file, cb) => {
    cb(null, { fieldName: file.fieldname });
  },
  key: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `resumes/${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('INVALID_FILE_TYPE'));
    }
    cb(null, true);
  }
}).array('resumes', 50);

/**
 * POST /api/upload
 */
router.post('/', (req: Request, res: Response) => {
  upload(req, res, async (err: unknown) => {
    if (err) {
      if (err instanceof MulterError) {
        logger.warn({ errCode: err.code, message: err.message }, '[ROUTE:UPLOAD] Multer rejection');
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ error: 'Too many files or incorrect field name. Maximum is 50.' });
        }
        return res.status(400).json({ error: `Upload Error: ${err.message}` });
      }

      if (err instanceof Error) {
        if (err.message === 'INVALID_FILE_TYPE') {
          return res.status(415).json({ error: 'Only PDF files are allowed.' });
        }
        // Gracefully catch S3-related connection or permission errors
        logger.error({ err: err.message }, '[ROUTE:UPLOAD] S3 Storage Failure');
        return res.status(500).json({ error: 'Storage service unavailable. Please check AWS configuration.' });
      }
      return res.status(400).json({ error: 'Unknown upload error.' });
    }

    const files = req.files as Express.MulterS3.File[];
    const { jobPostingId } = req.body as { jobPostingId?: string };

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided.' });
    }

    if (!jobPostingId || !mongoose.Types.ObjectId.isValid(jobPostingId)) {
      return res.status(400).json({ error: 'A valid jobPostingId is required.' });
    }

    try {
      const jobExists = await JobPostingModel.exists({ _id: jobPostingId });
      if (!jobExists) {
        logger.warn({ jobPostingId }, '[ROUTE:UPLOAD] Upload failed: Job Posting not found');
        return res.status(404).json({ error: 'The specified Job Posting does not exist.' });
      }

      const taskIds: string[] = [];

      for (const file of files) {
        const task = new Task({
          jobPostingId,
          fileUrl: file.location,
          status: 'PENDING'
        });
        await task.save();

        const jobData: IResumeJobData = {
          taskId: String(task._id),
          s3Key: file.key,
          s3Bucket: file.bucket || BUCKET_NAME,
          jobPostingId
        };

        await enqueueResumeJob(jobData);
        taskIds.push(String(task._id));
      }

      logger.info({ jobPostingId, fileCount: files.length }, '[ROUTE:UPLOAD] Resumes accepted for processing');
      return res.status(202).json({
        message: `Accepted ${files.length} resumes for cloud processing.`,
        taskIds
      });

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ err: errorMessage, jobPostingId }, '[ROUTE:UPLOAD] Task initialization failure');
      return res.status(500).json({ error: 'Failed to initialize ingestion task(s).' });
    }
  });
});

export default router;