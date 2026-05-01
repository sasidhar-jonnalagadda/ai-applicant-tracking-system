import mongoose, { Schema, Document, Model } from 'mongoose';
import { JobStatus } from '../types/job';

/**
 * Interface representing an Ingestion Task in the database.
 */
export interface ITask extends Document {
  jobPostingId: mongoose.Types.ObjectId;
  fileUrl: string;
  status: JobStatus;
  error?: string;
  candidateId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema: Schema = new Schema({
  jobPostingId: { 
    type: Schema.Types.ObjectId, 
    ref: 'JobPosting', 
    required: true,
    index: true // Faster lookup for job-specific tasks
  },
  fileUrl: { type: String, required: true },
  status: { 
    type: String, 
    enum: Object.values(JobStatus), 
    default: JobStatus.PENDING,
    index: true // Optimize filtering by status
  },
  error: { type: String },
  candidateId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Candidate',
    index: true 
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

/**
 * Properly typed Mongoose model export [T-3].
 * Eliminates the need for `as any` casts in downstream consumers.
 */
export const Task: Model<ITask> = mongoose.models.Task || mongoose.model<ITask>('Task', TaskSchema);
