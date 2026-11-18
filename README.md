# Clinic network — online booking

Work in progress; see [plan.md](plan.md). The full README (run, grid algorithm, statuses, Postgres vs Redis, DST, indexes, decisions) is finished in the last block.

```
cp .env.example .env
pnpm install && pnpm build && pnpm test
```

## Database (`packages/db`)

Postgres 16 + Drizzle. `drizzle/0000_tables.sql` is generated from `src/schema.ts`; `drizzle/0001_constraints.sql` is hand-written (Drizzle cannot express these).

**What the database enforces by itself** (tests: `packages/db/test/invariants.test.ts`, `state.test.ts`)

| Rule | Mechanism |
| --- | --- |
| Doctor never double-booked | `EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, occupied_until) WITH &&) WHERE status <> 'cancelled'`; `occupied_until = ends_at + prep_minutes` |
| One UZI room per clinic | same, on `room_id`. `room_id` is **set by a trigger** from service + clinic, so a caller can neither skip nor fake it |
| Patient not in two places | same, on `(patient_id, [starts_at, ends_at))` |
| One visit per doctor per patient per clinic-local day | partial unique index; `local_date` is computed by trigger in the clinic time zone |
| Legal status transitions, frozen finished visits | `BEFORE UPDATE` trigger (`AP001`) |
| History cannot be skipped or edited | `AFTER` trigger writes `appointment_events`; `BEFORE UPDATE/DELETE` on events raises (`AP003`). Actor, clock, reason come from `set_config('app.*', …, true)` (helper: `withActorTx`) |
| Expired holds | a constraint cannot read `now()`, so booking transactions call `release_expired_holds(now, doctor, room, patient, from, to)` first. Waitlist offers are *not* released by it; the worker hands them on |

**Finding from testing:** when several transactions fight over the same room through different doctors, losers get either `23P01` (exclusion violation) or `40P01` (deadlock abort) depending on timing. Exactly one still wins; the booking engine treats both as "slot taken".

**Seed** (`pnpm --filter @clinic/db db:init`, or the `db-init` compose service): 3 clinics, 40 doctors, 15 services (3 need the UZI room), 20 000 patients, 150 000 appointments (150 days back, 30 ahead), schedule exceptions, waitlist offers, penalties. Deterministic (`SEED_RNG`), idempotent (`seed_runs` marker + advisory lock), one transaction, ~30 s, `VACUUM ANALYZE` afterwards. It loads through the real constraints; only the history trigger is switched off while loading because the seed writes realistic historical events itself.

Capacity note: with a 15-minute grid and 5 minutes of preparation, a 15-minute visit occupies a 30-minute block, so 40 doctors can hold ~65 000 live visits in 180 days. The remaining ~85 000 of the 150 000 rows are **cancelled** (cancelled rows do not occupy time). That is a consequence of the numbers in the assignment, not a bug.

Demo logins (password = `SEED_PASSWORD` from `.env`): `manager@demo.local`, `registrar.kyiv@demo.local`, `registrar.lviv@demo.local`, `registrar.warsaw@demo.local`, `doctor01@demo.local` … `doctor40@demo.local`, `patient00001@demo.local` … `patient18000@demo.local`.

**Query budgets on the full seed** (`test/perf.test.ts`): availability inputs for a city/service/14 days p95 ≈ 7 ms; 90-day report p95 ≈ 30 ms (budget 300 ms).

```
pnpm test            # shared + db; db tests start Postgres in Testcontainers (Docker needed)
TEST_PG_ADMIN_URL=postgres://… pnpm --filter @clinic/db test   # or reuse a running Postgres
```

## Booking engine (`packages/domain`)

Plain functions over Postgres, no classes. Every business operation is one transaction with an injected clock (`ctx.now`), so tests move time instead of sleeping. Errors are values (`Result<T, AppError>` with a code from `@clinic/shared`); only real bugs throw.

### How the free-time grid is computed

`computeSlots` (pure, `src/grid.ts`) for each doctor, clinic-local date and working interval:

