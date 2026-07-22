# agentgitops Dockerfile — 多阶段构建
# Stage 1: Build all packages
FROM node:24-slim AS builder
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.15.0

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/git/package.json packages/git/
COPY packages/local-hub/package.json packages/local-hub/
COPY apps/cli/package.json apps/cli/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/ packages/
COPY apps/ apps/

# Build all
RUN pnpm --filter @agentgitops/core build
RUN pnpm --filter @agentgitops/git build
RUN pnpm --filter @agentgitops/local-hub build
RUN pnpm --filter @agentgitops/server build
RUN pnpm --filter agentgitops build
RUN pnpm --filter @agentgitops/web build

# Stage 2: Runtime
FROM node:24-slim AS runtime
WORKDIR /app

# Install runtime tools. agentgitops delegates worktree/diff/merge operations to system Git.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@9.15.0

# Copy built packages
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/apps/cli/ apps/cli/
COPY --from=builder /app/apps/server/ apps/server/
COPY --from=builder /app/apps/web/dist/ apps/web/dist/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Expose default port
EXPOSE 4789

# Environment
ENV AGENTGITOPS_HOST=0.0.0.0
ENV AGENTGITOPS_PORT=4789

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4789/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Entry point
ENTRYPOINT ["node", "apps/cli/dist/index.js"]
CMD ["web", "--host", "0.0.0.0", "--port", "4789"]
