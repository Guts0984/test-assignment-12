import { describe, expect, it } from 'vitest';
import { loadDbEnv } from '../src/index.js';

describe('db env', () => {
  it('fails fast without the secret DATABASE_URL', () => {
    expect(() => loadDbEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadDbEnv({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });
  it('non-secret values have defaults', () => {
    const e = loadDbEnv({ DATABASE_URL: 'postgres://x' });
    expect(e).toMatchObject({ SEED_ENABLED: true, SEED_DOCTORS: 40, SEED_PATIENTS: 20000, SEED_APPOINTMENTS: 150000, SEED_PAST_DAYS: 150, SEED_FUTURE_DAYS: 30 });
    expect(e.SEED_PASSWORD).toBeUndefined();
  });
  it('rejects garbage numbers and short seed passwords', () => {
    expect(() => loadDbEnv({ DATABASE_URL: 'x', SEED_DOCTORS: 'many' })).toThrow(/SEED_DOCTORS/);
    expect(() => loadDbEnv({ DATABASE_URL: 'x', SEED_DOCTORS: '-1' })).toThrow(/SEED_DOCTORS/);
    expect(() => loadDbEnv({ DATABASE_URL: 'x', SEED_PASSWORD: 'short' })).toThrow(/SEED_PASSWORD/);
    expect(() => loadDbEnv({ DATABASE_URL: 'x', SEED_NOW: 'yesterday' })).toThrow(/SEED_NOW/);
  });
  it('parses booleans strictly', () => {
    expect(loadDbEnv({ DATABASE_URL: 'x', SEED_ENABLED: 'false' }).SEED_ENABLED).toBe(false);
    expect(() => loadDbEnv({ DATABASE_URL: 'x', SEED_ENABLED: 'maybe' })).toThrow(/SEED_ENABLED/);
  });
});
