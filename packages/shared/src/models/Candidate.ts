import mongoose, { Schema, Document, Model } from 'mongoose';
import { ICandidateProfile } from '../types/candidate';

/**
 * Exact dimensionality of gemini-embedding-2 output vectors.
 * Used to validate embeddings at the schema level to prevent
 * corrupted vectors from poisoning search results [D-4].
 */
const EMBEDDING_DIMENSIONS = 768;

/**
 * Interface representing a Candidate in the database.
 */
export interface ICandidate extends ICandidateProfile, Document {
    jobPostingId: mongoose.Types.ObjectId;
    resumeUrl: string;
    embedding?: number[];
    createdAt: Date;
    updatedAt: Date;
}

// Sub-schemas for better organization and future validation rules
const PersonalInfoSchema = new Schema({
    fullName: { type: String, required: true, trim: true },
    email: {
        type: String,
        required: true,
        lowercase: true,
        // [D-3] Removed fragile regex that rejected valid TLDs like .technology/.museum.
        // Zod validates email format upstream in CandidateProfileSchema.parse().
    },
    phone: { type: String, default: null },
    linkedinUrl: { type: String, default: null },
    githubUrl: { type: String, default: null }
}, { _id: false });

const CandidateMongooseSchema: Schema = new Schema({
    jobPostingId: {
        type: Schema.Types.ObjectId,
        ref: 'JobPosting',
        required: true,
        index: true // Critical for job-specific candidate lists
    },
    resumeUrl: { type: String, required: true },
    personalInfo: { type: PersonalInfoSchema, required: true },
    summary: { type: String, required: true },
    skills: [{
        category: { type: String, enum: ['Frontend', 'Backend', 'DevOps', 'Database', 'Other'] },
        name: { type: String }
    }],
    totalYearsExperience: { type: Number, required: true, min: 0 },
    education: [{
        degree: { type: String, required: true },
        institution: { type: String, required: true },
        graduationYear: { type: Number, default: null }
    }],
    experience: [{
        company: { type: String, required: true },
        role: { type: String, required: true },
        startDate: { type: String, required: true },
        endDate: { type: String, required: true },
        highlights: [{ type: String }]
    }],
    /**
     * Vector embedding for semantic search.
     * Generated using gemini-embedding-2 (768 dimensions).
     * [D-4] Validated at schema level to prevent corrupted vectors.
     */
    embedding: {
        type: [Number],
        required: false,
        validate: {
            validator: function (v: number[]) {
                return !v || v.length === 0 || v.length === EMBEDDING_DIMENSIONS;
            },
            message: `Embedding must be exactly ${EMBEDDING_DIMENSIONS} dimensions (gemini-embedding-2).`
        }
    },
    /**
     * Explainable AI Match Analysis.
     */
    analysis: {
        pros: [{ type: String }],
        cons: [{ type: String }],
        missingKeywords: [{ type: String }],
        interviewQuestions: [{ type: String }]
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Compound index for optimized dashboard sorting
CandidateMongooseSchema.index({ jobPostingId: 1, createdAt: -1 });

/**
 * Properly typed Mongoose model export [T-3].
 * Eliminates the need for `as any` casts in downstream consumers.
 */
export const Candidate: Model<ICandidate> = mongoose.models.Candidate || mongoose.model<ICandidate>('Candidate', CandidateMongooseSchema);