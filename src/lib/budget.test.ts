import { describe, expect, it } from 'vitest';
import { accountBalances, computeBudget, targetStatus } from './budget';
import { csvToRows } from './csv';
import { addMonths, currentMonth } from './dates';
import { demoData } from './demo';
import { parseMoney } from './money';
import {
  addAccount,
  addCategory,
  addGroup,
  assignUnderfunded,
  deleteCategory,
  emptyData,
  importTransactions,
  moveMoney,
  reconcile,
  saveTransaction,
  setAssigned,
} from './ops';
import type { BudgetData } from './types';
import { READY_TO_ASSIGN } from './types';

const M = currentMonth();
const day = (d: number, m = M) => `${m}-${String(d).padStart(2, '0')}`;

function setup() {
  let d = addGroup(emptyData(), 'Everyday');
  d = addCategory(d, d.groups[0].id, 'Groceries');
  d = addCategory(d, d.groups[0].id, 'Fun');
  d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 100000, date: day(1) });
  const g = d.categories.find((c) => c.name === 'Groceries')!.id;
  const fun = d.categories.find((c) => c.name === 'Fun')!.id;
  const checking = d.accounts[0].id;
  return { d, g, fun, checking };
}

const spend = (d: BudgetData, accountId: string, categoryId: string | null, amount: number, date = day(5), transferAccountId?: string) =>
  saveTransaction(d, { accountId, date, payee: 'Store', categoryId, memo: '', amount, cleared: 'uncleared', transferAccountId });

/**
 * Envelope invariant: money in categories + Ready to Assign == cash in budget
 * accounts. Credit overspending this month is new card debt rather than money
 * taken from the budget, so it's added back.
 */
function checkInvariant(d: BudgetData, month = M) {
  const s = computeBudget(d, month).get(month)!;
  const balances = accountBalances(d);
  let cash = 0;
  for (const a of d.accounts) if (a.onBudget && a.type !== 'credit') cash += balances[a.id].working;
  const credit = Object.values(s.categories).reduce((t, c) => t + c.creditOverspent, 0);
  return { lhs: s.readyToAssign + s.available + credit, cash };
}

