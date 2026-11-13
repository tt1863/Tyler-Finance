import { describe, expect, it } from 'vitest';
import { accountBalances, computeBudget } from './budget';
import { currentMonth } from './dates';
import { addAccount, addCategory, addGroup, emptyData, needsCategory, saveTransaction, setAssigned } from './ops';
import { dismissTransfer, findTransferPairs, linkAsTransfer } from './transfers';
import type { BudgetData } from './types';

const M = currentMonth();
const day = (n: number) => `${M}-${String(n).padStart(2, '0')}`;

function setup() {
  let d = addGroup(emptyData(), 'Everyday');
  d = addCategory(d, d.groups[0].id, 'Groceries');
  d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 200000, date: day(1) });
  d = addAccount(d, { name: 'Savings', type: 'savings', onBudget: true, balance: 0, date: day(1) });
  d = addAccount(d, { name: 'Visa', type: 'credit', onBudget: true, balance: 0, date: day(1) });
  d = addAccount(d, { name: 'Car Loan', type: 'loan', onBudget: false, balance: -1000000, date: day(1) });
  const id = (n: string) => d.accounts.find((a) => a.name === n)!.id;
  return { d, chk: id('Checking'), sav: id('Savings'), visa: id('Visa'), loan: id('Car Loan'), groceries: d.categories.find((c) => c.name === 'Groceries')!.id };
}

const add = (d: BudgetData, accountId: string, amount: number, date: string, payee: string, categoryId: string | null = null, extraId?: string) =>
  saveTransaction(d, { id: extraId, accountId, date, payee, categoryId, memo: '', amount, cleared: 'cleared' });

describe('finding transfers', () => {
  it('pairs opposite amounts in different accounts a few days apart', () => {
    let { d, chk, sav } = setup();
    d = add(d, chk, -50000, day(2), 'ONLINE TRANSFER TO SAV');
    d = add(d, sav, 50000, day(3), 'ONLINE TRANSFER FROM CHK');
    const pairs = findTransferPairs(d);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].from.accountId).toBe(chk);
    expect(pairs[0].to.accountId).toBe(sav);
  });

  it('ignores same account, different amounts, far-apart dates, and categorized pairs', () => {
    let { d, chk, sav, groceries } = setup();
    d = add(d, chk, -1000, day(2), 'A');
    d = add(d, chk, 1000, day(2), 'refund same account');
    d = add(d, chk, -2000, day(2), 'B');
    d = add(d, sav, 2100, day(2), 'different amount');
    d = add(d, chk, -3000, day(1), 'C');
    d = add(d, sav, 3000, day(9), 'too far');
    d = add(d, chk, -4000, day(2), 'Groceries', groceries);
    d = add(d, sav, 4000, day(2), 'Paycheck', 'rta');
    expect(findTransferPairs(d)).toEqual([]);
  });

  it('each transaction is used once, closest date wins', () => {
    let { d, chk, sav, visa } = setup();
    d = add(d, chk, -5000, day(5), 'out');
    d = add(d, sav, 5000, day(8), 'in later');
    d = add(d, visa, 5000, day(5), 'in same day');
    const pairs = findTransferPairs(d);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].to.accountId).toBe(visa);
  });

  it('dismissed pairs are not suggested again', () => {
    let { d, chk, sav } = setup();
    d = add(d, chk, -50000, day(2), 'x');
    d = add(d, sav, 50000, day(2), 'y');
    const [p] = findTransferPairs(d);
    d = dismissTransfer(d, p.from.id, p.to.id);
    expect(findTransferPairs(d)).toEqual([]);
  });
});

describe('linking a transfer', () => {
  it('becomes a normal transfer that does not touch the budget', () => {
    let { d, chk, sav } = setup();
    d = add(d, chk, -50000, day(2), 'ONLINE TRANSFER TO SAV');
    d = add(d, sav, 50000, day(3), 'ONLINE TRANSFER FROM CHK');
    const before = computeBudget(d, M).get(M)!.readyToAssign;
    const [p] = findTransferPairs(d);
    d = linkAsTransfer(d, p.from.id, p.to.id);
    const from = d.transactions.find((t) => t.id === p.from.id)!;
    expect(from).toMatchObject({ payee: 'Transfer : Savings', memo: 'ONLINE TRANSFER TO SAV', transferAccountId: sav, transferTxId: p.to.id, categoryId: null });
    expect(needsCategory(d)).toEqual([]);
    expect(computeBudget(d, M).get(M)!.readyToAssign).toBe(before);
    expect(findTransferPairs(d)).toEqual([]);
  });

  it('a credit card payment moves money out of the card payment category', () => {
    let { d, chk, visa, groceries } = setup();
    const pay = d.categories.find((c) => c.ccAccountId === visa)!.id;
    d = setAssigned(d, M, groceries, 10000);
    d = add(d, visa, -10000, day(2), 'Store', groceries);
    d = add(d, chk, -10000, day(5), 'VISA PAYMENT');
    d = add(d, visa, 10000, day(5), 'PAYMENT THANK YOU');
    const [p] = findTransferPairs(d);
    d = linkAsTransfer(d, p.from.id, p.to.id);
    const s = computeBudget(d, M).get(M)!;
    expect(s.categories[pay].available).toBe(0);
    expect(accountBalances(d)[visa].working).toBe(0);
  });

  it('a loan payment keeps its category on the budget side', () => {
    let { d, chk, loan, groceries } = setup();
    d = add(d, chk, -30000, day(4), 'AUTO LOAN PMT', groceries);
    d = add(d, loan, 30000, day(4), 'PAYMENT');
    const [p] = findTransferPairs(d);
    d = linkAsTransfer(d, p.from.id, p.to.id);
    expect(d.transactions.find((t) => t.id === p.from.id)!.categoryId).toBe(groceries);
    expect(d.transactions.find((t) => t.id === p.to.id)!.categoryId).toBeNull();
  });

  it('editing one side later keeps the other side\'s extra details', () => {
    let { d, chk, sav } = setup();
    d = add(d, chk, -50000, day(2), 'x');
    d = add(d, sav, 50000, day(2), 'y');
    const [p] = findTransferPairs(d);
    d = { ...d, transactions: d.transactions.map((t) => (t.id === p.to.id ? { ...t, cleared: 'reconciled' as const, bankId: 'plaid-in' } : t.id === p.from.id ? { ...t, bankId: 'plaid-out' } : t)) };
    d = linkAsTransfer(d, p.from.id, p.to.id);
    d = saveTransaction(d, { id: p.from.id, accountId: chk, date: day(2), payee: 'Transfer : Savings', categoryId: null, memo: 'monthly savings', amount: -50000, cleared: 'cleared', transferAccountId: sav });
    expect(d.transactions.find((t) => t.id === p.to.id)).toMatchObject({ cleared: 'reconciled', memo: 'monthly savings', amount: 50000, bankId: 'plaid-in' });
    expect(d.transactions.find((t) => t.id === p.from.id)).toMatchObject({ bankId: 'plaid-out' });
  });
});
