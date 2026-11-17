# Plan — online booking for a 3-clinic network

Source of truth: `test-assignment-12.md`. Where this plan and the assignment disagree, the assignment wins.

Working rules (from you):
- Frontend: **Feature-Sliced Design**.
- **Classes only where NestJS needs them** (modules, resolvers, services, guards, GraphQL code-first types, BullMQ processors). Everything else is functional: plain functions, tagged-union `Result`, no classes. Enforced by an ESLint `no-restricted-syntax: ClassDeclaration` rule in every package except `apps/api` and `apps/worker`.
- **One commit per block.** Each block is finished end to end (code, migrations/Dockerfile, seed if relevant, tests, CI job, README section) and CI is green on that commit. 7 commits total. I commit locally; you push.
- `.env.example` holds every variable, with comments. Each runtime (`api`, `worker`, `web`, `db` scripts) has its own `env.ts` that parses `process.env` with Zod. Non-secret values get defaults. Secrets have no defaults and fail fast at boot.
- Tests are adversarial. They hit a real Postgres, a real Redis and a real running server, and they try to break things: races, replays, crashes, `FLUSHALL`, IDOR, subscription leaks, query bombs, rate-limit flooding from one IP while another IP must still be served.

---

## 1. Stack and repo layout

| Part | Choice |
| --- | --- |
| Monorepo | pnpm workspaces (`pnpm -r`, no Turborepo: nothing to cache yet), TypeScript 5.9 strict, Node 24 |
| DB | PostgreSQL 16, Drizzle ORM + drizzle-kit; `btree_gist`; exclusion constraints in hand-written SQL migrations (Drizzle's DSL can't express them) |
| Queues | Redis 7 + BullMQ, used **only for delivery and timing**. Postgres holds the task ledger, so Redis can be lost safely. |
| API | NestJS + **Apollo** (`@nestjs/apollo`), code-first, `graphql-ws` subscriptions, DataLoader, Redis pub/sub for subscriptions across replicas |
| Worker | NestJS standalone app + `@nestjs/bullmq`. Processors are thin classes that call functional handlers. |
| Web | Next.js 15 App Router, React 19, urql (`@urql/next`), GraphQL Codegen (client preset, typed documents), React Hook Form + Zod resolver, Tailwind, next-intl (`uk`, `en`, `pl`), URL state via search params |
| Shared | `packages/shared`: Zod input schemas, rule constants, error codes, `Result`, time zone/DST helpers, money/date/plural formatters (used by both web and emails) |
| Mail stub | Mailpit: SMTP on 1025, web UI on 8025, plus an HTTP API that tests use to count emails |
| Edge | nginx: one origin for web, `/graphql` (HTTP and WS); edge rate limit and connection limit by IP |
| Tests | Vitest (unit, property-based with `fast-check`, integration on Testcontainers Postgres and Redis), Playwright e2e, attack suite against the real compose stack |

```
apps/
  api/        NestJS GraphQL (classes allowed)
  worker/     NestJS BullMQ worker (classes allowed)
  web/        Next.js, FSD
packages/
  shared/     zod schemas, constants, errors, time, format   (functional)
  db/         drizzle schema, SQL migrations, seed, client, query fns, Dockerfile (migrate+seed image)
  domain/     booking engine: slot grid, hold/confirm/reschedule/cancel, waitlist,
              sick day, penalties, status machine, task ledger writes (functional)
  config/     tsconfig / eslint / vitest presets
infra/
  nginx/      nginx.conf, Dockerfile
docker-compose.yml, docker-compose.test.yml (short TTLs for e2e), .env.example
.github/workflows/ci.yml
```

`api` does **not** import BullMQ. It writes tasks to Postgres in the same transaction as the business change. The worker turns those tasks into BullMQ jobs (§5). This is the core of the "Redis loss loses nothing" design.

---

## 2. Domain model (Postgres)

All instants are `timestamptz` in UTC. Wall-clock schedule data is stored as `time` plus a clinic IANA zone. Money is `bigint` minor units plus a currency code (`UAH` / `PLN`). IDs are random UUIDs (`gen_random_uuid()`; PG16 has no v7): not enumerable.

