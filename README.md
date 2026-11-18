# Clinic network: online booking

Three clinics (Київ `Europe/Kyiv`, Львів `Europe/Kyiv`, Варшава `Europe/Warsaw`). Patients book, move and cancel visits and join a waiting list; registrars run schedules and the day board; doctors see their day; the manager sees a report. Built to the test assignment in `test-assignment-12.md`; the plan and its decisions are in [plan.md](plan.md).

## Run it

```
cp .env.example .env && docker compose up --build
```

Nothing else: `db-init` applies migrations and seeds once (3 clinics, 40 doctors, 15 services, 20 000 patients, 150 000 appointments over 180 days; ~30 s), then `api`, `worker`, `web` and `nginx` start.

| What | Where |
| --- | --- |
| Website (nginx → web, `/graphql` → api, one origin) | http://localhost:8080 (`HTTP_PORT`) |
| Mail stub: SMTP on 1025, every email shown on a page | http://localhost:8025 (Postgres, Redis, SMTP and this UI are published on 127.0.0.1 only) |
| More workers | `docker compose up --scale worker=3` |

**Demo logins** (password = `SEED_PASSWORD` in `.env`, default `Demo-Passw0rd!`): `manager@demo.local`, `registrar.kyiv@demo.local`, `registrar.lviv@demo.local`, `registrar.warsaw@demo.local`, `doctor01@demo.local` … `doctor40@demo.local`, `patient00001@demo.local` … `patient18000@demo.local` (the other 2 000 patients are phone-only), or sign up on the site.

## Tests

```
pnpm install && pnpm build
pnpm lint && pnpm typecheck && pnpm test          # shared, db, domain, worker, api, web unit; Docker needed (Testcontainers)
pnpm --filter @clinic/web lint:fsd                # Feature-Sliced Design rules
pnpm --filter @clinic/api schema && git diff --exit-code apps/api/schema.gql
pnpm --filter @clinic/web codegen && git diff --exit-code apps/web/src/shared/api/generated
```

End-to-end (Playwright, real stack, 8-second holds): see the Web section. Full-stack abuse check through nginx: `infra/attack/run.sh` (below). CI runs all of it on every commit (`.github/workflows/ci.yml`).

## Architecture in one page

`apps/api` (NestJS GraphQL) · `apps/worker` (NestJS + BullMQ) · `apps/web` (Next.js, FSD) · `packages/shared` (Zod schemas, rules, time/format helpers) · `packages/db` (schema, migrations, seed) · `packages/domain` (booking engine, plain functions). Classes exist only where NestJS needs them (enforced by ESLint); everything else is functions.

**Postgres vs Redis.** Postgres is the source of truth for everything, including the ledger of future work (`scheduled_tasks`). Redis only holds a schedule (BullMQ delayed jobs), rate-limit counters and live-event pub/sub. After `FLUSHALL` the workers copy pending ledger tasks back into Redis (on `NOTIFY`, at boot, every 15 s) and run each exactly once through `FOR UPDATE SKIP LOCKED`. Details and tests: *Worker*.

**Time zones and daylight saving.** Instants are `timestamptz`; wall-clock schedules (`time` columns) are interpreted in the clinic's IANA zone. The grid converts local → instant per working interval and skips wall times that do not exist (spring-forward gap) or offers the first occurrence of a repeated one (fall-back). The 24 h reminder is "the same clinic wall-clock time on the previous day", the 2 h reminder is `start − 2 h`; neither shifts by an hour across the change. The UI shows the API's clinic `localTime`, never a browser conversion (a Playwright test runs a New York browser against Warsaw). Tests: DST tables for both zones and both nights, a property test of the grid against a naive oracle on DST days, reminder instants.

**Indexes and constraints that carry the invariants** (all in `packages/db/drizzle/0001_constraints.sql`, see *Database*): three exclusion constraints on `appointments` (doctor, UZI room, patient), a partial unique index (patient, doctor, local day), the status-transition trigger, append-only history, covering index `appointments_local_date_cov_idx` for the report, `(doctor_id, starts_at)` for the grid, partial indexes for hold expiry, waitlist queue and due tasks. `EXPLAIN` assertions are in `packages/db/test/perf.test.ts`.

**Performance on the full seed:** availability for a service across a city for 14 days ≈ 10–30 ms through nginx; the 90-day report ≈ 35 ms (budget 300 ms).

