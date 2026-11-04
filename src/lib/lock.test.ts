import { describe, expect, it } from 'vitest';
import { hashPasscode, shouldLock, validPasscode, waitAfterFailures, type LockSettings } from './lock';

describe('app lock', () => {
  it('hashes passcodes with a salt', async () => {
    const a = await hashPasscode('1234', 'c2FsdA');
    expect(a).toBe(await hashPasscode('1234', 'c2FsdA'));
    expect(a).not.toBe(await hashPasscode('1235', 'c2FsdA'));
    expect(a).not.toBe(await hashPasscode('1234', 'b3RoZXI'));
    expect(a).not.toContain('1234');
  });

  it('accepts 4 to 6 digits', () => {
    expect(['123', '1234', '123456', '1234567', '12a4'].map(validPasscode)).toEqual([false, true, true, false, false]);
  });

  it('locks after the chosen time in the background', () => {
    const s: LockSettings = { salt: 'x', hash: 'y', length: 4, after: 5 };
    const t = 1_000_000_000;
    expect(shouldLock(s, t, t + 4 * 60_000)).toBe(false);
    expect(shouldLock(s, t, t + 5 * 60_000)).toBe(true);
    expect(shouldLock({ ...s, after: 0 }, t, t)).toBe(true);
    expect(shouldLock(null, t, t + 1e9)).toBe(false);
  });

  it('slows down guessing after 5 misses', () => {
    expect([4, 5, 6, 7, 20].map(waitAfterFailures)).toEqual([0, 30_000, 60_000, 120_000, 3_600_000]);
  });
});
