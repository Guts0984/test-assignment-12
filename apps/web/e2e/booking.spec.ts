import { expect, test } from '@playwright/test';
import { arrowSelect, catalog, firstSlot, newPatient, openSearch, slotByStart, tabTo, type Catalog } from './helpers';

let c: Catalog;
test.beforeAll(async ({ request }) => { c = await catalog(request); });

test('hold → confirm → a second browser sees the time disappear WITHOUT reloading', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext(); // anonymous watcher
  await newPatient(a, 'live');
  const pa = await a.newPage();
  const pb = await b.newPage();
  await openSearch(pa, c, c.kyiv);
  await openSearch(pb, c, c.kyiv);
  const { start, doctor } = await firstSlot(pa);
  await expect(slotByStart(pb, start, doctor)).toBeVisible();

  await slotByStart(pa, start, doctor).click();
  await expect(pa.getByTestId('hold-panel')).toHaveAttribute('data-state', 'held');
  // my own reserved time stays on screen and is the ONLY highlighted one (other doctors at the same time are not)
  await expect(slotByStart(pa, start, doctor)).toBeVisible();
  await expect(pa.locator('[data-testid="slot"][aria-pressed="true"]')).toHaveCount(1);
  await expect(slotByStart(pb, start, doctor)).toHaveCount(0); // gone for the other browser the moment it is held
  await pa.getByTestId('confirm-booking').click();
  await expect(pa.getByTestId('booked-note')).toBeVisible();
  await expect(slotByStart(pb, start, doctor)).toHaveCount(0);

  // and the visit shows in the cabinet
  await pa.goto('/en/cabinet');
  await expect(pa.getByTestId('appointment')).toHaveCount(1);
  await expect(pa.getByTestId('appointment')).toHaveAttribute('data-status', 'booked');

  // cancelling returns the time to the other browser, again without a reload
  await pa.getByTestId('cancel-visit').click();
  await pa.getByTestId('cancel-yes').click();
  await expect(pa.getByTestId('no-visits')).toBeVisible();
  await expect(slotByStart(pb, start, doctor)).toBeVisible();
  await a.close(); await b.close();
});

test('an unconfirmed hold ends by itself: the time comes back for everyone and the late confirm is refused', async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  await newPatient(a, 'ttl');
  const pa = await a.newPage();
  const pb = await b.newPage();
  await openSearch(pa, c, c.kyiv);
  await openSearch(pb, c, c.kyiv);
  const { start, doctor } = await firstSlot(pa);
  await slotByStart(pa, start, doctor).click();
  await expect(pa.getByTestId('hold-panel')).toHaveAttribute('data-state', 'held');
  await expect(slotByStart(pb, start, doctor)).toHaveCount(0);
  await expect(pa.getByTestId('countdown')).toContainText(/0:0\d|0:1\d/); // test stack: 8-second holds
  // nobody confirms: after the TTL the panel says so and the second browser gets the time back
  await expect(pa.getByTestId('expired-note')).toBeVisible({ timeout: 20_000 });
  await expect(slotByStart(pb, start, doctor)).toBeVisible({ timeout: 20_000 });
  await a.close(); await b.close();
});