## Edge (nginx) and abuse checks

`infra/nginx/nginx.conf`: one origin; `/graphql` carries HTTP and WebSocket; per-IP `limit_req` (30 r/s, burst 60) and `limit_conn`; header/body timeouts; 100 KB body limit; security headers; `X-Forwarded-For` is *replaced* with the socket address, and the API trusts it only from the docker network (`TRUST_PROXY_CIDRS`; compose uses Docker's automatic subnet, which lies in `172.16.0.0/12`, so a second copy of the project can run beside this one). nginx resolves `api` and `web` through Docker's DNS (`resolver 127.0.0.11 valid=5s`, upstreams as variables), so after a container is recreated with a new IP the site recovers within seconds without restarting nginx. The API adds Redis-backed limits (see *API*), including WebSocket connects and subscribes.

`infra/attack/run.sh` (`ATTACK_SECONDS=20 infra/attack/run.sh`; needs the stack up) runs two containers with fixed addresses on their own network `attack` (`docker-compose.attack.yml`, subnet `172.31.77.0/24`, change the prefix with `ATTACK_NET_PREFIX`; nginx is attached to it too) against the real edge: the attacker (172.31.77.50) floods HTTP and WebSocket for 20 s, spoofs `X-Forwarded-For`/`X-Real-IP` as the victim and brute-forces a login; the legit client (172.31.77.51) keeps using the site. Result on this stack: attacker 129 377 requests, 99.8 % answered 429, 198 login attempts throttled, 190 of 200 WebSocket opens refused; legit client 192/192 requests OK, p95 7 ms, WebSocket stayed connected.

## Known limitations (found by audit, not fixed)

- **Trusted proxy range:** the default `TRUST_PROXY_CIDRS=172.16.0.0/12,10.0.0.0/8` assumes Docker's automatic network lies in those ranges (true by default). If Docker hands out a `192.168.x` network, nginx is no longer trusted and all visitors share one rate-limit key: add that range to `TRUST_PROXY_CIDRS`.
- **Offer email vs. sick-day mark:** a waiting-list offer email already locked by a worker can still be sent for a slot a sick-day mark cancels at that very moment; the offer then disappears. The booking itself is always safe.
- **Narrow lock-order gaps** (replaced hold handed to the waiting list, a visit moved between peek and lock): the transaction retry absorbs the resulting deadlocks; a stale offer on a sick day in that window is possible but accept would be refused.
- **Board badges:** "Late" and "With the doctor" are computed when the board loads or an event arrives, not by a timer; "With the doctor" means checked in and start time passed.
- **Cost budget** is charged per signed-in account (an office behind one IP is not shared) and per address for visitors.
- **The "any doctor" waiting-list browser test** is `test.fixme`: the e2e seed has too few doctors for that service; the behaviour (the patient must choose a doctor) is implemented.

## Decisions on ambiguous points

1. **24 h reminder** = same clinic wall-clock time on the previous day; **2 h** = absolute. A reminder already in the past at booking time is skipped.
2. **Reschedule** is one atomic UPDATE of the existing visit; a move less than 24 h before the visit counts as a late cancel (history records the old and new time).
3. **Prep time** (5 min) blocks the doctor and the UZI room after each visit; it may run into the break or past closing, the visit may not. A 15-minute visit therefore occupies a 30-minute block on the 15-minute grid.
4. **Grid** starts are aligned to :00 :15 :30 :45 of the clinic wall clock.
5. **Sick day** cancels without penalty, emails each patient once, and puts them first in that doctor's waiting list (priority, next 14 days). Marking twice changes nothing. Other schedule changes that would orphan booked visits are refused (`SCHEDULE_CONFLICT`).
6. **Penalties:** the 2nd no-show or late cancel within 90 days closes *online* booking for 30 days from that moment; registrars can still book.
7. **One live online hold per patient** (a new online hold releases the previous and hands it to the waiting list): nobody can freeze the grid. A registrar's phone hold neither replaces nor is replaced by it. Holds count toward the 3-visit limit.
8. **Report:** utilization = minutes of live visits ÷ working minutes (templates + exceptions − breaks); no-show / late-cancel share is over visits that were ever booked; revenue is completed visits per service and currency (UAH and PLN are never summed).
9. **Waiting-list offers** are held rows, handed over inside the transaction that frees the time; unsuitable people are skipped, not removed; a patient already holding an offer is not given another at once; offers bypass the online block (the clinic initiated them).
10. **Seed capacity:** the rules cap live visits at ~65 000 in 180 days for 40 doctors, so ~85 000 of the 150 000 appointments are cancelled rows. Upcoming days are filled less (45 %) so the demo grid has free time.
11. **No email verification** at sign-up (no external services allowed); all mail goes to the stub.
12. **Clock:** the engine uses an injected clock (tests move time); servers are assumed NTP-synced.
14. **Sign-up never claims an existing patient record.** A registrar may have created a patient from a phone call; the phone number alone proves nothing (no email/SMS verification here), so attaching that record to a new account would let anyone who knows a number read that person's visit history. Sign-up always creates a new patient, and a phone number already on file is refused with `BAD_USER_INPUT` / `fieldErrors.phone` (no details of the other record are revealed). Linking an old record to an account is a manual clinic task.
15. **A patient blocked from online booking can still reschedule an existing visit**: the block closes *new* online bookings (hold / confirm); moving a visit already owned is not a new booking and the clinic would rather have it moved than no-shown.
16. **A late cancel done by the registrar on the patient's behalf still penalises the patient** (the rule is about the visit being dropped under 24 h, not about who clicked); the registrar can see the flag in the history.
13. **Extra compose services:** `db-init` (one-shot) and `nginx` next to the required six.

## Acceptance checklist → where it is verified

| # | Check | Verified by |
| --- | --- | --- |
| 1 | `cp .env.example .env && docker compose up --build` | clean-checkout run (CI job `stack`) |
| 2 | typecheck, lint, codegen unchanged, tests, CI | `ci.yml` |
| 3 | hold → confirm; second browser loses the time without reload | `e2e/booking.spec.ts` (1), `api/test/subscriptions.test.ts` |
| 4 | 20 patients, one time | `domain/booking.test.ts`, `api/concurrency.test.ts`, `db/invariants.test.ts` (real connections) |
| 5 | two doctors, one UZI room | same files, "ultrasound" cases |
| 6 | hold not confirmed; late confirm refused | `domain/booking.test.ts` (±1 ms), `worker/flows.test.ts`, `e2e/booking.spec.ts` (2) |
| 7 | reschedule into a just-taken time | `domain/reschedule-cancel.test.ts`, `api/concurrency.test.ts` |
| 8 | cancel with waiting list of 3; first silent | `domain/waitlist.test.ts`, `worker/flows.test.ts`, `e2e/aa-waitlist.spec.ts` |
| 9 | reminders after reschedule / cancel | `domain/reschedule-cancel.test.ts`, `worker/delivery.test.ts` |
| 10 | `FLUSHALL`, worker restart | `worker/delivery.test.ts`, `worker/flows.test.ts` |
| 11 | three workers | `worker/delivery.test.ts`, `e2e/zz-scale.spec.ts` (compose `--scale worker=3`) |
| 12 | New York → Warsaw; DST night | `shared/time.test.ts`, `domain/grid.test.ts`, `e2e/booking.spec.ts` (5) |
| 13 | sick day with 12 visits, twice | `domain/sick-attendance.test.ts`, `worker/flows.test.ts`, `e2e/zz-scale.spec.ts` |
| 14 | 2 no-shows → online closed, registrar books | `domain/reschedule-cancel.test.ts` |
| 15 | foreign visit / clinic / patient, subscriptions | `api/authorization.test.ts`, `api/subscriptions.test.ts` |
| 16 | depth 15; list of 50 with relations | `api/security.test.ts` |
| 17 | search 14 days and 90-day report < 300 ms; URL state | `db/perf.test.ts`, `domain/perf.test.ts`, `e2e/booking.spec.ts` (4), `e2e/staff.spec.ts` (manager) |
| 18 | `uk`, `en`, `pl` | `web/messages.test.ts`, `shared/format.test.ts`, `e2e/booking.spec.ts` (6) |
| 19 | README | this file |

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
- Root fields that do real work have an explicit price (`ROOT_FIELD_COST` in `infra/security.ts`: `availability` 50, `report` 100, ...), so aliases of them multiply; `limit` is clamped to [1, 1000] when priced. Each request's cost is also charged to a per-IP budget (`RATE_COST_PER_MIN`, default 20000). Free text rejects control characters / lone surrogates, calendar dates are limited to 2000-2100. Sign-out closes the user's open WebSockets (on every replica, through the event bus; a 15 s sweep also catches expiry).
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

## Web (`apps/web`): Next.js 15, React 19, Feature-Sliced Design

```
app/[locale]/…        thin Next routes (re-export pages)       pages/  (empty: keeps Next off src/pages)
src/app               providers (urql client)
src/pages             search, sign-in/up, cabinet, registrar-board/phone/schedule, doctor-schedule, manager-report
src/widgets           slot-grid, appointment-list, day-board, schedule-editor, report-panel, app-header
src/features          auth, hold-slot, manage-appointment, waitlist, attendance, schedule-admin, phone-booking, locale-switch
src/entities          session, catalog, slot, appointment
src/shared            api (urql + generated types), config (env.ts), i18n, lib, ui
```

`pnpm --filter @clinic/web lint:fsd` (Steiger) checks the layer and public-API rules in CI. Types of every response come only from `apps/api/schema.gql` through GraphQL Codegen (`pnpm --filter @clinic/web codegen`; CI regenerates and fails on a diff). No GraphQL response type is written by hand.

- **Live grid:** the slot grid subscribes to `availabilityChanged` and refetches the affected view, so a second browser sees a time disappear (and come back) without reloading. The cabinet, the registrar board, the doctor's week and waiting-list offers update the same way.
- **Hold:** choosing a time calls `holdSlot` at once; the countdown shows the server's deadline; confirm sends one idempotency key per hold (a double click books once); when the time is up the panel says so and the time is free for everyone. A hold replaced from a second tab is noticed (live `myAppointmentChanged` events, a re-check when the tab regains focus, and `INVALID_TRANSITION` / `NOT_FOUND` on Confirm) and the panel says "this reservation is no longer active, pick a time again" instead of counting down.
- **Waiting list is per doctor:** the card always has a doctor select (preselected from the search, otherwise empty); the join button stays disabled until a doctor is chosen, nothing is guessed.
- **Keyboard:** when the reservation panel appears, focus moves to it (it sits before the grid in DOM order, so Confirm is one Tab away) and returns to the chosen time when it closes; the registrar's phone form behaves the same. Time buttons are labelled with date, time and doctor. Cabinet notifications are translated messages with the time in the page language.
- **State in the URL:** city / service / doctor, the registrar's date, the doctor's week and the report period (`?from=&to=&clinic=`) live in the query string and use history `push`, so reload and Back restore them.
- **Clinic time, not browser time:** the API sends the clinic wall-clock `localTime`; the UI shows exactly that, plus the clinic's time zone. Money uses the clinic currency (`1 234,50 ₴`, `1 234,50 zł`), dates the clinic zone, plurals the ICU rules of the language (`3 записи / 5 записів`, `3 wizyty / 5 wizyt`). A unit test checks that `uk`, `en`, `pl` have the same keys and placeholders.
- **Forms:** React Hook Form + the same Zod schemas as the API; errors appear next to the field with `aria-invalid`, `aria-describedby` and `role=alert`, in the user's language, from the client or from the server (`extensions.fieldErrors`). Everything is a native control: the patient path and the registrar's phone-booking path are tested with the keyboard only.
- Queries are sent with POST only (the API refuses simple GET requests as CSRF protection).

**End-to-end tests** (`apps/web/e2e`, Playwright against the real stack; hold and offer lifetimes are 8 s there): hold → confirm → another browser loses the time without reload; unconfirmed hold returns the time and the late confirm is refused; cancel with a waiting list → the first gets the offer live and accepts, the second gets nothing; the same with the first one silent; keyboard-only patient and registrar (Tab/Enter/Space/arrows from the page top; Confirm within 3 Tab stops), focus return, a stale second tab, the waiting list that must be given a doctor, translated notifications; URL state with reload and Back; a New York browser sees Warsaw clinic times; locales; field errors; registrar phone booking, sick day and report. Run locally:

```
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build api worker
pnpm --filter @clinic/web build && E2E_START_WEB=1 pnpm --filter @clinic/web e2e
```
(start from a fresh database, `down -v`: the tests assume an empty waiting-list queue.)