1. **Working interval** = the doctor's weekly template for this clinic, minus the break. An exception replaces it: vacation / sick / day off → nothing; extra day / custom hours → their own hours (only if for this clinic).
2. **Step 15 minutes**, aligned to the clinic wall clock (`:00 :15 :30 :45`).
3. A start is valid when `[start, start + duration)` lies inside one interval: a visit never crosses the break or the end of the day.
4. **Preparation:** after every visit the doctor (and the UZI room) is busy for 5 more minutes. A candidate must keep `[start, start + duration + 5 min)` clear of every busy interval, and busy intervals already include their own preparation. So a 30-minute visit at 10:00 blocks 09:30 … 10:30 and the next free start is 10:45. Preparation may run into the break or past closing time; the visit itself may not.
5. Ultrasound services also check the clinic's room.
6. `start >= now + 2 h` and `start <= now + 60 days`.
7. Wall times that do not exist (spring-forward gap) are skipped; repeated ones (fall-back) are offered once, at the first occurrence. A property test compares the optimized implementation with a naive oracle on random inputs including both DST nights, and another test checks that the grid and the real exclusion constraints agree on every start.

### Status table

| From → To | Who | Rule |
| --- | --- | --- |
| – → `held` | patient, registrar (system for waitlist offers) | 10 min (offer: 15 min); one live hold per patient |
| `held` → `booked` | patient, registrar | only while `hold_expires_at > now`; idempotent by key |
| `held` → `cancelled` | patient, system (expiry, replacement, offer declined/expired, sick day) | no penalty |
| `booked` → `booked` (reschedule) | patient, registrar | one atomic UPDATE; < 24 h counts as late cancel |
| `booked` → `cancelled` | patient, registrar, registrar for sick day | < 24 h by patient/registrar = late cancel |
| `booked` → `checked_in` | registrar | from 30 min before start |
| `booked` → `no_show` | registrar, visit's doctor | after start; penalty |
| `checked_in` → `completed` | visit's doctor | a `booked` visit is checked in by the doctor first |

Anything else is refused by the code (`INVALID_TRANSITION`) and, independently, by the database trigger.

### Decisions worth knowing

- **Lock order** everywhere: doctor-day advisory lock → patient row → appointment rows. This makes "mark sick" and "book that day" mutually exclusive and keeps one patient's parallel flows from deadlocking. (Both were found by tests: a parallel hold + confirm by one patient deadlocked before the order was fixed; without the doctor-day lock a booking could survive a sick-day mark. Removing the lock makes the 40-round race test fail.)
- **Waitlist hand-over happens in the same transaction as the release** (cancel, reschedule away, expired hold, expired/declined offer). The offer is a `held` row of kind `waitlist_offer`; the exclusion constraint allows one live row per time, so a time can never be offered to two people or be visible as free in between. Offers are not released lazily: only `expireOffer` (the worker) passes them on. Candidates that are momentarily locked by their own booking are skipped (never waited for), so a release cannot deadlock with a booking.
- **Reschedule** moves the same row; the old time is freed only by the same UPDATE that takes the new one. A failed move leaves version, reminders and history untouched.
- **Reminders** are tasks in the Postgres ledger, keyed by appointment *version*. A reschedule cancels the old version's tasks and creates new ones; a cancel cancels them all; a reminder already in the past at booking time is skipped. 24 h = same clinic wall-clock time on the previous day; 2 h = start − 2 h.
- **Penalties:** one row per (appointment, kind), so retries cannot double count. The second one within 90 days closes online booking for 30 days from that moment; the registrar can still book.
- **Registrar changing a schedule** never silently orphans visits: vacation / day off / shorter hours that would strand a booked visit are refused with `SCHEDULE_CONFLICT`. The sick day is the operation that cancels and notifies.
- **Not found instead of forbidden** for other people's visits, so ids cannot be probed.

### Tests

