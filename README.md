# AI-Powered Applicant Tracking System (ATS) SaaS

A production-grade, enterprise-ready Applicant Tracking System built with a modern monorepo architecture. This system leverages Google's **Gemini 3 Flash** for high-speed resume parsing and **Gemini Embedding 2** for semantic candidate matching against job descriptions.

## 🏗️ Architecture & Monorepo Structure

The project is managed as a high-performance **Turborepo** with clear separation of concerns:

- **`apps/web`**: Next.js (App Router) frontend. A premium recruiter dashboard with glassmorphic UI and real-time ingestion tracking.
- **`packages/backend-api`**: Express.js REST API. Handles job management, resume uploads to S3, and semantic search queries.
- **`packages/worker`**: BullMQ-based background worker. Performs heavy-lifting tasks like PDF parsing, AI structured extraction, and vector embedding generation.
- **`packages/shared`**: Shared TypeScript types, Zod schemas, Mongoose models, and a centralized `pino` logger.
- **`packages/typescript-config`**: Shared TS configurations.
- **`packages/eslint-config`**: Shared linting rules.

## 🛠️ Tech Stack

- **Frontend**: Next.js 16 (Turbopack), Tailwind CSS 4, Lucide React.
- **Backend**: Node.js, Express, MongoDB (Mongoose), Redis (BullMQ).
- **AI/LLM**: Google Generative AI (`gemini-3-flash`, `gemini-embedding-2`).
- **Infrastructure**: AWS S3 (Resume Storage), Docker (Containerization).
- **Observability**: Pino (Structured JSON Logging).
- **Monorepo Tooling**: Turborepo, NPM Workspaces, TypeScript.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- MongoDB Atlas Cluster (for Vector Search)
- AWS S3 Bucket
- Google Gemini API Key

### 1. Environment Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Key variables required:
- `GEMINI_API_KEY`: Your Google AI Studio key.
- `MONGODB_URI`: Connection string (Atlas required for Vector Search).
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`: For S3 resume storage.
- `REDIS_HOST`: Usually `127.0.0.1` (or `redis` if inside Docker).

### 2. Infrastructure Setup (Docker)

Spin up the local MongoDB and Redis instances:

```bash
docker compose up -d
```

### 3. Initialize Vector Search Index

For semantic search to work, you must create a vector index on your MongoDB Atlas collection. Run the automated script:

```bash
npm run db:index
```

*Note: This creates a 768-dimension index using cosine similarity on the `embedding` field.*

### 4. Local Development

Install dependencies and start all services in parallel:

```bash
npm install
npm run dev
```

The system will be available at:
- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **API**: [http://localhost:3001](http://localhost:3001)

---

## 🛡️ Production & Security

This codebase has been hardened for production deployment:

- **Security Headers**: Managed via `helmet` and strict CORS policies.
- **Structured Logging**: All services output machine-readable JSON logs for ingestion by cloud logging agents (CloudWatch, ELK, etc.).
- **Graceful Shutdown**: All services handle `SIGTERM`/`SIGINT` to drain queues and close database connections.
- **Containerization**: Optimized multi-stage Dockerfiles utilizing `node:20-alpine` and non-root execution (`USER node`) for maximum security.

## 🧪 CI/CD

The project includes a GitHub Actions workflow that:
- Runs `lint` and `typecheck` across the entire monorepo.
- Verifies Docker builds for the Web, API, and Worker packages.
- Validates the build pipeline on every push and pull request.

---

## 📜 License

Private / Enterprise License. See LICENSE for details.