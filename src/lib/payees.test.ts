import { describe, expect, it } from 'vitest';
import { currentMonth } from './dates';
import { addAccount, addCategory, addGroup, emptyData, saveTransaction } from './ops';
import { forgetPayee, listPayees, renamePayee, setPayeeCategory } from './payees';
import { saveScheduled } from './scheduled';

const M = currentMonth();
function setup() {
  let d = addGroup(emptyData(), 'G');
  d = addCategory(d, d.groups[0].id, 'Shopping');
  d = addCategory(d, d.groups[0].id, 'Books');
  d = addAccount(d, { name: 'Chk', type: 'checking', onBudget: true, balance: 0, date: `${M}-01` });
  d = addAccount(d, { name: 'Sav', type: 'savings', onBudget: true, balance: 0, date: `${M}-01` });
  const [shopping, books] = d.categories.map((c) => c.id);
  const [chk, sav] = d.accounts.map((a) => a.id);
  const add = (payee: string, day: number, categoryId: string | null, extra = {}) => {
    d = saveTransaction(d, { accountId: chk, date: `${M}-${String(day).padStart(2, '0')}`, payee, categoryId, memo: '', amount: -1000, cleared: 'cleared', ...extra });
  };
  add('Amazon', 3, shopping);
  add('AMZN Mktp', 5, books);
  add('AMZN Mktp', 9, books);
  add('Move', 4, null, { transferAccountId: sav });
  d = saveScheduled(d, { accountId: chk, payee: 'AMZN Mktp', categoryId: books, memo: '', amount: -1500, frequency: 'monthly', startDate: `${M}-28` });
  return { d, shopping, books };
}

describe('payees', () => {
  it('lists payees with counts, last use and remembered category (no transfers)', () => {
    const { d, books } = setup();
    expect(listPayees(d).map((p) => [p.name, p.count, p.lastUsed, p.scheduled])).toEqual([
      ['Amazon', 1, `${M}-03`, 0],
      ['AMZN Mktp', 2, `${M}-09`, 1],
    ]);
    expect(listPayees(d).find((p) => p.name === 'AMZN Mktp')!.categoryId).toBe(books);
  });

  it('renaming onto an existing payee merges them (the existing category wins)', () => {
    let { d, shopping } = setup();
    d = renamePayee(d, 'AMZN Mktp', 'amazon');
    expect(listPayees(d).map((p) => [p.name, p.count, p.scheduled])).toEqual([['Amazon', 3, 1]]);
    expect(d.payeeCategory).toEqual({ Amazon: shopping });
  });

  it('a plain rename carries the remembered category', () => {
    let { d, books } = setup();
    d = renamePayee(d, 'AMZN Mktp', 'Amazon Books');
    expect(d.payeeCategory['Amazon Books']).toBe(books);
    expect(d.payeeCategory['AMZN Mktp']).toBeUndefined();
  });

  it('sets, clears and forgets', () => {
    let { d } = setup();
    d = setPayeeCategory(d, 'Amazon', null);
    expect(d.payeeCategory.Amazon).toBeUndefined();
    d = setPayeeCategory(d, 'Old Shop', 'x');
    d = forgetPayee(d, 'Old Shop');
    expect(listPayees(d).some((p) => p.name === 'Old Shop')).toBe(false);
    expect(forgetPayee(d, 'Amazon')).toBe(d);
  });
});