| Table | Key columns / notes |
| --- | --- |
| `clinics` | `city`, `time_zone`, `currency` |
| `rooms` | `clinic_id`, `kind` (`ultrasound`). Unique `(clinic_id, kind)` gives one UZI room per clinic. |
| `services` | `duration_min` CHECK 15..90 and `% 15 = 0`, `price_minor` per clinic via `clinic_services(clinic_id, service_id, price_minor)` (price is in the clinic currency), `needs_ultrasound` |
| `doctors` | `specialty`; `doctor_services` M:N |
| `schedule_templates` | `doctor_id, clinic_id, weekday, start_local, end_local, break_start_local, break_end_local`; unique `(doctor_id, weekday)`, so a doctor is in one clinic per day |
| `schedule_exceptions` | `doctor_id, local_date, kind` (`vacation`, `sick`, `day_off`, `extra_day`, `custom_hours`), optional clinic and hours; unique `(doctor_id, local_date)` |
| `users` | `email`, `password_hash` (argon2id), `role` (`patient`, `registrar`, `doctor`, `manager`), `clinic_id` (registrar), `doctor_id` (doctor) |
| `sessions` | `token_hash` (sha256), `user_id`, `expires_at`, `revoked_at`. Opaque token in an httpOnly cookie. |
| `patients` | `user_id` nullable (phone-only patients created by a registrar), `phone` unique, `email`, `locale`, `online_booking_blocked_until` |
| `appointments` | `patient_id, doctor_id, clinic_id, service_id, room_id?`, `starts_at, ends_at`, `prep_minutes` (5), `during tstzrange`, `occupied tstzrange` (= `[start, end+prep)`, set by trigger), `local_date`, `status`, `kind` (`regular` / `waitlist_offer`), `hold_expires_at`, `price_minor`, `currency` (snapshot), `version` |
| `appointment_events` | history: `actor_user_id`, `actor_role`, `type`, from/to status, old/new time, `late` flag, reason, `at`. Written by an **AFTER trigger** that reads `app.actor_*` from `set_config(..., true)`, so no code path can skip history. |
| `idempotency_keys` | `(actor_user_id, key)` PK, `request_hash`, `appointment_id` |
| `waitlist_entries` | `patient_id, doctor_id, service_id, from_date, to_date, priority` (sick-day victims = 1), `created_at`, `status` |
| `waitlist_offers` | `entry_id`, `appointment_id` (the held row), `expires_at`, `status` (`pending`/`accepted`/`declined`/`expired`) |
| `scheduled_tasks` | the task ledger: `kind`, `run_at`, `payload`, `dedupe_key` UNIQUE, `status` (`pending`/`done`/`cancelled`), `attempts`, `locked_until`, `done_at` |
| `notifications` | in-app inbox |
| `penalty_events` | `patient_id`, `kind` (`no_show` / `late_cancel`), `at`, `appointment_id` UNIQUE per kind |

### Constraints that carry the invariants

| Invariant | DB mechanism |
| --- | --- |
| 1. Doctor not double-booked | `EXCLUDE USING gist (doctor_id WITH =, occupied WITH &&) WHERE status <> 'cancelled'` |
| 2. UZI room not double-booked | `EXCLUDE USING gist (room_id WITH =, occupied WITH &&) WHERE room_id IS NOT NULL AND status <> 'cancelled'` |
| 3a. Patient not in two places | `EXCLUDE USING gist (patient_id WITH =, during WITH &&) WHERE status <> 'cancelled'` |
| 3b. Max 3 future | `SELECT … FOR UPDATE` on the `patients` row serializes one patient's booking transactions; the count happens under that lock |
| Once per doctor per day | partial UNIQUE `(patient_id, doctor_id, local_date) WHERE status <> 'cancelled'` |
| Valid status transitions | BEFORE UPDATE trigger rejects transitions that are not in the table (§4). This is defense in depth on top of the domain code. |
| Sanity | CHECKs: `ends_at > starts_at`, 15-minute alignment, `price_minor >= 0`, currency enum |

**Expired holds vs. exclusion constraints:** a constraint can't depend on `now()`. So every insert or update transaction first runs a scoped sweep. It cancels `held` + `regular` rows with `hold_expires_at <= now` that overlap the same doctor, room or patient, and then inserts. Expiry is therefore correct even if no worker ever runs. The worker's `hold.expire` job only adds the realtime broadcast and cleanup. **Waitlist offers are not swept lazily** (§6). They stay blocking until the worker hands them on, so the slot is never visible while offers circulate.

