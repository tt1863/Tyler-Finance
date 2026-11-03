import { describe, expect, it } from 'vitest';
import { computeBudget, targetStatus, underfundedAmount } from './budget';
import { addMonths, currentMonth } from './dates';
import { addAccount, addCategory, addGroup, assignUnderfunded, emptyData, snoozeTarget, updateCategory } from './ops';

const M = currentMonth();
const cm = { carryIn: 0, assigned: 0, activity: 0, available: 0, creditOverspent: 0 };

describe('snoozing a target', () => {
  it('asks for nothing in the snoozed month, then asks again next month', () => {
    const t = { type: 'monthly' as const, amount: 5000, snoozed: M };
    expect(targetStatus(t, cm, M)).toMatchObject({ needed: 0, underfunded: 0, snoozed: true });
    expect(targetStatus(t, cm, addMonths(M, 1)).underfunded).toBe(5000);
  });

  it('is left out of Assign underfunded, but overspending is still covered', () => {
    let d = addGroup(emptyData(), 'G');
    d = addCategory(d, d.groups[0].id, 'Gym');
    d = addAccount(d, { name: 'Chk', type: 'checking', onBudget: true, balance: 100000, date: `${M}-01` });
    const id = d.categories[0].id;
    d = updateCategory(d, id, { target: { type: 'monthly', amount: 5000 } });
    d = snoozeTarget(d, id, M);
    expect(assignUnderfunded(d, M).assigned[M]?.[id]).toBeUndefined();
    const s = computeBudget(d, M).get(M)!;
    expect(underfundedAmount(d.categories[0], { ...s.categories[id], available: -300 }, M, d)).toBe(300);
    d = snoozeTarget(d, id, null);
    expect(d.categories[0].target!.snoozed).toBeUndefined();
  });

  it('not available for credit card payment categories', () => {
    let d = addAccount(emptyData(), { name: 'Visa', type: 'credit', onBudget: true, balance: 0, date: `${M}-01` });
    const pay = d.categories[0].id;
    d = updateCategory(d, pay, { target: { type: 'monthly', amount: 5000 } });
    expect(snoozeTarget(d, pay, M).categories[0].target!.snoozed).toBeUndefined();
  });
});
