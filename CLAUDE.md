# CLAUDE.md

Clinic-network online booking (test assignment). The assignment text is `test-assignment-12.md`; where anything conflicts, the assignment wins. Plan and decisions: `plan.md`, `README.md`.

## Rules for working here

- **Classes only where NestJS needs them** (`apps/api`, `apps/worker`); everything else is plain functions (ESLint enforces it). No `any`, no `@ts-ignore` without a reason.
- **Frontend is Feature-Sliced Design** (`shared → entities → features → widgets → pages → app`); check with `pnpm --filter @clinic/web lint:fsd`. Each shared segment is imported through its `index.ts`.
- **Tests must try to break things**: real Postgres/Redis/server, races, replays, hostile input. A test that can pass without asserting is a bug.
- GraphQL response types come only from `apps/api/schema.gql` via codegen; never write them by hand.
- Every app reads its environment through its own `env.ts` (Zod): secrets have no defaults, non-secrets do. All variables are listed in `.env.example`.
- Commit complete blocks only; the user pushes.

## Project structure

```
.
├── apps/
│   ├── api/                 NestJS GraphQL (code-first), graphql-ws subscriptions
│   │   ├── src/
│   │   │   ├── app.ts       createApi(): bootstrap, global per-IP limiter, server timeouts
│   │   │   ├── module.ts    GraphQL config, ws hooks (limits), health controller, resolver list
│   │   │   ├── env.ts       Zod env
│   │   │   ├── auth/        passwords (argon2id), sessions (hashed tokens), roles guard (default deny)
│   │   │   ├── graphql/     types.ts, inputs.ts, resolvers.ts, mapping.ts
│   │   │   ├── infra/       ip.ts (trusted-proxy client IP), rate-limit.ts, security.ts (depth/cost),
│   │   │   │                errors.ts, filter.ts, event-bus.ts (Redis pub/sub), tokens.ts
│   │   │   ├── loaders.ts   DataLoaders;  policy.ts  authorization rules
│   │   │   └── emit-schema.ts   writes schema.gql
│   │   ├── schema.gql       committed generated schema
│   │   └── test/            auth, authorization, subscriptions, security, attack, concurrency, env
│   ├── worker/              NestJS + BullMQ: dispatcher (ledger → Redis), consumer, handlers, emails
│   │   ├── src/             worker.ts, handlers.ts, mail.ts, view.ts, env.ts, main.ts
│   │   └── test/            delivery, flows, kill (SIGKILL/SIGTERM), unit
│   └── web/                 Next.js 15 App Router, React 19 (FSD in src/)
│       ├── app/[locale]/    thin routes re-exporting src/pages;  pages/ intentionally empty
│       ├── messages/        uk.json en.json pl.json
│       ├── e2e/             Playwright specs (aa-waitlist, booking, staff, zz-scale: file order matters, the sick-day spec creates priority queues)
│       └── src/
│           ├── app/         providers (urql client)
│           ├── pages/       search, sign-in, sign-up, cabinet, registrar-*, doctor-schedule, manager-report
│           ├── widgets/     slot-grid, appointment-list, day-board, schedule-editor, report-panel, app-header
│           ├── features/    auth, hold-slot, manage-appointment, waitlist, attendance,
│           │                schedule-admin, phone-booking, locale-switch
│           ├── entities/    session, catalog, slot, appointment
│           └── shared/      api (urql + generated/), config, i18n, lib, ui
├── packages/
│   ├── shared/              Zod schemas, rule constants, error codes, Result, time/DST + format helpers
│   ├── db/                  Drizzle schema, SQL migrations (drizzle/), queries, seed/, Dockerfile (db-init)
│   └── domain/              booking engine: grid.ts, booking.ts, waitlist.ts, sick.ts, attendance.ts,
│                            schedule.ts, tasks.ts, penalties.ts, context.ts (transact, lock order)
├── infra/
│   ├── nginx/               nginx.conf (production edge), nginx.e2e.conf (limits lifted for browser tests)
│   └── attack/              run.mjs + run.sh: flood vs. legit client through the real edge
├── docker-compose.yml       postgres, redis, mailpit, db-init, api, worker, web, nginx
├── docker-compose.e2e.yml   8 s holds/offers, relaxed limits, small seed, publishes api port
├── docker-compose.attack.yml  attacker/legit containers with fixed IPs (profile "attack")
├── .github/workflows/ci.yml verify, schema, image builds, stack (e2e + attack)
├── .env.example             every variable of every service (copy to .env)
├── eslint.config.js  tsconfig.base.json  pnpm-workspace.yaml
├── plan.md  README.md  test-assignment-12.md
```

Lock order in the booking engine (everywhere): doctor-day advisory lock → patient row → appointment rows.

## Commands

```bash
# setup
cp .env.example .env
pnpm install && pnpm build              # shared/db/domain must be built before others run

# run everything (migrate + seed happen automatically)
docker compose up --build               # site http://localhost:8080, mail http://localhost:8025
docker compose up --scale worker=3

# quality gates
pnpm lint && pnpm typecheck && pnpm test   # tests need Docker (Testcontainers)
pnpm --filter @clinic/web lint:fsd
pnpm --filter @clinic/api schema && git diff --exit-code apps/api/schema.gql
pnpm --filter @clinic/web codegen && git diff --exit-code apps/web/src/shared/api/generated

# one package / one file
pnpm --filter @clinic/db test
pnpm --filter @clinic/api exec vitest run test/attack.test.ts
pnpm --filter @clinic/worker exec vitest run test/flows.test.ts -t "sick day"
TEST_PG_ADMIN_URL=postgres://… pnpm --filter @clinic/db test   # reuse a running Postgres

# db
pnpm --filter @clinic/db db:generate     # drizzle-kit: new migration from schema.ts
pnpm --filter @clinic/db db:init         # migrate + seed against DATABASE_URL

# end-to-end (start from a FRESH database: leftover waiting-list entries change offers)
docker compose -f docker-compose.yml -f docker-compose.e2e.yml down -v
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --scale worker=3
E2E_BASE_URL=http://localhost:8080 E2E_API_URL=http://localhost:8080/graphql E2E_MAIL_URL=http://localhost:8025 \
  pnpm --filter @clinic/web e2e

# abuse check through nginx (production edge settings)
docker compose up -d --no-deps api nginx
ATTACK_SECONDS=20 infra/attack/run.sh

# redis loss drill
docker compose exec redis redis-cli FLUSHALL && docker compose restart worker
```

## Gotchas

- `NEXT_PUBLIC_*` must be read as `process.env.NAME` (dot access) or Next does not inline it.
- NestJS GraphQL needs emitted decorator metadata: tests use SWC (`unplugin-swc`), the API runs from the `tsc` build, not `tsx`.
- Tests that need distinct client addresses use `node:http` with `localAddress` (127.0.0.x); `fetch` ignores it.
- Date-dependent tests use "N-th workday from today"; keep N small (booking window is 2 h – 60 days).
- Other projects on the dev machine may use 3100, 4000 or 8080: compose publishes only nginx (`HTTP_PORT`, default 8080); change it in `.env` if taken.
