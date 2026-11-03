import { describe, expect, it } from 'vitest';
import { computeBudget } from './budget';
import { addMonths, currentMonth } from './dates';
import { addAccount, addCategory, addGroup, emptyData, saveTransaction, setAssigned, updateCategory } from './ops';
import { applyQuickBudget, quickAmount, quickTotals } from './quickBudget';
import type { BudgetData } from './types';

const M = currentMonth();
const m = (n: number) => addMonths(M, n);

function setup() {
  let d = addGroup(emptyData(), 'Everyday');
  d = addCategory(d, d.groups[0].id, 'Groceries');
  d = addCategory(d, d.groups[0].id, 'Fun');
  d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 500000, date: `${m(-3)}-01` });
  const [g, f] = d.categories.map((c) => c.id);
  const chk = d.accounts[0].id;
  // Three past months: assigned 300/400/500, spent 250/350/450.
  [3, 2, 1].forEach((back, i) => {
    d = setAssigned(d, m(-back), g, 30000 + i * 10000);
    d = saveTransaction(d, { accountId: chk, date: `${m(-back)}-10`, payee: 'Store', categoryId: g, memo: '', amount: -(25000 + i * 10000), cleared: 'cleared' });
  });
  return { d, g, f };
}
const amount = (d: BudgetData, key: Parameters<typeof quickAmount>[0], id: string) =>
  quickAmount(key, d.categories.find((c) => c.id === id)!, M, computeBudget(d, M));

describe('credit card payment categories', () => {
  it('month-wide reset leaves the card payment money alone', () => {
    let { d } = setup();
    d = addAccount(d, { name: 'Visa', type: 'credit', onBudget: true, balance: 0, date: `${M}-01` });
    const pay = d.categories.find((c) => c.ccAccountId)!.id;
    d = setAssigned(d, M, pay, 20000);
    d = applyQuickBudget(d, M, 'resetAvailable');
    expect(d.assigned[M][pay]).toBe(20000);
    expect(applyQuickBudget(d, M, 'resetAvailable', pay).assigned[M][pay] ?? 0).toBe(0);
  });
});

describe('quick budget', () => {
  it('last month and 3-month averages', () => {
    const { d, g } = setup();
    expect(amount(d, 'lastAssigned', g)).toBe(50000);
    expect(amount(d, 'lastSpent', g)).toBe(45000);
    expect(amount(d, 'avgAssigned', g)).toBe(40000);
    expect(amount(d, 'avgSpent', g)).toBe(35000);
  });

  it('underfunded and reduce overfunding follow the target', () => {
    let { d, f } = setup();
    d = updateCategory(d, f, { target: { type: 'monthly', amount: 10000 } });
    expect(amount(d, 'underfunded', f)).toBe(10000);
    d = setAssigned(d, M, f, 15000);
    expect(amount(d, 'underfunded', f)).toBeNull();
    expect(amount(d, 'reduceOverfunding', f)).toBe(10000);
  });

  it('reset available returns the extra to Ready to Assign', () => {
    let { d, g } = setup();
    // 150 carried over from the past months; assign 100 more this month.
    d = setAssigned(d, M, g, 10000);
    const before = computeBudget(d, M).get(M)!;
    expect(amount(d, 'resetAvailable', g)).toBe(10000 - before.categories[g].available);
    d = applyQuickBudget(d, M, 'resetAvailable', g);
    const after = computeBudget(d, M).get(M)!;
    expect(after.categories[g].available).toBe(0);
    expect(after.readyToAssign).toBe(before.readyToAssign + before.categories[g].available);
  });

  it('month-wide: applies to every visible category and reports totals', () => {
    let { d, g, f } = setup();
    d = updateCategory(d, f, { hidden: true });
    expect(quickTotals(d, M).lastSpent).toEqual({ change: 45000, categories: 1 });
    d = applyQuickBudget(d, M, 'lastSpent');
    expect(d.assigned[M][g]).toBe(45000);
    expect(d.assigned[M][f]).toBeUndefined();
  });
});
