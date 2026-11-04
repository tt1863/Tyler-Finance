import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, dailyDigest, localTime, type PushSummary } from './digest';

const summary: PushSummary = {
  currency: 'USD',
  bills: [
    { date: '2026-11-05', payee: 'Rent', amount: -145000 },
    { date: '2026-11-06', payee: 'Internet', amount: -6500 },
  ],
  overspent: [{ key: '2026-11:dining', name: 'Dining Out', amount: -2350 }],
  needsCategory: 2,
  readyToAssign: 21750,
  weekSpent: 41200,
};
// 8:00 in Chicago on Wed Nov 4, 2026 (UTC-6).
const at8 = new Date('2026-11-04T14:00:00Z');
const tz = 'America/Chicago';

describe('daily push digest', () => {
  it('reads local time in the device time zone', () => {
    expect(localTime(at8, tz)).toEqual({ date: '2026-11-04', hour: 8, weekday: 3 });
    expect(localTime(at8, 'Not/AZone')).toEqual({ date: '2026-11-04', hour: 14, weekday: 3 });
  });

  it('sends once a day at the chosen hour', () => {
    expect(dailyDigest(summary, DEFAULT_PREFS, 9, tz, {}, at8)).toBeNull();
    const r = dailyDigest(summary, DEFAULT_PREFS, 8, tz, {}, at8)!;
    expect(r.message!.body.split('\n')).toEqual([
      'Due tomorrow: Rent $1,450.00',
      'Overspent: Dining Out ($23.50)',
      '2 transactions need a category',
    ]);
    expect(r.message!.url).toBe('#/calendar');
    expect(r.memory).toEqual({ lastDigest: '2026-11-04', overspent: ['2026-11:dining'], review: 2 });
    expect(dailyDigest(summary, DEFAULT_PREFS, 8, tz, r.memory, at8)).toBeNull();
  });

  it('only repeats news: same overspending and review count stay quiet', () => {
    const memory = { lastDigest: '2026-11-03', overspent: ['2026-11:dining'], review: 2 };
    const quiet = { ...summary, bills: [] };
    const r = dailyDigest(quiet, DEFAULT_PREFS, 8, tz, memory, at8)!;
    expect(r.message).toBeNull();
    expect(r.memory.lastDigest).toBe('2026-11-04');
    const more = dailyDigest({ ...quiet, needsCategory: 5 }, DEFAULT_PREFS, 8, tz, memory, at8)!;
    expect(more.message!.body).toBe('5 transactions need a category');
    expect(more.message!.url).toBe('#/accounts/all/review');
  });

  it('respects preferences and adds the weekly summary on Sundays', () => {
    const sunday = new Date('2026-11-08T14:00:00Z');
    const prefs = { bills: false, overspent: false, review: false, weekly: true };
    expect(dailyDigest(summary, prefs, 8, tz, {}, sunday)!.message!.body).toBe('This week you spent $412.00. Ready to Assign: $217.50');
    expect(dailyDigest(summary, prefs, 8, tz, {}, at8)!.message).toBeNull();
  });
});
