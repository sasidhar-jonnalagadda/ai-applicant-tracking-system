import { Router, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import multerS3 from 'multer-s3';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { s3Client, BUCKET_NAME } from '../config/s3';
import { env } from '../config/env';
import { IResumeJobData } from '@repo/shared';
import { Task, JobPostingModel } from '@repo/shared/models';
import { enqueueResumeJob } from '../services/queue';

const router = Router();

// Ensure local uploads directory exists for fallback
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Conditional Storage Strategy:
 * Use Local Disk if AWS credentials are 'dummy_access_key', otherwise use S3.
 */
const isDummyS3 = env.AWS_ACCESS_KEY_ID === 'dummy_access_key';

const storage = isDummyS3 
  ? multer.diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, UPLOADS_DIR);
      },
      filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
      }
    })
  : multerS3({
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
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: 'Unknown upload error.' });
    }

    const files = req.files as Express.Multer.File[] | Express.MulterS3.File[];
    const { jobPostingId } = req.body as { jobPostingId?: string };

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided.' });
    }

    if (!jobPostingId || !mongoose.Types.ObjectId.isValid(jobPostingId)) {
      return res.status(400).json({ error: 'A valid jobPostingId is required.' });
    }

    try {
      // [T-3] Removed `as any` — models are now properly typed
      const jobExists = await JobPostingModel.exists({ _id: jobPostingId });
      if (!jobExists) {
        return res.status(404).json({ error: 'The specified Job Posting does not exist.' });
      }

      const taskIds: string[] = [];
      const isLocal = files.length > 0 && 'path' in files[0]!;

      for (const file of files) {
        // [S-2] Normalize file information — use relative paths for local storage
        // to avoid exposing full filesystem paths in the database
        const localFile = file as Express.Multer.File;
        const s3File = file as Express.MulterS3.File;
        
        const fileIdentifier = isLocal 
          ? path.relative(process.cwd(), localFile.path) 
          : s3File.key;
        const fileUrl = isLocal 
          ? `local://${path.relative(process.cwd(), localFile.path)}` 
          : s3File.location;

        const task = new Task({
          jobPostingId,
          fileUrl,
          status: 'PENDING'
        });
        await task.save();

        const jobData: IResumeJobData = {
          taskId: String(task._id),
          s3Key: isLocal ? localFile.path : fileIdentifier, // Worker needs absolute path for local reads
          s3Bucket: !isLocal ? (s3File.bucket || BUCKET_NAME) : 'LOCAL_STORAGE',
          jobPostingId
        };

        await enqueueResumeJob(jobData);
        taskIds.push(String(task._id));
      }

      return res.status(202).json({
        message: isLocal ? `Accepted ${files.length} resumes for local processing.` : `Accepted ${files.length} resumes for cloud processing.`,
        taskIds
      });

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[ROUTE:UPLOAD] Processing failure:', errorMessage);
      return res.status(500).json({ error: 'Failed to initialize ingestion task(s).' });
    }
  });
});

export default router;