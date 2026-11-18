import { addDays, isoWeekday, localDateOf } from '@clinic/shared';
import { confirmBooking, holdSlot, type Actor, type Ctx } from '@clinic/domain';
import { sql } from 'drizzle-orm';
import { at, must, type World } from './helpers.js';

/** A clock that is the real clock. */
export const realClock = {
  get now(): Date {
    return new Date();
  },
} as { now: Date };

/** The n-th working day (Mon–Fri) starting `fromDays` days from today, as a Kyiv local date. */
export const futureWorkday = (n: number, fromDays = 3): string => {
  let d = addDays(localDateOf(new Date(), 'Europe/Kyiv'), fromDays);
  let k = n;
  for (;;) {
    if (isoWeekday(d) <= 5) {
      if (k === 0) return d;
      k--;
    }
    d = addDays(d, 1);
  }
};

export const bookReal = async (
  ctx: Ctx,
  w: World,
  who: number,
  doctor: number,
  dayIdx: number,
  time: string,
  key: string,
) => {
  const actor: Actor = (w.patients[who] as World['patients'][number]).actor;
  const h = must(
    await holdSlot(ctx, actor, {
      clinicId: w.kyiv,
      doctorId: w.kyivDoctors[doctor] as string,
      serviceId: w.c30,
      startsAt: at(futureWorkday(dayIdx), time),
    }),
  );
  const booked = must(
    await confirmBooking(ctx, actor, { appointmentId: h.id, idempotencyKey: key }),
  );
  // the confirmation email task is not what these tests count
  await ctx.db.execute(
    sql`UPDATE scheduled_tasks SET status = 'cancelled' WHERE kind = 'email.booking_confirmed' AND payload->>'appointmentId' = ${booked.id}`,
  );
  return booked;
};
