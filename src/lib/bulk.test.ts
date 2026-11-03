import { describe, expect, it } from 'vitest';
import { bulkMove, bulkSetCategory, bulkSetCleared, totalOf } from './bulk';
import { currentMonth } from './dates';
import { addAccount, addCategory, addGroup, emptyData, saveTransaction } from './ops';

const M = currentMonth();
function setup() {
  let d = addGroup(emptyData(), 'G');
  d = addCategory(d, d.groups[0].id, 'Food');
  d = addAccount(d, { name: 'Chk', type: 'checking', onBudget: true, balance: 100000, date: `${M}-01` });
  d = addAccount(d, { name: 'Sav', type: 'savings', onBudget: true, balance: 0, date: `${M}-01` });
  d = addAccount(d, { name: 'Loan', type: 'loan', onBudget: false, balance: -50000, date: `${M}-01` });
  const [chk, sav, loan] = d.accounts.map((a) => a.id);
  const tx = (payee: string, amount: number, extra = {}) => {
    d = saveTransaction(d, { accountId: chk, date: `${M}-05`, payee, categoryId: null, memo: '', amount, cleared: 'uncleared', ...extra });
  };
  tx('A', -1000);
  tx('B', -2000);
  tx('Split', -3000, { splits: [{ categoryId: null, amount: -1000, memo: '' }, { categoryId: null, amount: -2000, memo: '' }] });
  tx('To savings', -5000, { transferAccountId: sav });
  tx('Loan payment', -4000, { transferAccountId: loan });
  const id = (p: string) => d.transactions.find((t) => t.payee === p || t.payee.startsWith(p))!.id;
  return { d, chk, sav, food: d.categories[0].id, id };
}

describe('bulk edit', () => {
  it('sets a category, skipping splits and budget-to-budget transfers', () => {
    const { d, food, id } = setup();
    const ids = [id('A'), id('B'), id('Split'), id('Transfer : Sav'), id('Transfer : Loan')];
    const r = bulkSetCategory(d, ids, food);
    expect(r.changed).toBe(3); // A, B and the loan payment (budget side of a budget→tracking transfer)
    expect(r.skipped).toBe(2);
    expect(r.data.transactions.find((t) => t.payee === 'A')!.categoryId).toBe(food);
  });

  it('marks cleared but leaves reconciled alone', () => {
    let { d, id } = setup();
    d = { ...d, transactions: d.transactions.map((t) => (t.payee === 'B' ? { ...t, cleared: 'reconciled' as const } : t)) };
    const r = bulkSetCleared(d, [id('A'), id('B')], 'cleared');
    expect(r).toMatchObject({ changed: 1, skipped: 1 });
  });

  it('moves to another account, skipping transfers', () => {
    const { d, sav, id } = setup();
    const r = bulkMove(d, [id('A'), id('Transfer : Sav')], sav);
    expect(r).toMatchObject({ changed: 1, skipped: 1 });
    expect(r.data.transactions.find((t) => t.payee === 'A')!.accountId).toBe(sav);
  });

  it('totals the selection', () => {
    const { d, id } = setup();
    expect(totalOf(d, new Set([id('A'), id('B')]))).toBe(-3000);
  });
});
