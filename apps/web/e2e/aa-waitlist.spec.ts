import { expect, test } from '@playwright/test';
import { catalog, firstSlot, gql, newPatient, openSearch, slotByStart, type Catalog } from './helpers';

let c: Catalog;
test.beforeAll(async ({ request }) => { c = await catalog(request); });

test('cancel with a waiting list: the first in the queue gets the offer live and accepts; the second gets nothing', async ({ browser }) => {
  const ctx = await Promise.all([1, 2, 3].map(() => browser.newContext()));
  const [c1, c2, c3] = ctx as [typeof ctx[0], typeof ctx[0], typeof ctx[0]];
  await newPatient(c1!, 'wl1'); await newPatient(c2!, 'wl2'); await newPatient(c3!, 'wl3');
  const p1 = await c1!.newPage(); const p2 = await c2!.newPage(); const p3 = await c3!.newPage();

  // patient 1 books a time with a specific doctor
  await openSearch(p1, c, c.kyiv);
  const { start, doctor } = await firstSlot(p1);
  await slotByStart(p1, start, doctor).click();
  await p1.getByTestId('confirm-booking').click();
  await expect(p1.getByTestId('booked-note')).toBeVisible();

  // patients 2 and 3 queue for that doctor (in this order)
  for (const p of [p2, p3]) {
    await openSearch(p, c, c.kyiv, doctor);
    await p.getByTestId('join-waitlist').click();
    await expect(p.getByTestId('waitlist-joined')).toBeVisible();
    await p.waitForTimeout(150);
  }
  await p2.goto('/en/cabinet');
  await p3.goto('/en/cabinet');

  // patient 1 cancels in the cabinet
  await p1.goto('/en/cabinet');
  await p1.getByTestId('cancel-visit').click();
  await p1.getByTestId('cancel-yes').click();
  await expect(p1.getByTestId('no-visits')).toBeVisible();

  // patient 2's open cabinet shows the offer by itself; nobody can see the time in the grid
  await expect(p2.getByTestId('offer')).toBeVisible({ timeout: 15_000 });
  await expect(p3.getByTestId('offer')).toHaveCount(0);
  const anon = await browser.newContext();
  const pa = await anon.newPage();
  await openSearch(pa, c, c.kyiv, doctor);
  await expect(slotByStart(pa, start, doctor)).toHaveCount(0);

  await p2.getByTestId('accept-offer').click();
  await expect(p2.getByTestId('appointment')).toHaveCount(1, { timeout: 15_000 });
  await expect(p2.getByTestId('appointment')).toHaveAttribute('data-status', 'booked');
  await expect(p3.getByTestId('offer')).toHaveCount(0);
  // tidy up: patient 3 leaves the queue, so later tests start from an empty one
  await p3.goto('/en/cabinet');
  await p3.getByRole('button', { name: 'Leave the queue' }).click();
  await expect(p3.getByTestId('waitlist-entry')).toHaveCount(0);
  for (const x of [...ctx, anon]) await x.close();
});

test('the first patient does not answer: after the offer time the second one receives it', async ({ browser }) => {
  const [c1, c2, c3] = await Promise.all([1, 2, 3].map(() => browser.newContext())) as [import('@playwright/test').BrowserContext, import('@playwright/test').BrowserContext, import('@playwright/test').BrowserContext];
  await newPatient(c1, 'wt1'); await newPatient(c2, 'wt2'); await newPatient(c3, 'wt3');
  const p1 = await c1.newPage(); const p2 = await c2.newPage(); const p3 = await c3.newPage();
  await openSearch(p1, c, c.kyiv);
  const { start, doctor } = await firstSlot(p1);
  await slotByStart(p1, start, doctor).click();
  await p1.getByTestId('confirm-booking').click();
  await expect(p1.getByTestId('booked-note')).toBeVisible();
  for (const p of [p2, p3]) { await openSearch(p, c, c.kyiv, doctor); await p.getByTestId('join-waitlist').click(); await expect(p.getByTestId('waitlist-joined')).toBeVisible(); await p.waitForTimeout(150); }
  await p2.goto('/en/cabinet'); await p3.goto('/en/cabinet');
  await p1.goto('/en/cabinet');
  await p1.getByTestId('cancel-visit').click();
  await p1.getByTestId('cancel-yes').click();
  await expect(p2.getByTestId('offer')).toBeVisible({ timeout: 15_000 });
  await expect(p3.getByTestId('offer')).toHaveCount(0);
  // patient 2 stays silent for the offer lifetime (8 s in the test stack)
  await expect(p3.getByTestId('offer')).toBeVisible({ timeout: 30_000 });
  await expect(p2.getByTestId('offer')).toHaveCount(0, { timeout: 15_000 });
  // tidy up: leave the queue so later specs start with an empty one
  for (const p of [p2, p3]) {
    await p.goto('/en/cabinet');
    await p.getByRole('button', { name: 'Leave the queue' }).click();
    await expect(p.getByTestId('waitlist-entry')).toHaveCount(0);
  }
  await c1.close(); await c2.close(); await c3.close();
});

