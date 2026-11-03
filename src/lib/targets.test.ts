import { describe, expect, it } from 'vitest';
import { categoryTargetStatus, computeBudget, targetStatus, weekdaysInMonth, type CategoryMonth } from './budget';
import { addAccount, addCategory, addGroup, emptyData, setAssigned, updateCategory } from './ops';

const cm = (over: Partial<CategoryMonth> = {}): CategoryMonth => ({ carryIn: 0, assigned: 0, activity: 0, available: 0, creditOverspent: 0, ...over });

describe('weekly targets', () => {
  it('counts the weekday in the month', () => {
    expect(weekdaysInMonth('2026-11', 0)).toBe(5); // Sundays in Nov 2026
    expect(weekdaysInMonth('2026-11', 1)).toBe(5); // Mondays
    expect(weekdaysInMonth('2026-02', 3)).toBe(4);
  });
  it('set aside: amount per week; refill: minus what is left over', () => {
    expect(targetStatus({ type: 'weekly', amount: 5000, weekday: 1 }, cm(), '2026-11').needed).toBe(25000);
    expect(targetStatus({ type: 'weekly', amount: 5000, weekday: 1, behavior: 'refill' }, cm({ carryIn: 7000 }), '2026-11').needed).toBe(18000);
  });
});

describe('monthly targets', () => {
  it('set aside another vs refill up to', () => {
    expect(targetStatus({ type: 'monthly', amount: 10000 }, cm({ carryIn: 4000 }), '2026-11').needed).toBe(10000);
    expect(targetStatus({ type: 'monthly', amount: 10000, behavior: 'refill' }, cm({ carryIn: 4000 }), '2026-11').needed).toBe(6000);
    // Older saved "refill" targets keep working.
    expect(targetStatus({ type: 'refill', amount: 10000 }, cm({ carryIn: 4000 }), '2026-11').needed).toBe(6000);
  });
});

describe('yearly targets', () => {
  it('spreads the amount over the months until the due date', () => {
    // $1,200 by Dec 15: from Nov that's 2 months -> $600 each.
    expect(targetStatus({ type: 'yearly', amount: 120000, due: '12-15', behavior: 'refill' }, cm(), '2026-11').needed).toBe(60000);
    // Due month already passed this year: next year's (Nov..Oct = 12 months).
    expect(targetStatus({ type: 'yearly', amount: 130000, due: '10-01', behavior: 'refill' }, cm(), '2026-11').needed).toBe(Math.ceil(130000 / 12));
  });
  it('set aside counts what was assigned earlier in the year', () => {
    let d = addGroup(emptyData(), 'G');
    d = addCategory(d, d.groups[0].id, 'Insurance');
    d = addAccount(d, { name: 'Chk', type: 'checking', onBudget: true, balance: 500000, date: '2026-01-01' });
    const id = d.categories[0].id;
    d = updateCategory(d, id, { target: { type: 'yearly', amount: 120000, due: '12-31' } });
    for (const m of ['2026-01', '2026-02', '2026-03']) d = setAssigned(d, m, id, 10000);
    const months = computeBudget(d, '2026-04');
    const st = categoryTargetStatus(d, d.categories[0], months.get('2026-04')!.categories[id], '2026-04');
    // $300 assigned so far; $900 left over 9 months = $100 a month.
    expect(st!.needed).toBe(10000);
  });
});

describe('custom targets', () => {
  it('one-time: spread until due, nothing after', () => {
    const t = { type: 'custom' as const, amount: 60000, due: '2027-01-20', repeat: 'none' as const, behavior: 'refill' as const };
    expect(targetStatus(t, cm({ carryIn: 0 }), '2026-11').needed).toBe(20000);
    expect(targetStatus(t, cm(), '2027-02').needed).toBe(0);
  });
  it('repeating monthly works like a monthly target', () => {
    expect(targetStatus({ type: 'custom', amount: 4000, due: '2026-11-15', repeat: 'monthly' }, cm(), '2026-12').needed).toBe(4000);
  });
  it('repeating yearly rolls to next year after the due month', () => {
    const t = { type: 'custom' as const, amount: 24000, due: '2026-03-01', repeat: 'yearly' as const, behavior: 'refill' as const };
    expect(targetStatus(t, cm(), '2026-11').needed).toBe(Math.ceil(24000 / 5)); // Nov..Mar 2027
  });
});
