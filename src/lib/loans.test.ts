import { describe, expect, it } from 'vitest';
import { accountBalances, computeBudget } from './budget';
import { addLoan, postLoanInterest, updateLoan } from './loans';
import { addAccount, deleteAccount, emptyData, saveTransaction, setAssigned, updateAccount } from './ops';

function setup() {
  let d = addAccount(emptyData(), { name: 'Checking', type: 'checking', onBudget: true, balance: 500000, date: '2026-08-01' });
  d = addLoan(d, { name: 'Car', kind: 'auto', owed: 1200000, date: '2026-08-15', apr: 6, payment: 30000 });
  const checking = d.accounts[0].id;
  const loan = d.accounts.find((a) => a.name === 'Car')!;
  const cat = d.categories.find((c) => c.loanAccountId === loan.id)!;
  return { d, checking, loan, cat };
}

describe('loan accounts', () => {
  it('creates a tracking account and a paired payment category', () => {
    const { d, loan, cat } = setup();
    expect(loan).toMatchObject({ type: 'loan', onBudget: false, debt: { apr: 6, minPayment: 30000 }, loan: { kind: 'auto', interestThrough: '2026-08' } });
    expect(accountBalances(d)[loan.id].working).toBe(-1200000);
    expect(cat.name).toBe('Car Payment');
    expect(cat.target).toEqual({ type: 'monthly', amount: 30000 });
    expect(d.groups.find((g) => g.id === cat.groupId)!.name).toBe('Loan Payments');
    // Mortgage escrow is part of the target.
    const m = addLoan(d, { name: 'House', kind: 'mortgage', owed: 100, date: '2026-08-01', apr: 5, payment: 150000, escrow: 40000 });
    expect(m.categories.find((c) => c.name === 'House Payment')!.target!.amount).toBe(190000);
    expect(m.groups.filter((g) => g.name === 'Loan Payments')).toHaveLength(1);
  });

  it('paying from checking is a transfer that draws down the payment category', () => {
    let { d, checking, loan, cat } = setup();
    d = setAssigned(d, '2026-09', cat.id, 30000);
    d = saveTransaction(d, { accountId: checking, date: '2026-09-05', payee: '', categoryId: cat.id, memo: '', amount: -30000, cleared: 'cleared', transferAccountId: loan.id });
    const s = computeBudget(d, '2026-09').get('2026-09')!;
    expect(s.categories[cat.id].available).toBe(0);
    expect(accountBalances(d)[loan.id].working).toBe(-1170000);
  });

  it('records interest at the end of each finished month, once', () => {
    let { d, loan } = setup();
    expect(postLoanInterest(d, '2026-09-20').data).toBe(d); // August's interest isn't charged (opened mid-month)
    const r = postLoanInterest(d, '2026-11-03');
    expect(r.posted).toBe(2);
    const interest = r.data.transactions.filter((t) => t.payee === 'Interest');
    // 12,000 × 6% / 12 = 60.00, then on 12,060.00 = 60.30
    expect(interest.map((t) => [t.date, t.amount])).toEqual([
      ['2026-09-30', -6000],
      ['2026-10-31', -6030],
    ]);
    expect(r.data.accounts.find((a) => a.id === loan.id)!.loan!.interestThrough).toBe('2026-10');
    expect(postLoanInterest(r.data, '2026-11-30').posted).toBe(0);
  });

  it('editing keeps the target in step; rename and delete', () => {
    let { d, loan, cat } = setup();
    d = updateLoan(d, loan.id, { apr: 4, payment: 25000, kind: 'auto' });
    expect(d.categories.find((c) => c.id === cat.id)!.target!.amount).toBe(25000);
    d = updateAccount(d, loan.id, { name: 'Truck' });
    expect(d.categories.find((c) => c.id === cat.id)!.name).toBe('Truck Payment');
    d = deleteAccount(d, loan.id);
    expect(d.categories.find((c) => c.id === cat.id)!.loanAccountId).toBeUndefined();
  });
});