test('with "Any doctor" the waiting list never guesses: the patient must choose a doctor, and the entry is for that doctor', async ({ browser }) => {
  const ctx = await browser.newContext();
  await newPatient(ctx, 'wlpick');
  const page = await ctx.newPage();
  // a service that at least two Kyiv doctors perform (otherwise there is nothing to choose between)
  const svcs = await gql<{ clinicServices: { service: { id: string } }[] }>(ctx.request, `query($c: ID!){ clinicServices(clinicId:$c){ service { id } } }`, { c: c.kyiv });
  let multi = '';
  for (const x of svcs.data!.clinicServices) {
    const d = await gql<{ clinicDoctors: { id: string }[] }>(ctx.request, `query($c: ID!, $s: ID){ clinicDoctors(clinicId:$c, serviceId:$s){ id } }`, { c: c.kyiv, s: x.service.id });
    if (d.data!.clinicDoctors.length >= 2) { multi = x.service.id; break; }
  }
  expect(multi, 'the e2e seed must have a Kyiv service with two doctors').not.toBe('');
  await openSearch(page, { ...c, service: multi }, c.kyiv); // no doctor in the URL
  const doctorSelect = page.getByTestId('waitlist-doctor');
  const join = page.getByTestId('join-waitlist');
  await expect(doctorSelect).toHaveValue('');
  await expect(join).toBeDisabled();
  await expect(page.getByTestId('waitlist-pick-doctor')).toBeVisible();
  // implicit submit with Enter in a date field must not slip through the disabled button
  await page.getByLabel('From').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('waitlist-joined')).toHaveCount(0);
  const mine = async (): Promise<{ doctorId: string }[]> => ((await gql<{ myWaitlist: { doctorId: string }[] }>(ctx.request, `{ myWaitlist { doctorId } }`)).data!.myWaitlist);
  expect(await mine()).toHaveLength(0);
  // the list is the clinic's doctors for this service; choose the SECOND one (the old bug queued the first)
  await expect.poll(() => doctorSelect.locator('option').count()).toBeGreaterThan(1); // the doctors arrive after the page (at least one real doctor besides the empty choice)
  const options = await doctorSelect.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  expect(options.length).toBeGreaterThan(1);
  const wanted = options[1]!;
  await doctorSelect.selectOption(wanted);
  await expect(join).toBeEnabled();
  await join.click();
  await expect(page.getByTestId('waitlist-joined')).toBeVisible();
  expect((await mine()).map((e) => e.doctorId)).toEqual([wanted]);
  // choosing "no doctor" again disables the button again
  await doctorSelect.selectOption('');
  await expect(join).toBeDisabled();
  // tidy up: later specs start with an empty queue
  await page.goto('/en/cabinet');
  await page.getByRole('button', { name: 'Leave the queue' }).click();
  await expect(page.getByTestId('waitlist-entry')).toHaveCount(0);
  await ctx.close();
});

test('a doctor chosen in the search is preselected in the waiting-list card', async ({ browser }) => {
  const ctx = await browser.newContext();
  await newPatient(ctx, 'wlpre');
  const page = await ctx.newPage();
  await openSearch(page, c, c.kyiv);
  const { doctor } = await firstSlot(page);
  await openSearch(page, c, c.kyiv, doctor);
  await expect(page.getByTestId('waitlist-doctor')).toHaveValue(doctor);
  await expect(page.getByTestId('join-waitlist')).toBeEnabled();
  await ctx.close();
});
