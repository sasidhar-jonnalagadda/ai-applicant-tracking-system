import { Job, UnrecoverableError } from 'bullmq';
import pdfParse from 'pdf-parse';
import fs from 'fs';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET_NAME } from '../config/s3';
import { env } from '../config/env';
import { IResumeJobData, CandidateProfileSchema, JobStatus } from '@repo/shared';
import { Task, Candidate, JobPostingModel } from '@repo/shared/models';
import { Readable } from 'stream';

// Initialize AI Client with validated environment
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

/**
 * Strict Schema Definition for Gemini Structured Output
 */
const candidateSchemaDefinition = {
  type: SchemaType.OBJECT,
  properties: {
    personalInfo: {
      type: SchemaType.OBJECT,
      properties: {
        fullName: { type: SchemaType.STRING },
        email: { type: SchemaType.STRING },
        phone: { type: SchemaType.STRING, nullable: true },
        linkedinUrl: { type: SchemaType.STRING, nullable: true },
        githubUrl: { type: SchemaType.STRING, nullable: true },
      },
      required: ['fullName', 'email'] as const,
    },
    summary: { type: SchemaType.STRING },
    totalYearsExperience: { type: SchemaType.INTEGER },
    skills: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          category: {
            type: SchemaType.STRING,
            description: "Must be 'Frontend', 'Backend', 'DevOps', 'Database', or 'Other'"
          },
          name: { type: SchemaType.STRING },
        },
        required: ['category', 'name'] as const,
      },
    },
    experience: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          company: { type: SchemaType.STRING },
          role: { type: SchemaType.STRING },
          startDate: { type: SchemaType.STRING },
          endDate: { type: SchemaType.STRING },
          highlights: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ['company', 'role', 'startDate', 'endDate'] as const,
      },
    },
    education: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          institution: { type: SchemaType.STRING },
          degree: { type: SchemaType.STRING },
          graduationYear: { type: SchemaType.INTEGER, nullable: true },
        },
        required: ['institution', 'degree'] as const,
      },
    },
    analysis: {
      type: SchemaType.OBJECT,
      properties: {
        pros: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        cons: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        missingKeywords: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        interviewQuestions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      },
      required: ['pros', 'cons', 'missingKeywords', 'interviewQuestions'] as const,
    },
  },
  required: ['personalInfo', 'summary', 'totalYearsExperience', 'skills', 'experience', 'education', 'analysis'] as const,
};

/**
 * Memory-Safe S3 Stream Consumer
 * [T-5] Properly typed chunk as Uint8Array instead of `as any`.
 */
async function consumeStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * Determines if an error is transient (should be retried by BullMQ)
 * vs permanent (should immediately fail with no retries).
 */
function isTransientError(errorMessage: string): boolean {
  return errorMessage.includes('429') || 
         errorMessage.includes('503') ||
         errorMessage.includes('overloaded') ||
         errorMessage.includes('ECONNRESET') ||
         errorMessage.includes('DEADLINE_EXCEEDED');
}

/**
 * BullMQ Worker Processor: Resume Parsing & Ingestion Logic
 *
 * [E-1] Uses UnrecoverableError for non-transient failures to prevent wasteful retries.
 * [E-2] S3 cleanup only runs on successful completion, not in finally block.
 * [E-4] JSON.parse is wrapped in try/catch with descriptive error.
 * [T-3] Removed all `as any` casts on model operations.
 */