`packages/domain/test`: pure-grid tests incl. oracle + DST nights; races with real connections (20 patients on one time, UZI via different doctors, parallel hold+confirm, simultaneous confirm retries, simultaneous cancels / expiry / sick days); expiry at ±1 ms; idempotency; waitlist queue behaviour; permissions matrix; schedule editing; grid ⟺ database agreement; full-seed performance (availability for every clinic × service, p95 well under 300 ms).

## Worker (`apps/worker`): Redis, BullMQ, email

**Postgres holds the truth, Redis holds only a schedule.**

| In Postgres (durable) | In Redis (disposable) |
| --- | --- |
| every appointment, hold, offer, waitlist entry | BullMQ delayed jobs: "run task X at time T" |
| `scheduled_tasks`: the ledger of everything that must happen later (`hold.expire`, `offer.expire`, `reminder.24h/2h`, `email.*`), with `status`, `attempts`, `dedupe_key` | pub/sub channel `clinic:events` (live updates; best effort) |
| in-app notifications, history, penalties | nothing a user could miss |

Flow: a business transaction inserts its tasks into the ledger (the insert fires `NOTIFY`). The **dispatcher** (inside every worker) copies pending tasks that are due within the horizon into BullMQ, using the task id as BullMQ job id, on `NOTIFY`, at boot and every `WORKER_RECONCILE_MS` (15 s). Adding an existing job is a no-op, so repeating is free. The **consumer** takes a job, and `processTask` runs:

```
BEGIN; SELECT … FROM scheduled_tasks WHERE id=$1 AND status='pending' FOR UPDATE SKIP LOCKED;
  none → another worker has it / already done / cancelled: acknowledge and stop
  not due yet → rollback (the next reconcile re-adds it)
  run handler (re-checks the business state) → mark done → COMMIT
```

Consequences (all covered by tests with a real Redis, Postgres and Mailpit):

- **`FLUSHALL` or an empty Redis restart:** the next reconcile re-adds every pending task with its remaining delay. Holds are released, reminders and offers arrive on time, nothing is duplicated because the row is marked done once. The worker also starts while Redis is down and reconnects by itself.
- **Several workers / duplicate jobs:** the row lock admits one executor. Tests run 3 workers plus hand-injected duplicate jobs under other job ids: each email arrives exactly once.
- **Worker `kill -9` mid-task:** the connection dies, the lock is released, the task is still `pending`, another worker finishes it (BullMQ stalled-job detection or the next reconcile).
- **Reminders** are keyed by appointment version in the ledger and re-checked at send time (`status = booked` and `version` unchanged), so after a reschedule only the new time is reminded and after a cancel nothing is.
- **Retries:** a failing task (SMTP down, poison data) is retried with exponential backoff (`WORKER_RETRY_BASE_MS · 2^attempts`, max 5 min) up to `WORKER_MAX_ATTEMPTS`, then left `pending` with `last_error` for an operator; it never blocks other tasks.
- **At-most-once email caveat:** the SMTP call happens while the task row is locked and the row is marked done right after. A crash between the mail server's "250 OK" and the commit would send that one mail again. The `Message-ID` is deterministic (`<task-id@clinic.local>`) so a real mail server could dedupe it.
- **Emails** are rendered in the patient's locale (uk / en / pl) with times in the **clinic's** time zone and money in the clinic's currency; hostile names are escaped in HTML and cannot enter headers; addresses with anything but a plain `user@host` are not mailed.
- **Shutdown** is bounded: active jobs get 10 s, then connections are forced closed, so SIGTERM never hangs on a dead Redis.

Bugs this block's tests found and fixed: the worker hanging at boot while Redis is down; a self-deadlock when the worker expires an offer (the domain tried to cancel the very task row the worker had locked); shutdown hanging after a Redis restart.

Run more copies: `docker compose up --scale worker=3`.

## API (`apps/api`): NestJS GraphQL

Code-first schema (committed as [apps/api/schema.gql](apps/api/schema.gql), regenerated by `pnpm --filter @clinic/api schema`; CI fails if it is stale). REST only has `/health` (liveness) and `/ready` (Postgres + Redis within 2 s).

