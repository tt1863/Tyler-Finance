import { describe, expect, it } from 'vitest';
import { accountBalances, computeBudget } from './budget';
import { addMonths, currentMonth } from './dates';
import { addAccount, addCategory, addGroup, emptyData, moveMoney, saveTransaction, setAssigned } from './ops';
import type { BudgetData } from './types';

// Use last month and this month so rollover can be checked.
const M0 = addMonths(currentMonth(), -1);
const M1 = currentMonth();

function setup() {
  let d = addGroup(emptyData(), 'Everyday');
  for (const n of ['Dining', 'Fun']) d = addCategory(d, d.groups[0].id, n);
  d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 100000, date: `${M0}-01` });
  d = addAccount(d, { name: 'Visa', type: 'credit', onBudget: true, balance: 0, date: `${M0}-01` });
  const [dining, fun] = d.categories.filter((c) => !c.ccAccountId).map((c) => c.id);
  return { d, dining, fun, chk: d.accounts[0].id, visa: d.accounts[1].id, pay: d.categories.find((c) => c.ccAccountId)!.id };
}
const spend = (d: BudgetData, accountId: string, categoryId: string, amount: number, day = 10, month = M0) =>
  saveTransaction(d, { accountId, date: `${month}-${String(day).padStart(2, '0')}`, payee: 'Store', categoryId, memo: '', amount, cleared: 'cleared' });
const at = (d: BudgetData, m: string) => computeBudget(d, M1).get(m)!;

describe('credit card overspending (YNAB style)', () => {
  it('only the funded part of a card purchase moves to the payment category', () => {
    let { d, dining, visa, pay } = setup();
    d = setAssigned(d, M0, dining, 3000);
    d = spend(d, visa, dining, -5000);
    const s = at(d, M0);
    expect(s.categories[pay].available).toBe(3000);
    expect(s.categories[dining]).toMatchObject({ available: -2000, creditOverspent: 2000 });
    expect(accountBalances(d)[visa].working).toBe(-5000);
  });

  it('credit overspending resets next month without touching Ready to Assign', () => {
    let { d, dining, visa } = setup();
    d = setAssigned(d, M0, dining, 3000);
    d = spend(d, visa, dining, -5000);
    const before = at(d, M0).readyToAssign;
    const next = at(d, M1);
    expect(next.categories[dining].available).toBe(0);
    expect(next.overspentLastMonth).toBe(0);
    expect(next.readyToAssign).toBe(before);
  });

  it('cash overspending still comes out of next month', () => {
    let { d, dining, chk } = setup();
    d = setAssigned(d, M0, dining, 3000);
    d = spend(d, chk, dining, -5000);
    expect(at(d, M0).categories[dining]).toMatchObject({ available: -2000, creditOverspent: 0 });
    expect(at(d, M1).overspentLastMonth).toBe(2000);
  });

  it('mixed: cash part comes out of next month, credit part becomes card debt', () => {
    let { d, dining, chk, visa, pay } = setup();
    d = setAssigned(d, M0, dining, 3000);
    d = spend(d, visa, dining, -2000, 5); // funded: 20 moves to the card
    d = spend(d, chk, dining, -2500, 8); // 10 left, so 15 cash overspent
    d = spend(d, visa, dining, -1000, 12); // nothing left: 10 credit overspent
    const s = at(d, M0);
    expect(s.categories[dining]).toMatchObject({ available: -2500, creditOverspent: 1000 });
    expect(s.categories[pay].available).toBe(2000);
    expect(at(d, M1).overspentLastMonth).toBe(1500);
  });

  it('covering credit overspending moves the money to the payment category', () => {
    let { d, dining, fun, visa, pay } = setup();
    d = setAssigned(d, M0, dining, 3000);
    d = setAssigned(d, M0, fun, 5000);
    d = spend(d, visa, dining, -5000);
    d = moveMoney(d, M0, fun, dining, 2000);
    const s = at(d, M0);
    expect(s.categories[dining]).toMatchObject({ available: 0, creditOverspent: 0 });
    expect(s.categories[pay].available).toBe(5000);
  });

  it('refunds on the card take money back out of the payment category', () => {
    let { d, dining, visa, pay } = setup();
    d = setAssigned(d, M0, dining, 5000);
    d = spend(d, visa, dining, -5000, 5);
    d = spend(d, visa, dining, 1500, 9);
    const s = at(d, M0);
    expect(s.categories[dining].available).toBe(1500);
    expect(s.categories[pay].available).toBe(3500);
    expect(accountBalances(d)[visa].working).toBe(-3500);
  });

  it('the payment category can then be funded to pay off the new debt', () => {
    let { d, dining, chk, visa, pay } = setup();
    d = spend(d, visa, dining, -4000); // all credit overspending
    d = setAssigned(d, M1, pay, 4000);
    d = saveTransaction(d, { accountId: chk, date: `${M1}-01`, payee: 'Visa payment', categoryId: null, memo: '', amount: -4000, cleared: 'cleared', transferAccountId: visa });
    expect(at(d, M1).categories[pay].available).toBe(0);
    expect(accountBalances(d)[visa].working).toBe(0);
  });
});