describe('budget math', () => {
  it('starting balance becomes Ready to Assign', () => {
    const { d } = setup();
    expect(computeBudget(d, M).get(M)!.readyToAssign).toBe(100000);
  });

  it('assigning reduces RTA and spending reduces available', () => {
    let { d, g, checking } = setup();
    d = setAssigned(d, M, g, 30000);
    d = spend(d, checking, g, -12000);
    const s = computeBudget(d, M).get(M)!;
    expect(s.readyToAssign).toBe(70000);
    expect(s.categories[g]).toMatchObject({ assigned: 30000, activity: -12000, available: 18000 });
  });

  it('positive balances roll over, overspending comes out of next month RTA', () => {
    let { d, g, fun, checking } = setup();
    const prev = addMonths(M, -1);
    d = saveTransaction(d, { accountId: checking, date: day(1, prev), payee: 'Pay', categoryId: READY_TO_ASSIGN, memo: '', amount: 50000, cleared: 'cleared' });
    d = setAssigned(d, prev, g, 20000);
    d = spend(d, checking, g, -5000, day(3, prev));
    d = spend(d, checking, fun, -8000, day(3, prev));
    const s = computeBudget(d, M).get(M)!;
    expect(s.categories[g].available).toBe(15000);
    expect(s.categories[fun].available).toBe(0);
    expect(s.overspentLastMonth).toBe(8000);
    // 150000 income - 20000 assigned - 8000 overspent
    expect(s.readyToAssign).toBe(122000);
  });

  it('assigning in a future month reduces RTA now', () => {
    let { d, g } = setup();
    d = setAssigned(d, addMonths(M, 1), g, 10000);
    expect(computeBudget(d, M).get(M)!.readyToAssign).toBe(90000);
  });

  it('transfers between budget accounts do not affect the budget', () => {
    let { d, checking } = setup();
    d = addAccount(d, { name: 'Savings', type: 'savings', onBudget: true, balance: 0, date: day(1) });
    const savings = d.accounts[1].id;
    d = spend(d, checking, null, -25000, day(2), savings);
    expect(d.transactions.filter((t) => t.transferAccountId)).toHaveLength(2);
    expect(computeBudget(d, M).get(M)!.readyToAssign).toBe(100000);
    expect(accountBalances(d)[savings].working).toBe(25000);
  });

  it('credit card spending moves money to the payment category; payment clears it', () => {
    let { d, g, checking } = setup();
    d = addAccount(d, { name: 'Visa', type: 'credit', onBudget: true, balance: 0, date: day(1) });
    const visa = d.accounts.find((a) => a.name === 'Visa')!.id;
    const pay = d.categories.find((c) => c.ccAccountId === visa)!.id;
    d = setAssigned(d, M, g, 30000);
    d = spend(d, visa, g, -10000);
    let s = computeBudget(d, M).get(M)!;
    expect(s.categories[g].available).toBe(20000);
    expect(s.categories[pay].available).toBe(10000);
    d = spend(d, checking, null, -10000, day(6), visa);
    s = computeBudget(d, M).get(M)!;
    expect(s.categories[pay].available).toBe(0);
    expect(accountBalances(d)[visa].working).toBe(0);
    const inv = checkInvariant(d);
    expect(inv.lhs).toBe(inv.cash);
  });

  it('starting card debt does not touch RTA and paying it needs assigned money', () => {
    let { d, checking } = setup();
    d = addAccount(d, { name: 'Visa', type: 'credit', onBudget: true, balance: -40000, date: day(1) });
    const visa = d.accounts.find((a) => a.name === 'Visa')!.id;
    const pay = d.categories.find((c) => c.ccAccountId === visa)!.id;
    expect(computeBudget(d, M).get(M)!.readyToAssign).toBe(100000);
    d = setAssigned(d, M, pay, 40000);
    d = spend(d, checking, null, -40000, day(6), visa);
    const s = computeBudget(d, M).get(M)!;
    expect(s.categories[pay].available).toBe(0);
    expect(s.readyToAssign).toBe(60000);
    const inv = checkInvariant(d);
    expect(inv.lhs).toBe(inv.cash);
  });

  it('move money and assign underfunded', () => {
    let { d, g, fun } = setup();
    d = setAssigned(d, M, g, 20000);
    d = moveMoney(d, M, g, fun, 5000);
    expect(d.assigned[M][g]).toBe(15000);
    expect(d.assigned[M][fun]).toBe(5000);
    d = { ...d, categories: d.categories.map((c) => (c.id === g ? { ...c, target: { type: 'monthly', amount: 40000 } } : c)) };
    d = assignUnderfunded(d, M);
    expect(d.assigned[M][g]).toBe(40000);
  });

  it('deleting a category moves its activity and assigned money', () => {
    let { d, g, fun, checking } = setup();
    d = setAssigned(d, M, g, 20000);
    d = spend(d, checking, g, -5000);
    d = deleteCategory(d, g, fun);
    const s = computeBudget(d, M).get(M)!;
    expect(s.categories[fun].available).toBe(15000);
  });

  it('reconcile adds an adjustment and locks cleared transactions', () => {
    let { d, checking } = setup();
    d = reconcile(d, checking, 99000);
    expect(accountBalances(d)[checking].cleared).toBe(99000);
    expect(d.transactions.every((t) => t.cleared === 'reconciled')).toBe(true);
  });

  it('demo data keeps the budget balanced', () => {
    const d = demoData();
    const inv = checkInvariant(d);
    expect(inv.lhs).toBe(inv.cash);
  });
});

describe('targets', () => {
  const cm = { carryIn: 10000, assigned: 5000, activity: 0, available: 15000, creditOverspent: 0 };
  it('monthly', () => expect(targetStatus({ type: 'monthly', amount: 20000 }, cm, M).underfunded).toBe(15000));
  it('refill', () => expect(targetStatus({ type: 'refill', amount: 20000 }, cm, M).underfunded).toBe(5000));
  it('by date', () => {
    const t = targetStatus({ type: 'byDate', amount: 100000, month: addMonths(M, 2) }, cm, M);
    expect(t.needed).toBe(30000);
  });
  it('balance', () => expect(targetStatus({ type: 'balance', amount: 20000 }, cm, M).underfunded).toBe(5000));
});

describe('parsing', () => {
  it('money', () => {
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('$1,200')).toBe(120000);
    expect(parseMoney('(30)')).toBe(-3000);
    expect(parseMoney('20+5.5')).toBe(2550);
    expect(parseMoney('abc')).toBeNull();
  });

  it('csv import with duplicates', () => {
    const csv = 'Date,Description,Amount\n01/05/2026,"Coffee, Inc",-4.50\n2026-01-06,Paycheck,1000\n';
    const { rows } = csvToRows(csv);
    expect(rows).toEqual([
      { date: '2026-01-05', payee: 'Coffee, Inc', memo: '', amount: -450 },
      { date: '2026-01-06', payee: 'Paycheck', memo: '', amount: 100000 },
    ]);
    let { d, checking } = setup();
    const r1 = importTransactions(d, checking, rows);
    const r2 = importTransactions(r1.data, checking, rows);
    expect(r1.added).toBe(2);
    expect(r2.added).toBe(0);
    expect(r2.skipped).toBe(2);
  });

  it('csv with outflow/inflow columns', () => {
    const { rows } = csvToRows('Date,Payee,Memo,Outflow,Inflow\n2026-02-01,Store,milk,10.00,\n2026-02-02,Job,,,"1,000.00"');
    expect(rows.map((r) => r.amount)).toEqual([-1000, 100000]);
  });
});
