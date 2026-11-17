# Build context = repo root.
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @clinic/worker...
COPY packages packages
COPY apps/worker apps/worker
RUN pnpm --filter @clinic/shared build && pnpm --filter @clinic/db build && pnpm --filter @clinic/domain build && pnpm --filter @clinic/worker build

FROM node:24-slim
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
USER node
WORKDIR /repo/apps/worker
CMD ["node", "dist/main.js"]