### Indexes

`appointments(doctor_id, starts_at)`, `(clinic_id, starts_at)`, `(patient_id, starts_at)`, `(starts_at) INCLUDE (status, service_id, doctor_id, price_minor, currency)` for the report, the GiST indexes behind the exclusions, `scheduled_tasks(status, run_at)`, `waitlist_entries(doctor_id, status, priority DESC, created_at)`, `sessions(token_hash)`. The README will hold an `EXPLAIN ANALYZE` excerpt for the two 300 ms queries.

### Seed (deterministic, seeded PRNG)

3 clinics, 1 UZI room each, 15 services, 40 doctors (some in two clinics on different weekdays), 20 000 patients, 150 000 appointments over the last 150 days plus the next 30.

- Rows are generated by per-doctor-day packing that respects templates, breaks, prep, UZI room, patient overlap, the once-per-day rule and max 3 future. So the seed passes the real constraints and is not loaded with constraints disabled.
- Status mix: past appointments are completed, no-show or cancelled (some late). Future ones are booked or cancelled.
- Exceptions (vacations, sick days, extra days), some waitlist entries, penalty-blocked patients.
- Loaded with `COPY` (seconds, not minutes). Idempotent: a `seed_runs` marker means it runs only once.
- Logins: `manager@demo.local`, `registrar.kyiv@…`, `registrar.lviv@…`, `registrar.warsaw@…`, `doctor01..40@…`, `patient00001..@…`. Password comes from `SEED_PASSWORD` in `.env.example`.

---

## 3. Free-time grid (slot computation)

A pure function in `packages/domain`, fed by 2 SQL queries (working intervals plus busy intervals for the doctors and dates involved):

1. Pick doctors in the city who provide the service (and the chosen doctor, if any).
2. For each clinic-local date in `[today, today+14)`, build the working intervals: the weekday template, replaced or removed by that date's exception, minus the break. Local `date + time` is converted to an instant through the clinic zone (Temporal polyfill, `disambiguation: 'reject'` for times that don't exist).
3. Candidate starts sit every **15 min aligned to local wall-clock** (:00/:15/:30/:45). A candidate `[s, s+duration)` must lie fully inside one working interval. It therefore can't cross the break or the end of the day.
4. Rejected if `[s, s+duration+5min)` overlaps any non-cancelled appointment's `occupied` (expired regular holds are ignored), or, for UZI services, the clinic room's `occupied`.
5. Rejected if `s < now+2h` or `s > now+60d`.
6. Output: `startsAt` (UTC), `localStart` (clinic wall-clock), clinic `timeZone`. The browser formats in the **clinic** zone, never its own.

Decisions: the 5-minute prep may overlap the break or run past the end of the day (the room is prepared then). The appointment itself may not. Example consequence: a 30-minute visit at 10:00 occupies until 10:35, so the next slot is 10:45. Tested with `fast-check` properties: no slot overlaps a busy range, a break or a boundary; every slot is aligned; DST dates never produce shifted or duplicated slots.

Performance target: < 300 ms for 14 days across all doctors in a city on the full seed. There is a perf test with p95 over 20 runs.

---

## 4. Status machine

| From → To | Who | Notes |
| --- | --- | --- |
| — → `held` | patient (online), registrar, system (waitlist offer) | `hold_expires_at = now + 10 min` (offer: 15 min) |
| `held` → `booked` | patient / registrar (confirm), patient (accept offer) | only if `hold_expires_at > now`. At 10:01 the request is rejected with `HOLD_EXPIRED`. |
| `held` → `cancelled` | system (expiry, offer expired/declined), patient (abandons) | not a penalty |
| `booked` → `booked` (reschedule) | patient, registrar | one UPDATE of the time range, atomic; `version++` |
| `booked` → `cancelled` | patient, registrar, system (sick day) | `< 24h` before start, by patient or registrar on the patient's behalf, counts as **late cancel**. Sick day does not. |
| `booked` → `checked_in` | registrar | from 30 min before start |
| `booked` → `no_show` | registrar, doctor | only after start time; records a penalty |
| `checked_in` → `completed` | doctor | |
| `checked_in` → `no_show` | — | not allowed |

Late reschedule (< 24 h) also records a `late_cancel` penalty. When a no-show or late cancel lands and the patient has ≥ 2 penalty events in 90 days, the same transaction sets `online_booking_blocked_until = now + 30d`. Registrar bookings ignore this block.

