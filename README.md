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
