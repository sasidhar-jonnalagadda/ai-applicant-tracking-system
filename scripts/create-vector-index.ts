import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

/**
 * MongoDB Atlas Vector Search Index Setup Script
 * 
 * This script programmatically creates the required vector search index
 * on the 'candidates' collection. This is necessary for semantic search
 * using Gemini embeddings.
 */

// Load environment variables from .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = MONGODB_URI?.split('/').pop()?.split('?')[0] || 'ats-db';

async function createVectorIndex() {
  if (!MONGODB_URI) {
    console.error('[INDEX:ERROR] MONGODB_URI is not defined in environment variables.');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('[INDEX] Connected to MongoDB.');

    const db = client.db(DB_NAME);
    const collection = db.collection('candidates');

    /**
     * Vector Index Definition
     * Path: 'embedding' (matches Candidate model)
     * Dimensions: 768 (matches gemini-embedding-2)
     * Similarity: 'cosine'
     */
    const indexName = 'vector_index';
    const indexDefinition = {
      name: indexName,
      type: 'vectorSearch',
      definition: {
        fields: [
          {
            path: 'embedding',
            numDimensions: 768,
            similarity: 'cosine',
            type: 'vector'
          },
          {
            path: 'jobPostingId',
            type: 'filter'
          }
        ]
      }
    };

    console.log(`[INDEX] Creating vector search index: "${indexName}"...`);
    
    // Atlas-specific command to create search index
    // Note: This may fail if not running on an Atlas M10+ cluster or if the index exists.
    await collection.createSearchIndex(indexDefinition);
    
    console.log('[INDEX] Request submitted successfully.');
    console.log('[INDEX] Note: It may take a few minutes for Atlas to fully build the index.');

  } catch (error) {
    console.error('[INDEX:FATAL] Failed to create vector index:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

createVectorIndex();