Board states on the registrar board (derived, not stored): *expected* (booked, before start), *late* (booked, start passed), *arrived* (checked_in, before start), *with doctor* (checked_in, inside the slot), *done*, *no-show*.

---

## 5. Postgres ↔ Redis (tasks survive `FLUSHALL`)

**Postgres holds the truth. Redis holds the schedule.**

- Business transactions insert rows into `scheduled_tasks` with a `dedupe_key`, e.g. `reminder:24h:{apptId}:v{version}`, `email:sick_cancel:{apptId}`, `hold.expire:{apptId}`, `offer.expire:{offerId}`. They also `pg_notify('tasks')`.
- **Dispatcher** (in the worker): on `LISTEN` notify, and on a **reconcile loop** at boot and every 15 s, it enqueues every `pending` task with `run_at < now + horizon` into BullMQ with `jobId = task.id` and `delay = run_at - now`. Duplicate enqueues are no-ops because the `jobId` is the same. If BullMQ lost the job, the next reconcile puts it back.
- **Processor:** inside a PG transaction it runs `SELECT … FOR UPDATE SKIP LOCKED WHERE id = $1 AND status = 'pending'`. Zero rows means a duplicate or a cancelled task, so it acks and exits. Otherwise it re-checks the business state, performs the action, marks `done` and commits. With 3 workers, or a re-enqueue after `FLUSHALL`, the row lock and status give **exactly one execution**.
- Email: SMTP is sent while the task row is locked and the row is committed `done` right after. The only theoretical duplicate is a crash between the SMTP 250 reply and the commit. The README documents this and gives a deterministic `Message-ID` for downstream dedup.
- Reminders: confirm inserts two tasks. 24h = **same wall-clock time on the previous clinic-local day**, so it doesn't drift by an hour across DST. 2h = start − 2 h (absolute). Reschedule cancels the old version's tasks and inserts new ones in the same transaction. Cancel cancels them. The processor also re-checks `status = 'booked' AND version = payload.version` as a second guard. A reminder whose run time is already past at booking time is skipped (e.g. the 24h reminder for a booking 3 h ahead).
- Rate-limiter counters and the subscription pub/sub live in Redis and may be lost. Losing counters just resets limits (an in-memory fallback limiter keeps working while Redis is down). Losing pub/sub drops live events, and clients refetch on reconnect.

---

## 6. Waitlist

