# One-shot "db-init" image: applies migrations, then seeds once. Build context = repo root.
FROM node:24-slim
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @clinic/db...
COPY packages/shared packages/shared
COPY packages/db packages/db
RUN pnpm --filter @clinic/shared build && pnpm --filter @clinic/db build
WORKDIR /repo/packages/db
CMD ["node", "dist/cli/init.js"]
