import { expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';

export const API = process.env['E2E_API_URL'] ?? 'http://localhost:54000/graphql';
export const PASSWORD = process.env['E2E_SEED_PASSWORD'] ?? 'Demo-Passw0rd!';

export const gql = async <T = Record<string, unknown>>(request: APIRequestContext, query: string, variables: Record<string, unknown> = {}): Promise<{ data?: T; errors?: { message: string; extensions?: { code?: string } }[] }> => {
  const r = await request.post(API, { data: { query, variables }, headers: { 'content-type': 'application/json' } });
  return r.json();
};

let counter = 0;
/** A brand new patient account whose session cookie lives in this browser context. */
export const newPatient = async (context: BrowserContext, label = 'e2e'): Promise<{ email: string }> => {
  const n = `${Date.now()}${++counter}`;
  const email = `${label}.${n}@e2e.test`;
  const r = await gql(context.request, `mutation($i: SignUpInput!){ signUp(input:$i){ id } }`, {
    i: { email, password: 'e2e-password-123', fullName: `E2E Patient ${n}`, phone: `+3805${n.slice(-8).padStart(8, '0')}`, locale: 'en' },
  });
  expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
  return { email };
};

export const loginAs = async (context: BrowserContext, email: string): Promise<void> => {
  const r = await gql(context.request, `mutation($i: SignInInput!){ signIn(input:$i){ id role } }`, { i: { email, password: PASSWORD } });
  expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
};

export type Catalog = { kyiv: string; warsaw: string; service: string; serviceName: string };
/** A service offered in Kyiv with free times, found through the public API. */
export const catalog = async (request: APIRequestContext): Promise<Catalog> => {
  const c = await gql<{ clinics: { id: string; city: string }[] }>(request, `{ clinics { id city } }`);
  const kyiv = c.data!.clinics.find((x) => x.city === 'Київ')!.id;
  const warsaw = c.data!.clinics.find((x) => x.city === 'Варшава')!.id;
  const s = await gql<{ clinicServices: { service: { id: string; nameEn: string; code: string } }[] }>(request, `query($c: ID!){ clinicServices(clinicId:$c){ service { id nameEn code } } }`, { c: kyiv });
  const svc = s.data!.clinicServices.find((x) => x.service.code === 'therapy-followup') ?? s.data!.clinicServices[0]!;
  return { kyiv, warsaw, service: svc.service.id, serviceName: svc.service.nameEn };
};

/** Opens the search page for a clinic/service (optionally one doctor) and waits for the grid. */
export const openSearch = async (page: Page, c: Catalog, city: string, doctor = '', locale = 'en'): Promise<void> => {
  await page.goto(`/${locale}?city=${city}&service=${c.service}${doctor ? `&doctor=${doctor}` : ''}`);
  await expect(page.getByTestId('slot-grid')).toBeVisible();
};

export const firstSlot = async (page: Page): Promise<{ start: string; doctor: string }> => {
  const slot = page.getByTestId('slot').first();
  await expect(slot).toBeVisible();
  return { start: (await slot.getAttribute('data-start'))!, doctor: (await slot.getAttribute('data-doctor'))! };
};

export const slotByStart = (page: Page, start: string, doctor?: string) => page.locator(`[data-testid="slot"][data-start="${start}"]${doctor ? `[data-doctor="${doctor}"]` : ''}`);

/**
 * Presses Tab until `target` has focus and returns how many presses it took (fails after `max`).
 * Keyboard tests use this instead of `.focus()`, so a 465-stop tab order cannot hide.
 */
export const tabTo = async (page: Page, target: Locator, max: number): Promise<number> => {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return i;
  }
  throw new Error(`focus did not reach the target within ${max} Tab presses`);
};

/** Chooses the option with `value` in the focused native select using only arrow keys. */
export const arrowSelect = async (page: Page, select: Locator, value: string, max = 25): Promise<void> => {
  for (let i = 0; i < max && (await select.inputValue()) !== value; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(350); }
  expect(await select.inputValue()).toBe(value);
};