**Who may do what** (tests: `authorization.test.ts`, `subscriptions.test.ts`)

- **Default deny:** a global guard refuses every query, mutation and subscription that does not declare `@Public()` or `@Roles(...)`; a test fails the build if one is undeclared.
- Roles come from the database on every request (session → user), never from a cookie claim. Sessions are opaque 256-bit tokens in an `HttpOnly; SameSite=Lax` cookie; only their SHA-256 is stored. Login uses argon2id, answers identically for unknown accounts (same work, same message) and rotates the session id.
- Policy lives in [policy.ts](apps/api/src/policy.ts) and is applied in resolvers, field resolvers and subscription events. List queries are also scoped in SQL, so foreign rows are never loaded. Someone else's visit is "not found", not "forbidden", so ids cannot be probed. Patient: own visits. Registrar: own clinic only (patient names searchable only inside the clinic; an exact phone finds anyone, needed to avoid duplicate phone patients). Doctor: own visits, patient name but not contacts. Manager: report only.
- `Patient.visits` (a deliberate cycle in the schema) is scoped by the same rule in one batched query.
- **Subscriptions:** identity is fixed when the WebSocket opens; private subscriptions are authorized when subscribing (a Warsaw registrar asking for the Kyiv board is refused) and every event is filtered per subscriber and re-read through the policy before it is sent. The public `availabilityChanged` carries only ids and a date. Events travel worker/api → Redis → every api replica; losing Redis loses live updates only.

**GraphQL cannot take the server down** (`security.test.ts`)

- Depth ≤ 10, field count ≤ 400 (also bounds alias bombs), estimated cost ≤ 2000 (a list multiplies what is selected inside it by its `limit`, default 10), checked before execution for HTTP and for subscriptions. Fragment cycles are validation errors. Batching is off, bodies are limited to 100 KB, slow clients are cut off (header/request timeouts).
- Introspection, the landing page and "did you mean" hints are off in production; Apollo CSRF prevention is on (simple cross-site requests are refused) and CORS only allows `CORS_ORIGINS`.
- **DataLoader:** a list of 54 visits with doctor, clinic, service and patient costs the same number of SQL queries (≤ 8) as a list of 3.
- Errors: every failure has an `extensions.code` from `@clinic/shared`; input errors carry `fieldErrors` for the form. Unknown errors are logged and masked. A fuzz test sends arbitrary JSON as variables and asserts nothing becomes `INTERNAL_SERVER_ERROR`.

**Abuse and rate limits** (`attack.test.ts` runs against the real listening server, acting as different client addresses 127.0.0.2/3/4…)

| Limit | Default | Key |
| --- | --- | --- |
| all requests (not `/health`) | 300 / min | client IP |
| sign-in | 5 / min and 20 / min | IP + email, IP |
| sign-up | 5 / hour | IP |
| hold a slot | 10 / min | account |
| WebSocket connections / subscriptions | 10 per IP / 10 per connection | IP / connection |

- The client IP is the socket address. `X-Forwarded-For` / `X-Real-IP` are believed **only** when the TCP peer is inside `TRUST_PROXY_CIDRS` (the nginx container), and then the rightmost address that is not itself a trusted proxy is used. Tests: spoofed headers from an untrusted peer neither dodge the attacker's own limit nor burn the victim's; rotating forwarded values does not help; a neighbour keeps being served (p95 < 400 ms) while one address floods 600 requests and 250 half-open connections.
- Sign-in limits are per IP+email, so an attacker hammering a victim's email from their own address cannot lock the victim out.
- Counters live in Redis (shared by replicas) with an in-memory fallback: with Redis stopped the API keeps serving, limits still bite, `/ready` reports degraded.
- One live hold per patient: ten holds in a minute leave one frozen time slot, not ten.

Bugs the tests found in this block: the ready-made complexity library silently loaded a second copy of `graphql` and never enforced anything (replaced by a small estimator, and a cost error now fails closed); WebSocket rejections needed the error class graphql-ws itself accepts; an HTTP client library ignoring the source address made every "client" the same address.
