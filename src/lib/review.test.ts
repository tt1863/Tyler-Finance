import { describe, expect, it } from 'vitest';
import { currentMonth } from './dates';
import { addAccount, addCategory, addGroup, emptyData, importTransactions, saveTransaction } from './ops';
import { approveTransactions, deleteRule, isUnapproved, saveRule } from './review';
import { fromRecords, toRecords } from './sync/records';
import { findTransferPairs, linkAsTransfer } from './transfers';

const M = currentMonth();
function setup() {
  let d = addGroup(emptyData(), 'Everyday');
  d = addCategory(d, d.groups[0].id, 'Coffee');
  d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 100000, date: `${M}-01` });
  d = addAccount(d, { name: 'Savings', type: 'savings', onBudget: true, balance: 0, date: `${M}-01` });
  return { d, chk: d.accounts[0].id, sav: d.accounts[1].id, coffee: d.categories[0].id };
}
const rows = [
  { date: `${M}-03`, payee: 'SQ *BLUE BOTTLE 0423', memo: '', amount: -550 },
  { date: `${M}-04`, payee: 'CORNER STORE', memo: '', amount: -1200 },
];

describe('reviewing imports', () => {
  it('CSV imports apply rules and wait for review; re-importing finds duplicates by bank wording', () => {
    let { d, chk, coffee } = setup();
    d = saveRule(d, { match: 'blue bottle', matchType: 'contains', rename: 'Blue Bottle', categoryId: coffee }).data;
    d = importTransactions(d, chk, rows).data;
    const bb = d.transactions.find((t) => t.bankPayee === 'SQ *BLUE BOTTLE 0423')!;
    expect(bb).toMatchObject({ payee: 'Blue Bottle', categoryId: coffee, approved: false });
    expect(d.transactions.filter(isUnapproved)).toHaveLength(2);
    expect(importTransactions(d, chk, rows).skipped).toBe(2);
  });

  it('approving, or saving an edit, marks transactions reviewed', () => {
    let { d, chk } = setup();
    d = importTransactions(d, chk, rows).data;
    const [a, b] = d.transactions.filter(isUnapproved);
    d = approveTransactions(d, [a.id]);
    expect(d.transactions.find((t) => t.id === a.id)!.approved).toBeUndefined();
    d = saveTransaction(d, { id: b.id, accountId: chk, date: b.date, payee: 'Corner Store', categoryId: null, memo: '', amount: b.amount, cleared: 'cleared' });
    expect(d.transactions.filter(isUnapproved)).toHaveLength(0);
    expect(d.transactions.find((t) => t.id === b.id)!.bankPayee).toBe('CORNER STORE');
  });

  it('a new rule fixes matching transactions that still need attention, not reviewed ones', () => {
    let { d, chk, coffee } = setup();
    d = importTransactions(d, chk, rows).data;
    d = saveTransaction(d, { accountId: chk, date: `${M}-02`, payee: 'Blue Bottle beans', categoryId: 'other', memo: '', amount: -2000, cleared: 'cleared' });
    const r = saveRule(d, { match: 'BLUE BOTTLE', matchType: 'contains', rename: 'Blue Bottle', categoryId: coffee });
    expect(r.applied).toBe(1);
    expect(r.data.transactions.find((t) => t.payee === 'Blue Bottle beans')!.categoryId).toBe('other');
  });

  it('linking a transfer counts as reviewing both sides', () => {
    let { d, chk, sav } = setup();
    d = importTransactions(d, chk, [{ date: `${M}-05`, payee: 'XFER TO SAV', memo: '', amount: -5000 }]).data;
    d = importTransactions(d, sav, [{ date: `${M}-05`, payee: 'XFER FROM CHK', memo: '', amount: 5000 }]).data;
    const [p] = findTransferPairs(d);
    d = linkAsTransfer(d, p.from.id, p.to.id);
    expect(d.transactions.filter(isUnapproved)).toHaveLength(0);
  });

  it('rules sync between devices and can be deleted', () => {
    let { d, coffee } = setup();
    d = saveRule(d, { match: 'a', matchType: 'contains', rename: 'A' }).data;
    d = saveRule(d, { match: 'b', matchType: 'exact', categoryId: coffee }).data;
    expect(fromRecords(toRecords(d)).payeeRules).toEqual(d.payeeRules);
    d = deleteRule(d, d.payeeRules[0].id);
    expect(d.payeeRules.map((r) => r.match)).toEqual(['b']);
  });
});