/** Starts at the top of the search page and reaches the first time slot with Tab / arrows only. */
const keyboardToFirstSlot = async (page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> => {
  await page.goto('/en');
  const city = page.getByLabel('City');
  const service = page.getByLabel('Service');
  await expect(city.locator('option')).not.toHaveCount(1);
  await tabTo(page, city, 30); // the header's links come first; the very first Tab starts at the page top
  await arrowSelect(page, city, c.kyiv, 6);
  await expect(service.locator('option')).not.toHaveCount(1);
  await tabTo(page, service, 3);
  await arrowSelect(page, service, c.service);
  await expect(page.getByTestId('slot-grid')).toBeVisible();
  const first = page.getByTestId('slot').first();
  await expect(first).toBeVisible();
  await tabTo(page, first, 3); // doctor select, then straight into the grid
  return first;
};

test('the whole patient path works with the keyboard only: Confirm is a few Tab stops after choosing a time', async ({ browser }) => {
  const ctx = await browser.newContext();
  await newPatient(ctx, 'kbd');
  const page = await ctx.newPage();
  const first = await keyboardToFirstSlot(page);
  // the label a screen reader reads carries the DATE, the time and the doctor
  const day = await first.locator('xpath=ancestor::*[@data-day]').getAttribute('data-day');
  const dayLabel = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const label = (await first.getAttribute('aria-label'))!;
  expect(label).toContain(dayLabel);
  expect(label).toMatch(/\b\d\d:\d\d\b/);
  expect(label.split(', ').length).toBeGreaterThanOrEqual(4);

  await page.keyboard.press('Enter');
  const panel = page.getByTestId('hold-panel');
  await expect(panel).toHaveAttribute('data-state', 'held');
  await expect(panel.getByRole('heading')).toBeFocused(); // focus moved to the reservation by itself
  const tabs = await tabTo(page, page.getByTestId('confirm-booking'), 10);
  expect(tabs).toBeLessThanOrEqual(3);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('booked-note')).toBeVisible();
  await ctx.close();
});


/**
 * One signed-in patient in two tabs. Tab 1 holds a time, then tab 2 picks another one, which
 * replaces the hold on the server. `blockSockets`: tab 1 gets no live events (WebSocket refused),
 * so it can only find out by re-checking.
 */
const twoTabs = async (browser: import('@playwright/test').Browser, label: string, blockSockets: boolean) => {
  const ctx = await browser.newContext();
  await newPatient(ctx, label);
  const p1 = await ctx.newPage();
  if (blockSockets) await p1.routeWebSocket(/.*/, (ws) => ws.close());
  await openSearch(p1, c, c.kyiv);
  const first = await firstSlot(p1);
  await slotByStart(p1, first.start, first.doctor).click();
  await expect(p1.getByTestId('hold-panel')).toHaveAttribute('data-state', 'held');
  const p2 = await ctx.newPage();
  await openSearch(p2, c, c.kyiv);
  const second = await firstSlot(p2); // tab 1's time is held, so this is a different one
  await slotByStart(p2, second.start, second.doctor).click();
  await expect(p2.getByTestId('hold-panel')).toHaveAttribute('data-state', 'held');
  return { ctx, p1, p2 };
};

test('a second tab: the hold replaced in tab 2 stops counting down in tab 1 (live event)', async ({ browser }) => {
  const { ctx, p1 } = await twoTabs(browser, 'tab2live', false);
  await expect(p1.getByTestId('hold-panel')).toHaveAttribute('data-state', 'released');
  await expect(p1.getByTestId('released-note')).toBeVisible();
  await expect(p1.getByTestId('countdown')).toHaveCount(0);
  await expect(p1.getByTestId('confirm-booking')).toHaveCount(0);
  await ctx.close();
});

test('a second tab without live events: coming back to the tab re-checks the hold', async ({ browser }) => {
  const { ctx, p1 } = await twoTabs(browser, 'tab2focus', true);
  await expect(p1.getByTestId('hold-panel')).toHaveAttribute('data-state', 'held'); // nothing told it yet
  await p1.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(p1.getByTestId('hold-panel')).toHaveAttribute('data-state', 'released');
  await ctx.close();
});

test('a second tab without live events: Confirm on a replaced hold says it is no longer active', async ({ browser }) => {
  const { ctx, p1 } = await twoTabs(browser, 'tab2conf', true);
  await p1.getByTestId('confirm-booking').click();
  await expect(p1.getByTestId('hold-panel')).toHaveAttribute('data-state', 'released');
  await expect(p1.getByTestId('released-note')).toContainText('no longer active');
  // and nothing was booked by that click: tab 2's hold is still the live one
  await expect(p1.context().pages()[1]!.getByTestId('hold-panel')).toHaveAttribute('data-state', 'held');
  await ctx.close();
});

