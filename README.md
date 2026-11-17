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
