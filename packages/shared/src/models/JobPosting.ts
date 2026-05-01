import mongoose, { Schema, Document, Model } from 'mongoose';
import { JobPosting } from '../types/job';

/**
 * Interface representing a Job Posting in the database.
 */
export interface IJobPosting extends Omit<JobPosting, 'id'>, Document {
  createdAt: Date;
  updatedAt: Date;
}

const JobPostingMongooseSchema: Schema = new Schema({
  title: { 
    type: String, 
    required: true,
    index: true 
  },
  description: { type: String, required: true },
  department: { 
    type: String, 
    required: true,
    index: true 
  },
  requirements: [{ type: String, required: true }]
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Text index for basic job searching capability
JobPostingMongooseSchema.index({ title: 'text', department: 'text' });

/**
 * Properly typed Mongoose model export [T-3].
 * Eliminates the need for `as any` casts in downstream consumers.
 */
export const JobPostingModel: Model<IJobPosting> = mongoose.models.JobPosting || mongoose.model<IJobPosting>('JobPosting', JobPostingMongooseSchema);
