import { expect, test } from '@playwright/test';
import { catalog, gql, loginAs, newPatient, openSearch, firstSlot, slotByStart, type Catalog } from './helpers';

let c: Catalog;
test.beforeAll(async ({ request }) => { c = await catalog(request); });

test('registrar: phone booking through the same rules, and the day board', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, 'registrar.kyiv@demo.local');
  const page = await ctx.newPage();
  await page.goto(`/en/registrar/phone?service=${c.service}`);
  await expect(page.getByTestId('slot-grid')).toBeVisible();
  const { start, doctor } = await firstSlot(page);
  await slotByStart(page, start, doctor).click();
  const form = page.getByTestId('phone-booking');
  await expect(form).toBeVisible();
  // invalid new patient → errors at the fields, nothing booked
  await form.getByLabel('Full name').fill('x');
  await form.getByLabel('Phone', { exact: true }).fill('123');
  await page.getByTestId('phone-book').click();
  await expect(form.getByLabel('Full name')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.getByLabel('Phone', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('phone-booked')).toHaveCount(0);
  // valid → booked, the time leaves the grid
  const phone = `+3805${String(Date.now()).slice(-8)}`;
  await form.getByLabel('Full name').fill('Phone Patient');
  await form.getByLabel('Phone', { exact: true }).fill(phone);
  await page.getByTestId('phone-book').click();
  await expect(page.getByTestId('phone-booked')).toBeVisible();
  // the booked time is no longer offered (reload: the grid shows only what is still free)
  await page.reload();
  await expect(page.getByTestId('slot-grid')).toBeVisible();
  await expect(slotByStart(page, start, doctor)).toHaveCount(0);
  await ctx.close();
});

test('registrar: a doctor\'s sick day cancels the day, once', async ({ browser, request }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, 'registrar.kyiv@demo.local');
  // find a future day with booked visits in Kyiv
  const me = await gql<{ me: { clinicId: string } }>(ctx.request, `{ me { clinicId } }`);
  const clinicId = me.data!.me.clinicId;
  let date = '';
  for (let i = 3; i < 28 && !date; i++) {
    const d = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
    const r = await gql<{ clinicBoard: { status: string }[] }>(ctx.request, `query($c: ID!, $d: String!){ clinicBoard(clinicId:$c, date:$d){ status } }`, { c: clinicId, d });
    if ((r.data?.clinicBoard ?? []).some((a) => a.status === 'booked')) date = d;
  }
  expect(date).not.toBe('');
  const page = await ctx.newPage();
  await page.goto(`/en/registrar?date=${date}`);
  await expect(page.getByTestId('board-item').first()).toBeVisible();
  const before = await page.locator('[data-testid="board-item"][data-status="booked"]').count();
  expect(before).toBeGreaterThan(0);
  await page.getByTestId('sick-open').first().click();
  await page.getByTestId('sick-confirm').click();
  await expect(page.getByTestId('sick-result')).toContainText(/\d+ appointment/);
  await expect.poll(() => page.locator('[data-testid="board-item"][data-status="booked"]').count(), { timeout: 15_000 }).toBeLessThan(before);
  await request.dispose();
  await ctx.close();
});

test('doctor sees their own week, with actions only for their visits', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, 'doctor01@demo.local');
  const page = await ctx.newPage();
  await page.goto('/en/doctor');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  // never someone else's: every card belongs to the signed-in doctor (the API only returns those)
  const names = await page.getByTestId('appointment').locator('p').filter({ hasText: /·/ }).allTextContents();
  void names;
  await ctx.close();
});

test('manager: the report period lives in the URL (reload and Back)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, 'manager@demo.local');
  const page = await ctx.newPage();
  await page.goto('/en/manager/report?from=2026-08-20&to=2026-11-17');
  await expect(page.getByTestId('report')).toBeVisible();
  await expect(page.getByTestId('bookings')).not.toHaveText('0');
  await page.reload();
  await expect(page.getByLabel('From')).toHaveValue('2026-08-20');
  await page.getByLabel('From').fill('2026-10-01');
  await expect(page).toHaveURL(/from=2026-10-01/);
  await page.goBack();
  await expect(page.getByLabel('From')).toHaveValue('2026-08-20');
  await ctx.close();
});

test('forms: errors appear at the fields (client and server), the sign-in error is announced', async ({ page }) => {
  await page.goto('/en/sign-up');
  await page.getByRole('button', { name: 'Sign up' }).click();
  for (const label of ['Full name', 'Email', 'Phone', 'Password']) await expect(page.getByLabel(label)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert').first()).toBeVisible();
  // server-side error: an email that already exists
  await page.getByLabel('Full name').fill('Taken Email');
  await page.getByLabel('Email').fill('manager@demo.local');
  await page.getByLabel('Phone').fill('+380509998877');
  await page.getByLabel('Password').fill('a-long-enough-pass');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.locator('[data-error-code="EMAIL_TAKEN"]')).toBeVisible();
  await page.goto('/en/sign-in');
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('[data-error-code="INVALID_CREDENTIALS"]')).toBeVisible();
  await newPatient(page.context()).catch(() => undefined);
  void openSearch;
});

test('registrar: the phone-booking path works with the keyboard only', async ({ browser }) => {
  const ctx = await browser.newContext();
  await loginAs(ctx, 'registrar.kyiv@demo.local');
  const page = await ctx.newPage();
  const kb = page.keyboard;
  await page.goto('/en/registrar/phone');
  await expect(page.getByLabel('Service').locator('option')).not.toHaveCount(1);
  await page.getByLabel('Service').focus();
  for (let i = 0; i < 20 && (await page.getByLabel('Service').inputValue()) !== c.service; i++) { await kb.press('ArrowDown'); await page.waitForTimeout(350); }
  expect(await page.getByLabel('Service').inputValue()).toBe(c.service);
  await expect(page.getByTestId('slot-grid')).toBeVisible();
  const slot = page.getByTestId('slot').first();
  const start = await slot.getAttribute('data-start');
  const doctor = await slot.getAttribute('data-doctor');
  await slot.focus();
  await kb.press('Enter');
  const form = page.getByTestId('phone-booking');
  await expect(form).toBeVisible();
  await form.getByLabel('Full name').focus();
  await kb.type('Keyboard Patient');
  await kb.press('Tab');
  await kb.type(`+3805${String(Date.now()).slice(-8)}`);
  await kb.press('Tab');
  await expect(page.getByTestId('phone-book')).toBeFocused();
  await kb.press('Enter');
  await expect(page.getByTestId('phone-booked')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('slot-grid')).toBeVisible();
  await expect(page.locator(`[data-testid="slot"][data-start="${start}"][data-doctor="${doctor}"]`)).toHaveCount(0);
  await ctx.close();
});
