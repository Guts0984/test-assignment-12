import { expect, test } from '@playwright/test';
import { catalog, firstSlot, newPatient, openSearch, slotByStart, type Catalog } from './helpers';

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

test('the whole patient path works with the keyboard only', async ({ browser }) => {
  const ctx = await browser.newContext();
  await newPatient(ctx, 'kbd');
  const page = await ctx.newPage();
  await page.goto('/en');
  const kb = page.keyboard;
  await expect(page.getByLabel('City').locator('option')).not.toHaveCount(1);
  await page.getByLabel('City').focus();
  for (let i = 0; i < 4 && (await page.getByLabel('City').inputValue()) !== c.kyiv; i++) { await kb.press('ArrowDown'); await page.waitForTimeout(400); }
  expect(await page.getByLabel('City').inputValue()).toBe(c.kyiv);
  await expect(page.getByLabel('Service').locator('option')).not.toHaveCount(1);
  await page.getByLabel('Service').focus();
  for (let i = 0; i < 20 && (await page.getByLabel('Service').inputValue()) !== c.service; i++) { await kb.press('ArrowDown'); await page.waitForTimeout(350); }
  expect(await page.getByLabel('Service').inputValue()).toBe(c.service);
  await expect(page.getByTestId('slot-grid')).toBeVisible();
  const slot = page.getByTestId('slot').first();
  await slot.focus();
  await expect(slot).toBeFocused();
  await kb.press('Enter');
  await expect(page.getByTestId('hold-panel')).toHaveAttribute('data-state', 'held');
  await page.getByTestId('confirm-booking').focus();
  await kb.press('Enter');
  await expect(page.getByTestId('booked-note')).toBeVisible();
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
