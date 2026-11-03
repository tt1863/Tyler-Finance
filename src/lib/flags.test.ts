import { describe, expect, it } from 'vitest';
import { currentMonth } from './dates';
import { flagLabel, flagMatches, setFlag, setFlagName } from './flags';
import { addAccount, emptyData, saveTransaction } from './ops';
import { fromRecords, toRecords } from './sync/records';

const M = currentMonth();
function setup() {
  let d = addAccount(emptyData(), { name: 'Chk', type: 'checking', onBudget: true, balance: 10000, date: `${M}-01` });
  d = saveTransaction(d, { accountId: d.accounts[0].id, date: `${M}-02`, payee: 'Pharmacy', categoryId: null, memo: '', amount: -2500, cleared: 'cleared', flag: 'blue' });
  return d;
}

describe('flags', () => {
  it('are saved with a transaction and kept when edited', () => {
    let d = setup();
    const t = d.transactions.find((x) => x.payee === 'Pharmacy')!;
    expect(t.flag).toBe('blue');
    d = saveTransaction(d, { id: t.id, accountId: t.accountId, date: t.date, payee: 'Pharmacy', categoryId: null, memo: 'Rx', amount: -2500, cleared: 'cleared', flag: 'blue' });
    expect(d.transactions.find((x) => x.id === t.id)!.flag).toBe('blue');
  });

  it('can be set and cleared on many transactions', () => {
    let d = setup();
    const ids = d.transactions.map((t) => t.id);
    d = setFlag(d, ids, 'red');
    expect(d.transactions.every((t) => t.flag === 'red')).toBe(true);
    d = setFlag(d, ids, null);
    expect(d.transactions.some((t) => 'flag' in t)).toBe(false);
  });

  it('names are searchable and sync between devices', () => {
    let d = setFlagName(setup(), 'blue', 'Reimbursable');
    expect(flagLabel(d, 'blue')).toBe('Reimbursable');
    expect(flagLabel(d, 'red')).toBe('Red');
    expect(flagMatches(d, 'blue', 'reimb')).toBe(true);
    expect(flagMatches(d, 'blue', 'blue')).toBe(true);
    expect(flagMatches(d, undefined, 'blue')).toBe(false);
    const back = fromRecords(toRecords(d));
    expect(back.flagNames).toEqual({ blue: 'Reimbursable' });
    expect(back.transactions.find((t) => t.payee === 'Pharmacy')!.flag).toBe('blue');
    expect(setFlagName(d, 'blue', ' ').flagNames).toEqual({});
  });
});
