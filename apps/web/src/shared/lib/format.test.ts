import { describe, expect, it } from 'vitest';
import { formatLocalDate } from './format';
import { mmss } from './use-countdown';

describe('lib', () => {
  it('local dates are not shifted by any time zone', () => {
    // 2026-03-29 is the Kyiv spring-forward day: the label must still say the 29th, whatever the machine zone
    expect(formatLocalDate('2026-03-29', 'en', { day: 'numeric', month: 'numeric', year: 'numeric' })).toBe('3/29/2026');
    expect(formatLocalDate('2026-10-25', 'pl', { day: 'numeric', month: 'long' })).toContain('25');
  });
  it('countdown format', () => {
    expect(mmss(600)).toBe('10:00');
    expect(mmss(59)).toBe('0:59');
    expect(mmss(0)).toBe('0:00');
  });
});