test('cabinet notifications are translated messages with a locale date, not raw codes', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US' }); // a US browser must not leak a US date into the Ukrainian page
  await newPatient(ctx, 'notif');
  const page = await ctx.newPage();
  await openSearch(page, c, c.kyiv);
  const { start, doctor } = await firstSlot(page);
  await slotByStart(page, start, doctor).click();
  await page.getByTestId('confirm-booking').click();
  await expect(page.getByTestId('booked-note')).toBeVisible();
  const item = page.locator('[data-kind="booking_confirmed"]');
  await expect(async () => { await page.goto('/uk/cabinet'); await expect(item.first()).toBeVisible({ timeout: 2000 }); }).toPass({ timeout: 20_000 });
  const text = (await item.first().innerText());
  expect(text).toContain('Запис підтверджено');
  expect(text).not.toContain('booking_confirmed');
  expect(text).not.toMatch(/\b(AM|PM)\b/);
  expect(text).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  await page.goto('/pl/cabinet');
  await expect(page.locator('[data-kind="booking_confirmed"]').first()).toContainText('Wizyta potwierdzona');
  await ctx.close();
});

test('state lives in the URL: reload and Back restore the search', async ({ page }) => {
  await openSearch(page, c, c.kyiv);
  await expect(page).toHaveURL(new RegExp(`city=${c.kyiv}.*service=${c.service}|service=${c.service}.*city=${c.kyiv}`));
  await page.reload();
  await expect(page.getByTestId('slot-grid')).toBeVisible();
  await expect(page.getByLabel('City')).toHaveValue(c.kyiv);
  await page.getByLabel('City').selectOption(c.warsaw);
  await expect(page).toHaveURL(new RegExp(`city=${c.warsaw}`));
  await page.goBack();
  await expect(page.getByLabel('City')).toHaveValue(c.kyiv);
  await expect(page.getByTestId('slot-grid')).toBeVisible();
});

test('times are the CLINIC\'s, whatever the browser time zone; money is in the clinic currency, per locale', async ({ browser, request }) => {
  const ny = await browser.newContext({ timezoneId: 'America/New_York', locale: 'en-US' });
  const page = await ny.newPage();
  const api = await request.post(process.env['E2E_API_URL'] ?? 'http://localhost:54000/graphql', { data: { query: `query($i: AvailabilityInput!){ availability(input:$i){ timeZone slots { localTime startsAt } } }`, variables: { i: { clinicId: c.warsaw, serviceId: (await warsawService(request, c)) } } } });
  const body = (await api.json()).data.availability as { timeZone: string; slots: { localTime: string; startsAt: string }[] };
  expect(body.timeZone).toBe('Europe/Warsaw');
  const s = body.slots[0]!;
  await openSearch(page, { ...c, service: await warsawService(request, c) }, c.warsaw, '', 'en');
  const btn = page.locator(`[data-testid="slot"][data-start="${s.startsAt}"]`);
  await expect(btn).toBeVisible();
  await expect(btn).toContainText(s.localTime); // Warsaw wall clock, not New York's
  const nyHour = new Date(s.startsAt).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
  expect(nyHour).not.toBe(s.localTime);
  await expect(page.getByText(/Europe\/Warsaw/)).toBeVisible();
  // money: złoty with Polish formatting
  await page.goto(`/pl?city=${c.warsaw}&service=${await warsawService(request, c)}`);
  await expect(page.getByTestId('service').locator('option:checked')).toContainText(/zł/);
  await ny.close();
});

const warsawService = async (request: import('@playwright/test').APIRequestContext, cat: Catalog): Promise<string> => {
  const r = await request.post(process.env['E2E_API_URL'] ?? 'http://localhost:54000/graphql', { data: { query: `query($c: ID!){ clinicServices(clinicId:$c){ service { id code } } }`, variables: { c: cat.warsaw } } });
  const list = (await r.json()).data.clinicServices as { service: { id: string; code: string } }[];
  return (list.find((x) => x.service.code === 'therapy-followup') ?? list[0]!).service.id;
};

test('locales: uk, en and pl render their own words, plurals and money', async ({ page }) => {
  await page.goto('/uk');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Запис до лікаря');
  await page.goto('/pl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Umów wizytę u lekarza');
  await page.goto('/en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Book a doctor');
  await page.getByRole('button', { name: 'UA' }).click();
  await expect(page).toHaveURL(/\/uk/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Запис до лікаря');
});
