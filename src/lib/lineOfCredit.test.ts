import { describe, expect, it } from 'vitest';
import { computeBudget } from './budget';
import { addAccount, addCategory, addGroup, emptyData, saveTransaction, setAssigned } from './ops';

describe('line of credit', () => {
  it('budgets like a credit card, with its own payment category', () => {
    let d = addGroup(emptyData(), 'Home');
    d = addCategory(d, d.groups[0].id, 'Repairs');
    d = addAccount(d, { name: 'HELOC', type: 'credit', onBudget: true, balance: -100000, date: '2026-10-01', creditLine: true });
    const loc = d.accounts[0];
    expect(loc.creditLine).toBe(true);
    const pay = d.categories.find((c) => c.ccAccountId === loc.id)!;
    expect(pay.name).toBe('HELOC');
    const repairs = d.categories.find((c) => c.name === 'Repairs')!.id;
    d = setAssigned(d, '2026-10', repairs, 20000);
    d = saveTransaction(d, { accountId: loc.id, date: '2026-10-05', payee: 'Hardware', categoryId: repairs, memo: '', amount: -20000, cleared: 'cleared' });
    const s = computeBudget(d, '2026-10').get('2026-10')!;
    expect(s.categories[pay.id].available).toBe(20000);
    // Starting debt doesn't touch Ready to Assign.
    expect(s.readyToAssign).toBe(-20000);
  });

  it('is only set on credit accounts', () => {
    const d = addAccount(emptyData(), { name: 'X', type: 'checking', onBudget: true, balance: 0, creditLine: true });
    expect(d.accounts[0].creditLine).toBeUndefined();
  });
});
