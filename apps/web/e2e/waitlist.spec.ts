import { expect, test } from '@playwright/test';
import { catalog, firstSlot, newPatient, openSearch, slotByStart, type Catalog } from './helpers';

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
  await slotByStart(p1, start).click();
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
  await expect(slotByStart(pa, start)).toHaveCount(0);

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
  await slotByStart(p1, start).click();
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
  await c1.close(); await c2.close(); await c3.close();
});
