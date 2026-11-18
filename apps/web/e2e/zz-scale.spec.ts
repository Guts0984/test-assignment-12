import { expect, test } from '@playwright/test';
import { gql, loginAs, newPatient, type Catalog, catalog } from './helpers';

// With `docker compose up --scale worker=3`: every sick-day email must arrive exactly once.
const MAIL = process.env['E2E_MAIL_URL'] ?? 'http://localhost:58025';

test('a sick day with several workers: every patient gets exactly one email', async ({ browser, request }) => {
  const c: Catalog = await catalog(request);
  const reg = await browser.newContext();
  await loginAs(reg, 'registrar.kyiv@demo.local');
  const me = await gql<{ me: { clinicId: string } }>(reg.request, `{ me { clinicId } }`);
  // 6 fresh patients book the same doctor on the same far-away day
  const availability = await gql<{ availability: { slots: { doctorId: string; startsAt: string; localDate: string }[] } }>(reg.request, `query($i: AvailabilityInput!){ availability(input:$i){ slots { doctorId startsAt localDate } } }`, { i: { clinicId: me.data!.me.clinicId, serviceId: c.service } });
  const first = availability.data!.availability.slots[0]!;
  const same = availability.data!.availability.slots.filter((s) => s.doctorId === first.doctorId && s.localDate === first.localDate).slice(0, 12);
  const emails: string[] = [];
  const picked = same.filter((_, i) => i % 2 === 0).slice(0, 5);
  for (const s of picked) {
    const ctx = await browser.newContext();
    const { email } = await newPatient(ctx, 'scale');
    const h = await gql<{ holdSlot: { id: string } }>(ctx.request, `mutation($i: HoldSlotInput!){ holdSlot(input:$i){ id } }`, { i: { clinicId: me.data!.me.clinicId, doctorId: s.doctorId, serviceId: c.service, startsAt: s.startsAt } });
    const ok = await gql(ctx.request, `mutation($i: ConfirmBookingInput!){ confirmBooking(input:$i){ id } }`, { i: { appointmentId: h.data!.holdSlot.id, idempotencyKey: `scale-${s.startsAt}` } });
    expect(ok.errors).toBeUndefined();
    emails.push(email);
    await ctx.close();
  }
  await request.delete(`${MAIL}/api/v1/messages`);
  const sick = await gql<{ markDoctorSick: { cancelled: number } }>(reg.request, `mutation($i: MarkSickInput!){ markDoctorSick(input:$i){ cancelled } }`, { i: { doctorId: first.doctorId, localDate: first.localDate } });
  expect(sick.data!.markDoctorSick.cancelled).toBeGreaterThanOrEqual(picked.length);
  // marking again changes nothing
  expect((await gql<{ markDoctorSick: { cancelled: number } }>(reg.request, `mutation($i: MarkSickInput!){ markDoctorSick(input:$i){ cancelled } }`, { i: { doctorId: first.doctorId, localDate: first.localDate } })).data!.markDoctorSick.cancelled).toBe(0);
  const wanted = emails.length;
  await expect.poll(async () => {
    const r = await (await request.get(`${MAIL}/api/v1/messages?limit=500`)).json() as { messages: { To: { Address: string }[]; Subject: string }[] };
    return r.messages.filter((m) => emails.includes(m.To[0]!.Address) && m.Subject.includes('doctor is ill')).length;
  }, { timeout: 30_000 }).toBe(wanted);
  await new Promise((r) => setTimeout(r, 3000));
  const final = await (await request.get(`${MAIL}/api/v1/messages?limit=500`)).json() as { messages: { MessageID: string; Subject: string; To: { Address: string }[] }[] };
  const mine = final.messages.filter((m) => emails.includes(m.To[0]!.Address) && (m as { Subject?: string }).Subject?.includes('doctor is ill'));
  expect(mine).toHaveLength(wanted); // exactly one each
  expect(new Set(mine.map((m) => m.MessageID)).size).toBe(wanted);
  await reg.close();
});
