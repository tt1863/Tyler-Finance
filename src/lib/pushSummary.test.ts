import { describe, expect, it } from 'vitest';
import { addAccount, addCategory, addGroup, emptyData, saveTransaction, setAssigned } from './ops';
import { buildSummary } from './pushSummary';
import { saveScheduled } from './scheduled';

describe('push summary', () => {
  it('lists bills, overspending, items to categorize and weekly spending', () => {
    let d = addGroup(emptyData(), 'Fun');
    d = addCategory(d, d.groups[0].id, 'Dining');
    d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 100000, date: '2026-11-01' });
    const dining = d.categories[0].id;
    const checking = d.accounts[0].id;
    d = setAssigned(d, '2026-11', dining, 5000);
    d = saveTransaction(d, { accountId: checking, date: '2026-11-03', payee: 'Cafe', categoryId: dining, memo: '', amount: -7500, cleared: 'cleared' });
    d = saveTransaction(d, { accountId: checking, date: '2026-11-02', payee: 'Mystery', categoryId: null, memo: '', amount: -1000, cleared: 'cleared' });
    d = saveScheduled(d, { accountId: checking, payee: 'Rent', categoryId: null, memo: '', amount: -90000, frequency: 'monthly', startDate: '2026-11-10' });
    const s = buildSummary(d, '2026-11-04');
    expect(s.bills).toEqual([{ date: '2026-11-10', payee: 'Rent', amount: -90000 }]);
    expect(s.overspent).toEqual([{ key: `2026-11:${dining}`, name: 'Dining', amount: -2500 }]);
    expect(s.needsCategory).toBe(1);
    expect(s.weekSpent).toBe(7500);
    expect(s.readyToAssign).toBe(95000);
    expect(s.currency).toBe(d.currency);
  });
});
