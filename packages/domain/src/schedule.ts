import { sql } from 'drizzle-orm';
import { PG, asPgError, schema, type Tx } from '@clinic/db';
import {
  appError,
  err,
  isoWeekday,
  ok,
  type AppError,
  type Result,
  type ScheduleExceptionInput,
  type ScheduleTemplateInput,
} from '@clinic/shared';
import { fail, transact, type Actor, type Ctx } from './context.js';
import { markDoctorSick } from './sick.js';

const conflict = (n: number, what: string): Result<never, AppError> =>
  err(
    appError(
      'SCHEDULE_CONFLICT',
      `${n} upcoming visit(s) would fall outside ${what}. Move or cancel them first.`,
    ),
  );

/**
 * Live visits (held / booked / checked-in, still ahead) of a doctor in a clinic that would NOT
 * fit the given working hours. `weekday` limits the check to a weekly template; `localDate` to one date.
 */
const visitsOutside = async (
  tx: Tx,
  now: Date,
  p: {
    doctorId: string;
    clinicId: string | null;
    weekday?: number;
    localDate?: string;
    hours: { start: string; end: string; bs: string | null; be: string | null } | null;
  },
): Promise<number> => {
  const h = p.hours;
  const fits = h
    ? sql`((a.starts_at AT TIME ZONE c.time_zone)::time >= ${h.start}::time
           AND (a.ends_at AT TIME ZONE c.time_zone)::time <= ${h.end}::time
           AND a.clinic_id = ${p.clinicId}::uuid
           AND NOT (${h.bs}::time IS NOT NULL
                    AND (a.starts_at AT TIME ZONE c.time_zone)::time < ${h.be}::time
                    AND (a.ends_at AT TIME ZONE c.time_zone)::time > ${h.bs}::time))`
    : sql`false`;
  const where = p.localDate
    ? sql`a.local_date = ${p.localDate}::date`
    : sql`a.clinic_id = ${p.clinicId}::uuid AND extract(isodow FROM a.local_date)::int = ${p.weekday ?? 0}
          AND NOT EXISTS (SELECT 1 FROM schedule_exceptions e WHERE e.doctor_id = a.doctor_id AND e.local_date = a.local_date)`;
  const r = await tx.execute(sql`
    SELECT count(*)::int AS n FROM appointments a JOIN clinics c ON c.id = a.clinic_id
    WHERE a.doctor_id = ${p.doctorId}::uuid AND a.status IN ('held', 'booked', 'checked_in')
      AND a.starts_at > ${now.toISOString()}::timestamptz AND ${where} AND NOT ${fits}`);
  return Number((r.rows[0] as { n: number }).n);
};

/** Registrar sets one weekday of a doctor's weekly template in their own clinic. */
export const setScheduleTemplate = (
  ctx: Ctx,
  actor: Actor,
  input: ScheduleTemplateInput,
): Promise<Result<true, AppError>> =>
  transact(ctx, actor, async ({ tx, now }) => {
    if (actor.role !== 'registrar' || actor.clinicId !== input.clinicId)
      return fail('FORBIDDEN', 'You can only edit the schedule of your own clinic');
    const n = await visitsOutside(tx, now, {
      doctorId: input.doctorId,
      clinicId: input.clinicId,
      weekday: input.weekday,
      hours: {
        start: input.startLocal,
        end: input.endLocal,
        bs: input.breakStartLocal,
        be: input.breakEndLocal,
      },
    });
    if (n > 0) return conflict(n, 'the new hours');
    try {
      await tx.transaction(async (sp) => {
        await sp
          .insert(schema.scheduleTemplates)
          .values({
            doctorId: input.doctorId,
            clinicId: input.clinicId,
            weekday: input.weekday,
            startLocal: input.startLocal,
            endLocal: input.endLocal,
            breakStartLocal: input.breakStartLocal,
            breakEndLocal: input.breakEndLocal,
          })
          .onConflictDoUpdate({
            target: [schema.scheduleTemplates.doctorId, schema.scheduleTemplates.weekday],
            set: {
              startLocal: input.startLocal,
              endLocal: input.endLocal,
              breakStartLocal: input.breakStartLocal,
              breakEndLocal: input.breakEndLocal,
            },
            setWhere: sql`${schema.scheduleTemplates.clinicId} = ${input.clinicId}::uuid`,
          });
        const own = await sp.execute(
          sql`SELECT 1 FROM schedule_templates WHERE doctor_id = ${input.doctorId}::uuid AND weekday = ${input.weekday} AND clinic_id = ${input.clinicId}::uuid`,
        );
        if (own.rows.length === 0) throw { code: PG.UNIQUE_VIOLATION };
      });
    } catch (e) {
      if (
        asPgError(e)?.code === PG.UNIQUE_VIOLATION ||
        (e as { code?: string }).code === PG.UNIQUE_VIOLATION
      )
        return err(
          appError(
            'SCHEDULE_CONFLICT',
            'The doctor already works in another clinic on that weekday',
          ),
        );
      throw e;
    }
    return ok(true as const);
  });

