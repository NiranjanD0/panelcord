# syntax=docker/dockerfile:1

# ---------------------------------------------------------
# Base Stage
# ---------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate
WORKDIR /app

# ---------------------------------------------------------
# Dependencies Stage
# ---------------------------------------------------------
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma7.config.ts ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------
# Builder Stage
# ---------------------------------------------------------
FROM dependencies AS builder
COPY . .
RUN pnpm prisma:generate
RUN pnpm build

# ---------------------------------------------------------
# Production Runner Stage
# ---------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Install OpenSSL for Prisma engine compatibility if needed
RUN apk add --no-cache openssl dumb-init

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY prisma7.config.ts ./

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.16.1 --activate
RUN pnpm install --prod --frozen-lockfile && pnpm prisma:generate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/database/generated ./src/database/generated

RUN chown -R node:node /app

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
