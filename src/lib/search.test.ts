import { describe, expect, it } from 'vitest';
import { currentMonth } from './dates';
import { addAccount, addCategory, addGroup, emptyData, saveTransaction } from './ops';
import { EMPTY_FILTER, isFiltering, matches, totals } from './search';
import type { TxFilter } from './search';

const M = currentMonth();
function setup() {
  let d = addGroup(emptyData(), 'G');
  d = addCategory(d, d.groups[0].id, 'Food');
  d = addCategory(d, d.groups[0].id, 'Fun');
  d = addAccount(d, { name: 'Chk', type: 'checking', onBudget: true, balance: 0, date: `${M}-01` });
  const [food, fun] = d.categories.map((c) => c.id);
  const add = (payee: string, amount: number, day: number, categoryId: string | null, extra = {}) => {
    d = saveTransaction(d, { accountId: d.accounts[0].id, date: `${M}-${String(day).padStart(2, '0')}`, payee, categoryId, memo: '', amount, cleared: 'uncleared', ...extra });
  };
  add('Grocer', -5000, 3, food, { flag: 'blue' });
  add('Cinema', -1500, 10, fun, { cleared: 'cleared' });
  add('Paycheck', 200000, 15, 'rta');
  add('Mixed', -3000, 20, null, { splits: [{ categoryId: food, amount: -1000, memo: '' }, { categoryId: fun, amount: -2000, memo: 'snacks' }] });
  return { d, food, fun };
}
const run = (d: ReturnType<typeof setup>['d'], f: Partial<TxFilter>) =>
  d.transactions.filter((t) => t.payee !== 'Starting Balance' && matches(d, t, { ...EMPTY_FILTER, ...f }, () => '')).map((t) => t.payee);

describe('transaction filters', () => {
  it('category includes split parts', () => {
    const { d, food } = setup();
    expect(run(d, { categoryId: food })).toEqual(['Grocer', 'Mixed']);
  });
  it('flag, dates, amount size and cleared status', () => {
    const { d } = setup();
    expect(run(d, { flag: 'blue' })).toEqual(['Grocer']);
    expect(run(d, { flag: 'any' })).toEqual(['Grocer']);
    expect(run(d, { from: `${M}-05`, to: `${M}-16` })).toEqual(['Cinema', 'Paycheck']);
    expect(run(d, { min: 2000, max: 6000 })).toEqual(['Grocer', 'Mixed']);
    expect(run(d, { cleared: 'cleared' })).toEqual(['Cinema']);
    expect(run(d, { text: 'snack' })).toEqual(['Mixed']);
  });
  it('totals and whether anything is filtered', () => {
    const { d } = setup();
    const list = d.transactions.filter((t) => t.payee !== 'Starting Balance');
    expect(totals(list)).toEqual({ outflow: 9500, inflow: 200000, net: 190500, count: 4 });
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    expect(isFiltering({ ...EMPTY_FILTER, flag: 'red' })).toBe(true);
  });
});