export const removeScheduleTemplate = (
  ctx: Ctx,
  actor: Actor,
  input: { doctorId: string; clinicId: string; weekday: number },
): Promise<Result<true, AppError>> =>
  transact(ctx, actor, async ({ tx, now }) => {
    if (actor.role !== 'registrar' || actor.clinicId !== input.clinicId)
      return fail('FORBIDDEN', 'You can only edit the schedule of your own clinic');
    const n = await visitsOutside(tx, now, { ...input, hours: null });
    if (n > 0) return conflict(n, 'the schedule');
    await tx.execute(
      sql`DELETE FROM schedule_templates WHERE doctor_id = ${input.doctorId}::uuid AND clinic_id = ${input.clinicId}::uuid AND weekday = ${input.weekday}`,
    );
    return ok(true as const);
  });

/**
 * Vacation, day off, extra day or custom hours on a date. A day cannot be taken away from
 * patients silently: if visits exist that the change would orphan, it is refused (use the sick
 * day for that, which cancels and notifies). "sick" is delegated to `markDoctorSick`.
 */
export const setScheduleException = async (
  ctx: Ctx,
  actor: Actor,
  input: ScheduleExceptionInput,
): Promise<Result<true, AppError>> => {
  if (input.kind === 'sick') {
    const r = await markDoctorSick(ctx, actor, {
      doctorId: input.doctorId,
      localDate: input.localDate,
    });
    return r.ok ? ok(true as const) : r;
  }
  return transact(ctx, actor, async ({ tx, now }) => {
    if (actor.role !== 'registrar' || !actor.clinicId)
      return fail('FORBIDDEN', 'Only the registrar edits schedules');
    const works =
      (
        await tx.execute(
          sql`SELECT 1 FROM schedule_templates WHERE doctor_id = ${input.doctorId}::uuid AND weekday = ${isoWeekday(input.localDate)} AND clinic_id = ${actor.clinicId}::uuid`,
        )
      ).rows.length > 0;
    const extra = input.kind === 'extra_day' || input.kind === 'custom_hours';
    if (extra && input.clinicId !== actor.clinicId)
      return fail('FORBIDDEN', 'You can only schedule work in your own clinic');
    if (!extra && !works)
      return fail('NOT_FOUND', 'The doctor does not work in your clinic on that day');
    const n = await visitsOutside(tx, now, {
      doctorId: input.doctorId,
      clinicId: extra ? (input.clinicId ?? null) : actor.clinicId,
      localDate: input.localDate,
      hours:
        extra && input.startLocal && input.endLocal
          ? {
              start: input.startLocal,
              end: input.endLocal,
              bs: input.breakStartLocal ?? null,
              be: input.breakEndLocal ?? null,
            }
          : null,
    });
    if (n > 0) return conflict(n, extra ? 'the new hours' : 'the day off');
    await tx.execute(sql`
      INSERT INTO schedule_exceptions (doctor_id, local_date, kind, clinic_id, start_local, end_local, break_start_local, break_end_local, created_at)
      VALUES (${input.doctorId}::uuid, ${input.localDate}::date, ${input.kind}::exception_kind, ${extra ? (input.clinicId ?? null) : null}::uuid,
              ${input.startLocal ?? null}::time, ${input.endLocal ?? null}::time, ${input.breakStartLocal ?? null}::time, ${input.breakEndLocal ?? null}::time, ${now.toISOString()}::timestamptz)
      ON CONFLICT (doctor_id, local_date) DO UPDATE SET kind = EXCLUDED.kind, clinic_id = EXCLUDED.clinic_id, start_local = EXCLUDED.start_local,
        end_local = EXCLUDED.end_local, break_start_local = EXCLUDED.break_start_local, break_end_local = EXCLUDED.break_end_local`);
    return ok(true as const);
  });
};

export const removeScheduleException = (
  ctx: Ctx,
  actor: Actor,
  input: { doctorId: string; localDate: string },
): Promise<Result<true, AppError>> =>
  transact(ctx, actor, async ({ tx }) => {
    if (actor.role !== 'registrar' || !actor.clinicId)
      return fail('FORBIDDEN', 'Only the registrar edits schedules');
    const works =
      (
        await tx.execute(
          sql`SELECT 1 FROM schedule_templates WHERE doctor_id = ${input.doctorId}::uuid AND weekday = ${isoWeekday(input.localDate)} AND clinic_id = ${actor.clinicId}::uuid`,
        )
      ).rows.length > 0;
    const ownExtra =
      (
        await tx.execute(
          sql`SELECT 1 FROM schedule_exceptions WHERE doctor_id = ${input.doctorId}::uuid AND local_date = ${input.localDate}::date AND clinic_id = ${actor.clinicId}::uuid`,
        )
      ).rows.length > 0;
    if (!works && !ownExtra) return fail('NOT_FOUND', 'Not found');
    // removing a sick mark does not bring cancelled visits back; it only reopens the day
    await tx.execute(
      sql`DELETE FROM schedule_exceptions WHERE doctor_id = ${input.doctorId}::uuid AND local_date = ${input.localDate}::date`,
    );
    return ok(true as const);
  });
