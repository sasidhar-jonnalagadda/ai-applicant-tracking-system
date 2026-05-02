# --- Stage 1: Prune ---
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo
COPY . .
RUN turbo prune --scope=backend-api --docker

# --- Stage 2: Builder ---
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# First install dependencies (as they change less often)
COPY .gitignore .gitignore
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/package-lock.json ./package-lock.json
RUN npm install

# Build the project
COPY --from=pruner /app/out/full/ .
COPY turbo.json turbo.json
RUN npx turbo build --filter=backend-api...

# --- Stage 3: Runner ---
FROM node:20-alpine AS runner
WORKDIR /app

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 expressjs
USER expressjs

COPY --from=builder /app/packages/backend-api/package.json .
COPY --from=builder /app/packages/backend-api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json

# Environment variables should be injected at runtime, 
# but we expose the port for documentation.
EXPOSE 3001

CMD ["node", "dist/index.js"]
