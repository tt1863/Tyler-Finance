import { describe, expect, it } from 'vitest';
import { ageOfMoney, agedOutflows } from './ageOfMoney';
import { addAccount, addCategory, addGroup, emptyData, saveTransaction } from './ops';
import type { BudgetData } from './types';
import { READY_TO_ASSIGN } from './types';

function setup() {
  let d = addGroup(emptyData(), 'Bills');
  d = addCategory(d, d.groups.find((g) => !g.system)!.id, 'Food');
  d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 100000, date: '2026-01-01' });
  d = addAccount(d, { name: 'Savings', type: 'savings', onBudget: true, balance: 0, date: '2026-01-01' });
  d = addAccount(d, { name: 'Visa', type: 'credit', onBudget: true, balance: 0, date: '2026-01-01' });
  const id = (n: string) => d.accounts.find((a) => a.name === n)!.id;
  return { d, food: d.categories.find((c) => c.name === 'Food')!.id, checking: id('Checking'), savings: id('Savings'), visa: id('Visa') };
}

const tx = (d: BudgetData, accountId: string, date: string, categoryId: string | null, amount: number, transferAccountId?: string) =>
  saveTransaction(d, { accountId, date, payee: 'P', categoryId, memo: '', amount, cleared: 'cleared', transferAccountId });

describe('age of money', () => {
  it('ages outflows first in, first out, weighted by amount', () => {
    let { d, food, checking } = setup();
    d = tx(d, checking, '2026-01-01', READY_TO_ASSIGN, 10000);
    d = tx(d, checking, '2026-01-11', READY_TO_ASSIGN, 10000);
    // All of Jan 1 (10000 × 30 days) and half of Jan 11 (5000 × 20 days).
    d = tx(d, checking, '2026-01-31', food, -15000);
    expect(agedOutflows(d)).toEqual([{ date: '2026-01-31', days: 400000 / 15000 }]);
    // The rest of Jan 11, 30 days later.
    d = tx(d, checking, '2026-02-10', food, -5000);
    expect(agedOutflows(d).at(-1)!.days).toBe(30);
  });

  it('ignores starting balances and transfers between cash accounts', () => {
    let { d, food, checking, savings } = setup();
    d = tx(d, checking, '2026-01-02', null, -50000, savings);
    d = tx(d, checking, '2026-01-03', food, -1000); // only the starting balance could cover this
    expect(agedOutflows(d)).toEqual([]);
    d = tx(d, savings, '2026-01-05', READY_TO_ASSIGN, 2000);
    d = tx(d, savings, '2026-01-09', food, -2000);
    expect(agedOutflows(d)).toEqual([{ date: '2026-01-09', days: 4 }]);
  });

  it('counts credit card payments, not card purchases', () => {
    let { d, food, checking, visa } = setup();
    d = tx(d, checking, '2026-01-01', READY_TO_ASSIGN, 10000);
    d = tx(d, visa, '2026-01-05', food, -3000);
    expect(agedOutflows(d)).toEqual([]);
    d = tx(d, checking, '2026-01-21', null, -3000, visa);
    expect(agedOutflows(d)).toEqual([{ date: '2026-01-21', days: 20 }]);
  });

  it('needs 10 outflows and averages the last 10', () => {
    let { d, food, checking } = setup();
    d = tx(d, checking, '2026-01-01', READY_TO_ASSIGN, 100000);
    for (let i = 1; i <= 9; i++) d = tx(d, checking, `2026-01-${String(i + 1).padStart(2, '0')}`, food, -100);
    expect(ageOfMoney(agedOutflows(d))).toBeNull();
    d = tx(d, checking, '2026-01-11', food, -100);
    // Ages 1..10 days -> average 5.5 -> 6
    expect(ageOfMoney(agedOutflows(d))).toBe(6);
    expect(ageOfMoney(agedOutflows(d), '2026-01-10')).toBeNull();
  });
});
