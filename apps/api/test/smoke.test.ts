import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gql, startFixture, type Fixture } from './helpers.js';

let f: Fixture;
beforeAll(async () => { f = await startFixture(); });
afterAll(async () => { await f.stop(); });

describe('boots', () => {
  it('serves public data and health', async () => {
    const r = await gql(f.api, '{ clinics { id city timeZone currency } }');
    expect(r.body.errors).toBeUndefined();
    expect((r.body.data as { clinics: unknown[] }).clinics).toHaveLength(2);
    expect((await fetch(`${f.api.url}/health`)).status).toBe(200);
    expect((await fetch(`${f.api.url}/ready`)).status).toBe(200);
  });
});