- An entry covers `(patient, doctor, service, from_date..to_date)`. The queue order is `priority DESC, created_at ASC`. Max 5 active entries per patient (anti-spam).
- When a slot frees (cancel or reschedule away), **the same transaction** finds the first matching entry. Matching means: the service fits the freed start with its own duration, the working hours and the room are free, and the patient passes every booking rule (window, overlap, 3-future, once-per-day; the online block doesn't apply because the offer came from the clinic). That transaction inserts a `held` row with `kind = waitlist_offer`, 15-minute expiry, plus the offer row, an in-app notification and an email task. So the slot never shows as free in between.
- `offer.expire` / decline: in one transaction it cancels this held row and creates the next offer on the same slot. Only when no matching entry is left does the slot become free. One slot = one live held row, which the exclusion constraint guarantees, so it can't be offered to two people.
- Accept = confirm of that held row → `booked`, entry `fulfilled`.
- Sick day: affected patients get an automatic `priority = 1` entry for the same doctor and service, covering the next 14 days.

## 7. Sick day

`markDoctorSick(doctorId, date)` by a registrar of the clinic where the doctor works that date: an upsert of the `sick` exception. If it already exists, it's a no-op. Then every `held`/`booked` appointment of that doctor on that local date is cancelled (reason `doctor_sick`, no penalty), together with their reminder tasks, and one email task per appointment is inserted (`dedupe_key email:sick_cancel:{apptId}`). It runs in one transaction under an advisory lock on `(doctor, date)`. Marking twice therefore produces 12 emails, not 24.

---

## 8. API (NestJS, GraphQL code-first)

- **Auth:** GraphQL mutations `signUp`, `signIn`, `signOut` (REST stays only `/health` and `/ready`). argon2id, an opaque session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` via env), session rotation on login, a generic "invalid credentials" message, and constant-time behavior for unknown emails.
- **Authorization** sits in every resolver and every field resolver that exposes related data, through a functional `policy` module (`canReadAppointment(actor, appt)`, …) called by guards and loaders. Patient: own only. Doctor: own appointments only, and only the patient data of those. Registrar: own clinic only. Manager: reports and read-only access. List queries are scoped **in SQL** (`WHERE patient_id = actor.patientId`), not filtered afterwards.
- **Subscriptions** (`graphql-ws`): the cookie is authenticated in `onConnect`. Each event is filtered per subscriber with the same policy functions. `availabilityChanged` carries only `{doctorId, clinicId, range}`, no patient data. `myAppointments`, `myOffers`, `clinicBoard(clinicId)` and `doctorDay` are authorized at subscribe time and per event.
- **DataLoader** per request for doctor, clinic, service and patient (patient loader applies policy). A test asserts that a list of 50 appointments with all relations runs a fixed number of SQL queries (counted via the pg query hook, expected ≤ 5).
- **Hardening:** depth limit 10, query complexity limit, alias/field-count limit, no batched array requests, 100 KB body limit, introspection and landing page off when `NODE_ENV=production`, Apollo CSRF prevention.
- **Errors:** Zod (from `packages/shared`) validates every input in a pipe → `BAD_USER_INPUT` with `extensions.fieldErrors`. Domain `Result` errors map to codes: `SLOT_TAKEN`, `ROOM_TAKEN`, `PATIENT_BUSY`, `FUTURE_LIMIT_REACHED`, `DOCTOR_DAILY_LIMIT`, `OUTSIDE_BOOKING_WINDOW`, `HOLD_EXPIRED`, `OFFER_EXPIRED`, `ONLINE_BOOKING_BLOCKED`, `INVALID_TRANSITION`, `IDEMPOTENCY_KEY_REUSED`, `RATE_LIMITED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`. PG `23P01`/`23505` map to the matching business codes. Anything unknown is logged and masked, and a fuzz test asserts that garbage input never yields `INTERNAL_SERVER_ERROR`.
- **Rate limiting** (`rate-limiter-flexible`, Redis plus in-memory fallback), keyed by **client IP** (taken from nginx's `X-Real-IP` only when the request comes from the trusted proxy CIDR; otherwise the socket address, so spoofed `X-Forwarded-For` is ignored) and by user:
  - global per IP: 300 req/min
  - `signIn`: 5/min per IP+email, 20/min per IP
  - `signUp`: 5/h per IP
  - `holdSlot`: 10/min per user
  - WS connections: 10 per IP, subscriptions per connection capped
- **Anti-hoarding:** a patient has at most **1 active hold**. A new hold releases the previous one, so one account can't freeze the grid. Holds count toward the 3-future limit.
- **Idempotency:** `confirmBooking(holdId, idempotencyKey)`. Replaying the same key returns the same appointment. The same key with a different payload returns `IDEMPOTENCY_KEY_REUSED`.
- `schema.gql` is emitted and committed. CI regenerates it and runs web codegen, then `git diff --exit-code`.

---

## 9. Web (Next.js, FSD)

Follows the official FSD + Next.js App Router layout: Next's `app/` at the root holds thin route files only, FSD lives in `src/`, and an empty root `pages/` stops Next from claiming `src/pages`. `steiger` (FSD linter) runs in CI.

```
app/[locale]/(patient)/…, registrar/…, doctor/…, manager/report/…  → re-export from src/pages
src/
  app/       providers (urql + graphql-ws, next-intl), global styles
  pages/     search, booking, cabinet, waitlist, registrar-schedule, registrar-board,
             registrar-phone-booking, doctor-day, doctor-week, manager-report, sign-in, sign-up
  widgets/   slot-grid, appointment-list, day-board, schedule-editor, report-panel
  features/  hold-slot, confirm-booking, reschedule, cancel, join-waitlist, respond-offer,
             mark-attendance, mark-sick, edit-template, edit-exception, auth, locale-switch
  entities/  appointment, slot, doctor, clinic, service, patient, offer, notification
  shared/    api (urql client, generated gql), lib (url-state, format re-exports), ui (accessible form kit), config (env.ts)
```

- All filters live in the URL (city, service, doctor, week; report `from`/`to`/`clinic`), so reload and Back work.
- Live grid: `availabilityChanged` subscription → refetch only the affected doctor/day. The hold countdown is shown.
- Forms: RHF + the shared Zod schemas. Field errors come both client-side and from server `extensions.fieldErrors`, bound to fields, with `aria-invalid` and `aria-describedby`. Both the patient and registrar paths work by keyboard only (tested).
- i18n: `uk`, `en`, `pl` via ICU plurals ("3 записи / 5 записей", "3 wizyty / 5 wizyt"). Money is formatted in the **clinic currency**. Known trap: `pl-PL` doesn't group 4-digit numbers by default (`1234,50 zł`), and the assignment wants `1 234,50 zł`. So the formatter uses `useGrouping: 'always'` + `currencyDisplay: 'narrowSymbol'`, with a unit test.

---

## 10. Commits (blocks)

Each block includes its own tests, CI job, Dockerfile where it has a runtime, and README section. CI is green at every commit.

### 1 — `foundation`: monorepo, tooling, CI, shared
- pnpm + turbo, tsconfig/eslint presets (no `any`, `@ts-ignore` only with a description, no classes outside Nest apps), Vitest, Prettier.
- `.env.example` (complete, commented), compose with `postgres`, `redis`, `mailpit`.
- `packages/shared`: Zod schemas, rule constants (all durations env-overridable for tests), error codes, `Result`, time zone helpers (local↔instant, DST), formatters (money, dates, plurals).
- Tests: DST tables for Kyiv/Warsaw spring and fall nights, nonexistent/ambiguous local times, the 24h-reminder rule, money formatting per locale/currency, plural forms, schema fuzzing.
- CI: install, lint, typecheck, test.

### 2 — `db`: Postgres layer end to end
- Drizzle schema, SQL migrations (btree_gist, exclusions, triggers for `occupied`, history and transitions), query functions, seed (COPY, deterministic), `env.ts`, Dockerfile for the `db-init` one-shot service (migrate + seed), wired into compose.
- Tests (Testcontainers PG 16):
  - 20 concurrent connections insert the same doctor slot → 1 succeeds
  - UZI room clash across two doctors → 1 succeeds
  - patient overlap
  - once-per-day
  - illegal status transitions blocked by trigger
  - history rows written for every change, including raw SQL updates
  - the seed satisfies all constraints and expected counts
  - `EXPLAIN` uses the indexes
  - report and availability SQL meet the < 300 ms budget on the full seed

### 3 — `domain`: booking engine
- Pure slot grid; hold, confirm (idempotent), reschedule (atomic), cancel, late-cancel and penalties, waitlist offers and handoff, sick day, registrar booking path, reminder scheduling, task-ledger writes, injected `Clock`.
- Tests:
  - fast-check properties for the grid
  - 20 parallel holds → 1
  - 10 parallel holds by one patient across doctors → ≤ 3 future
  - confirm at TTL+1 ms → `HOLD_EXPIRED`
  - idempotent replay
  - reschedule into a slot taken concurrently → old one untouched
  - waitlist of 3 with the first timing out → offer moves to the second, and the slot never appears in the grid in between
  - sick day ×2 → no duplicate tasks
  - 2 penalties → blocked 30 days, registrar still books
  - New York client booking Warsaw
  - DST-night appointment reminders

### 4 — `worker`: Redis + BullMQ + email
- NestJS worker: dispatcher (LISTEN + reconcile), processors (hold.expire, offer.expire, reminders, emails, in-app notifications, pub/sub broadcast), SMTP to Mailpit, localized email templates, `env.ts`, Dockerfile, compose service (scalable).
- Tests (real PG + Redis + Mailpit):
  - `FLUSHALL` mid-flight → everything still fires on time, once
  - Redis killed and restarted empty
  - worker `SIGKILL` during processing
  - 3 workers in parallel + manually injected duplicate jobs → each email exactly once
  - rescheduled/cancelled reminders never sent
  - worker boots while Redis is down and recovers

### 5 — `api`: GraphQL
- Everything in §8, `env.ts`, Dockerfile, `/health` and `/ready` (PG + Redis checks), committed `schema.gql`.
- Attack suite against a **real listening server**:
  - authorization matrix (role × operation × foreign resource)
  - IDOR on every ID argument
  - subscription leakage (patient B listening for patient A, registrar of Lviv on Kyiv's board)
  - depth-15 query, alias bomb, fragment cycles, oversized body, batch arrays
  - introspection off in prod mode
  - CSRF without the preflight header
  - login brute force
  - one IP flooding while a second source IP (real loopback `127.0.0.x` source binding) stays served within latency budget
  - spoofed `X-Forwarded-For` doesn't bypass the limits
  - WS connection flood
  - input fuzzing never returns `INTERNAL_SERVER_ERROR`
  - DataLoader SQL-count test
  - 20 real HTTP clients holding one slot concurrently

### 6 — `web`: Next.js
- All the screens in §9, codegen, i18n, `env.ts`, Dockerfile (standalone output), Steiger.
- Tests:
  - Vitest for libs and features
  - Playwright: (a) hold → confirm → second browser context loses the slot without reload; (b) unconfirmed hold returns to the grid after TTL (short TTL via `docker-compose.test.yml`); (c) cancel → first waitlisted patient gets the offer and accepts
  - keyboard-only patient and registrar paths
  - locale rendering checks

### 7 — `edge`: nginx, full stack, README
- nginx (single origin, WS upgrade, `limit_req` / `limit_conn` by IP, body size, security headers), final compose (`cp .env.example .env && docker compose up --build` is the only step), CI e2e job running compose + Playwright.
- Full-stack attack run: attacker containers on fixed IPs flood the edge while a legit client container must stay served; scale `worker=3` and check Mailpit counts.
- Final README: run/tests, grid algorithm, status table, PG vs Redis and recovery, time zones/DST, indexes and exclusions, decisions, logins, acceptance checklist mapping each of the 19 checks to its test.

---

## 11. Invariant → test map

| # | Invariant | Where it's tested |
| --- | --- | --- |
| 1 | doctor double booking under 20 concurrent | db (raw SQL), domain (engine), api (HTTP) |
| 2 | UZI room | db, domain |
| 3 | patient overlap + 3-future under concurrency | db, domain |
| 4 | 10-minute hold, 10:01 confirm rejected | domain (fake clock), e2e (short TTL) |
| 5 | atomic reschedule | domain |
| 6 | idempotent confirm | domain, api |
| 7 | fair waitlist, slot hidden during offers | domain, worker, e2e |
| 8 | reminders exactly once, follow reschedule, none after cancel | domain, worker |
| 9 | `FLUSHALL` / empty Redis restart | worker, edge |
| 10 | multiple workers | worker, edge (`--scale worker=3`) |
| 11 | clinic time, DST | shared, domain, web |
| 12 | sick day, no duplicates | domain, worker |
| 13 | permissions incl. subscriptions | api |
| 14 | depth/complexity, DataLoader, introspection | api |
| 15 | coded errors, never internal | api (fuzz) |

---

## 12. Decisions taken on ambiguous points

1. **24h reminder** = same clinic wall-clock time on the previous day; **2h** = absolute. Neither shifts across DST.
2. **Reschedule** is one atomic UPDATE of the existing row (no separate hold), and history records the old and new times. A late reschedule counts as a late cancel.
3. **Prep 5 min** applies to the doctor and the UZI room. It may overlap the break or the end of the day; the visit itself may not.
4. **Grid alignment:** local :00/:15/:30/:45.
5. **Sick day** cancels without a penalty and auto-creates priority waitlist entries (same doctor and service, next 14 days).
6. **Penalty block:** 30 days from the 2nd event within 90 days. Only online self-booking is blocked; registrars can still book.
7. **One active hold per patient** (anti-hoarding). Holds count toward the 3-future limit.
8. **Utilization** = minutes of non-cancelled visits ÷ working minutes (template + exceptions − breaks).
   - **No-show / late-cancel share** is out of non-hold appointments in the period.
   - **Revenue** = completed visits, grouped by service **and currency**. UAH and PLN are never summed.
9. **Waitlist "first suitable"** = earliest in queue order whose service fits the freed start and who passes all booking rules. Others are skipped, not removed.
10. **No email verification** on sign-up (external services are forbidden). Mail goes only to Mailpit.
11. **App clock vs DB clock:** the domain uses an injected clock (needed for time-shifted tests). Servers are assumed NTP-synced. The README documents this.
12. **Extra services:** `db-init` (one-shot migrate+seed) and `nginx` are added to compose alongside the required six. Both are additive.

---

After you approve this, I'll `git init` and start with block 1.
