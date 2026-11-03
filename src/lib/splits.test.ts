import { describe, expect, it } from 'vitest';
import { accountBalances, computeBudget } from './budget';
import { currentMonth } from './dates';
import { addAccount, addCategory, addGroup, deleteCategory, emptyData, needsCategory, saveTransaction, setAssigned } from './ops';
import { processDue, saveScheduled } from './scheduled';
import { READY_TO_ASSIGN } from './types';

const M = currentMonth();
const day = `${M}-05`;

function setup() {
  let d = addGroup(emptyData(), 'Everyday');
  for (const n of ['Groceries', 'Household', 'Fun']) d = addCategory(d, d.groups[0].id, n);
  d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 100000, date: `${M}-01` });
  d = addAccount(d, { name: 'Visa', type: 'credit', onBudget: true, balance: 0, date: `${M}-01` });
  const [g, h, f] = d.categories.filter((c) => !c.ccAccountId).map((c) => c.id);
  return { d, g, h, f, checking: d.accounts[0].id, visa: d.accounts[1].id, pay: d.categories.find((c) => c.ccAccountId)!.id };
}

const split = (d: ReturnType<typeof setup>['d'], accountId: string, parts: [string | null, number][]) =>
  saveTransaction(d, {
    accountId,
    date: day,
    payee: 'Target',
    categoryId: null,
    memo: '',
    amount: parts.reduce((s, [, a]) => s + a, 0),
    cleared: 'uncleared',
    splits: parts.map(([categoryId, amount]) => ({ categoryId, amount, memo: '' })),
  });

describe('split transactions', () => {
  it('each part hits its own category', () => {
    let { d, g, h, checking } = setup();
    d = split(d, checking, [[g, -6000], [h, -4000]]);
    const s = computeBudget(d, M).get(M)!;
    expect(s.categories[g].activity).toBe(-6000);
    expect(s.categories[h].activity).toBe(-4000);
    expect(accountBalances(d)[checking].working).toBe(90000);
  });

  it('a split can include income and a refund', () => {
    let { d, g, checking } = setup();
    d = split(d, checking, [[READY_TO_ASSIGN, 50000], [g, -2000]]);
    const s = computeBudget(d, M).get(M)!;
    expect(s.readyToAssign).toBe(150000);
    expect(s.categories[g].activity).toBe(-2000);
  });

  it('credit card splits move each funded part to the payment category', () => {
    let { d, g, h, visa, pay } = setup();
    d = setAssigned(d, M, g, 3000);
    d = setAssigned(d, M, h, 1000);
    d = split(d, visa, [[g, -3000], [h, -2000]]);
    const s = computeBudget(d, M).get(M)!;
    // Groceries is fully funded; Household only has $10 of its $20.
    expect(s.categories[pay].activity).toBe(4000);
    expect(s.categories[h]).toMatchObject({ available: -1000, creditOverspent: 1000 });
  });

  it('a split with an empty category needs attention', () => {
    let { d, g, checking } = setup();
    d = split(d, checking, [[g, -3000], [null, -2000]]);
    expect(needsCategory(d)).toHaveLength(1);
  });

  it('deleting a category reassigns split parts', () => {
    let { d, g, h, f, checking } = setup();
    d = split(d, checking, [[g, -3000], [h, -2000]]);
    d = deleteCategory(d, h, f);
    expect(computeBudget(d, M).get(M)!.categories[f].activity).toBe(-2000);
  });

  it('scheduled transactions keep their splits', () => {
    let { d, g, h, checking } = setup();
    d = saveScheduled(d, {
      accountId: checking,
      payee: 'Costco',
      categoryId: null,
      memo: '',
      amount: -10000,
      frequency: 'monthly',
      startDate: day,
      splits: [
        { categoryId: g, amount: -7000, memo: '' },
        { categoryId: h, amount: -3000, memo: '' },
      ],
    });
    const r = processDue(d, day);
    expect(r.data.transactions.find((t) => t.payee === 'Costco')?.splits).toHaveLength(2);
    expect(computeBudget(r.data, M).get(M)!.categories[g].activity).toBe(-7000);
  });
});