export const processResume = async (job: Job<IResumeJobData>) => {
  const { taskId, s3Key, s3Bucket, jobPostingId } = job.data;

  console.info(`[WORKER:PROCESSOR] Starting processing | Task: ${taskId} | Job: ${job.id}`);

  try {
    // 1. Atomic State Transition: PROCESSING
    const task = await Task.findById(taskId);
    if (!task) {
      throw new UnrecoverableError('TASK_NOT_FOUND');
    }
    
    task.status = JobStatus.PROCESSING;
    await task.save();

    // 2. Multi-Source Ingestion (Local Fallback Support)
    let pdfBuffer: Buffer;
    const isLocal = s3Bucket === 'LOCAL_STORAGE' || fs.existsSync(s3Key);

    if (isLocal) {
      console.info(`[WORKER:INGESTION] Reading file from local storage: ${s3Key}`);
      pdfBuffer = await fs.promises.readFile(s3Key);
    } else {
      console.info(`[WORKER:INGESTION] Fetching file from S3: ${s3Key}`);
      const getObjectResult = await s3Client.send(new GetObjectCommand({
        Bucket: s3Bucket || BUCKET_NAME,
        Key: s3Key,
      }));

      if (!getObjectResult.Body) {
        throw new UnrecoverableError('S3_EMPTY_BODY');
      }
      pdfBuffer = await consumeStreamToBuffer(getObjectResult.Body as Readable);
    }

    // 3. Unstructured Data Extraction
    const pdfData = await pdfParse(pdfBuffer);
    const rawText = pdfData.text;

    if (!rawText || rawText.trim().length === 0) {
      throw new UnrecoverableError('PDF_EXTRACTION_EMPTY');
    }

    // Fetch Job Posting Context
    const jobPosting = await JobPostingModel.findById(jobPostingId);
    if (!jobPosting) {
      throw new UnrecoverableError('JOB_POSTING_NOT_FOUND');
    }

    // 4. AI-Powered Structured Parsing (High-Throughput: gemini-2.5-flash)
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: candidateSchemaDefinition as Parameters<typeof genAI.getGenerativeModel>[0] extends { generationConfig?: { responseSchema?: infer S } } ? S : never,
      }
    });

    const prompt = `
Extract candidate details from this resume text and perform a match analysis against the target job posting.

Target Job Posting:
Title: ${jobPosting.title}
Department: ${jobPosting.department}
Description: ${jobPosting.description}
Requirements: ${jobPosting.requirements.join(', ')}

Resume Text:
${rawText}

Instructions:
1. Extract the structured personal info, skills, experience, and education.
2. Under "analysis", strictly compare the extracted resume data against the target job posting.
3. "pros": List strong points where the candidate matches the job.
4. "cons": List weaknesses or mismatched areas.
5. "missingKeywords": Identify technical skills or requirements from the job description that are missing from the resume.
6. "interviewQuestions": Generate exactly 3 highly specific technical or behavioral interview questions tailored to bridge the gaps or test the strengths of this specific candidate against this specific role.
`;
    const result = await model.generateContent(prompt);

    // [E-4] Guard JSON.parse against malformed Gemini responses
    let rawCandidateData: unknown;
    try {
      rawCandidateData = JSON.parse(result.response.text());
    } catch (parseError) {
      const parseMsg = parseError instanceof Error ? parseError.message : 'Unknown parse error';
      console.error(`[WORKER:PARSE_ERROR] Gemini returned invalid JSON for Task ${taskId}:`, parseMsg);
      throw new UnrecoverableError(`AI_RESPONSE_PARSE_FAILED: ${parseMsg}`);
    }

    // 5. THE INGESTION SHIELD: Production-Grade Zod Validation
    const validatedCandidateData = CandidateProfileSchema.parse(rawCandidateData);

    // 6. Semantic Vector Generation (Pro-Grade: gemini-embedding-2)
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
    const textToEmbed = `${validatedCandidateData.summary} Skills: ${validatedCandidateData.skills.map((s) => s.name).join(', ')}`;
    const embeddingResult = await embeddingModel.embedContent(textToEmbed);

    // 7. Database Persistence
    const candidate = new Candidate({
      jobPostingId,
      resumeUrl: isLocal ? `local://${s3Key}` : `s3://${s3Bucket || BUCKET_NAME}/${s3Key}`,
      ...validatedCandidateData,
      embedding: embeddingResult.embedding.values,
    });

    await candidate.save();

    // 8. Atomic State Transition: COMPLETED
    task.status = JobStatus.COMPLETED;
    task.candidateId = candidate._id;
    await task.save();

    // 9. [E-2] Cleanup ONLY on successful completion — NOT in finally block.
    // This prevents deleting the source file before a retry attempt.
    try {
      if (s3Bucket !== 'LOCAL_STORAGE' && !fs.existsSync(s3Key)) {
        await s3Client.send(new DeleteObjectCommand({
          Bucket: s3Bucket || BUCKET_NAME,
          Key: s3Key,
        }));
        console.info(`[WORKER:CLEANUP] Successfully removed S3 object: ${s3Key}`);
      } else {
        console.info(`[WORKER:CLEANUP] Skipping cleanup for local storage: ${s3Key}`);
      }
    } catch (cleanupError) {
      const cleanupMsg = cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error';
      console.error(`[WORKER:CLEANUP_ERROR] Failed to delete file ${s3Key}:`, cleanupMsg);
      // Don't fail the job for cleanup errors — the candidate is already saved
    }

    return { candidateId: String(candidate._id) };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[WORKER:ERROR] Job ${job.id} failed:`, errorMessage);

    // [E-1] If it's already an UnrecoverableError, BullMQ won't retry it.
    // If it's a transient error, re-throw to trigger exponential backoff retry.
    if (error instanceof UnrecoverableError) {
      // Mark task as FAILED in DB before BullMQ receives the unrecoverable signal
      try {
        await Task.findByIdAndUpdate(taskId, { 
          status: 'FAILED', 
          error: errorMessage 
        });
      } catch (dbError) {
        console.error('[WORKER:DB_ERROR] Failed to update task status to FAILED:', dbError);
      }
      throw error; // BullMQ will NOT retry this
    }

    if (isTransientError(errorMessage)) {
      console.warn(`[WORKER:RETRY] Transient failure detected. Triggering exponential backoff for Job ${job.id}`);
      throw error; // BullMQ WILL retry this with backoff
    }

    // Unknown errors — mark as failed and don't retry
    try {
      await Task.findByIdAndUpdate(taskId, { 
        status: 'FAILED', 
        error: errorMessage 
      });
    } catch (dbError) {
      console.error('[WORKER:DB_ERROR] Failed to update task status to FAILED:', dbError);
    }

    throw new UnrecoverableError(errorMessage);
  }
};
