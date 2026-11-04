import { describe, expect, it } from 'vitest';
import { cashAccountIds, forecast } from './forecast';
import { addAccount, emptyData } from './ops';
import { saveScheduled } from './scheduled';
import { READY_TO_ASSIGN } from './types';

function setup() {
  let d = addAccount(emptyData(), { name: 'Checking', type: 'checking', onBudget: true, balance: 100000, date: '2026-11-01' });
  d = addAccount(d, { name: 'Savings', type: 'savings', onBudget: true, balance: 50000, date: '2026-11-01' });
  d = addAccount(d, { name: 'Visa', type: 'credit', onBudget: true, balance: 0, date: '2026-11-01' });
  const [checking, savings, visa] = d.accounts.map((a) => a.id);
  const sched = (accountId: string, payee: string, amount: number, startDate: string, frequency: 'monthly' | 'once' | 'weekly', transferAccountId?: string) =>
    (d = saveScheduled(d, { accountId, payee, categoryId: transferAccountId ? null : READY_TO_ASSIGN, memo: '', amount, frequency, startDate, transferAccountId }));
  sched(checking, 'Rent', -120000, '2026-11-10', 'monthly');
  sched(checking, 'Paycheck', 80000, '2026-11-15', 'monthly');
  sched(checking, 'Move to savings', -10000, '2026-11-20', 'monthly', savings);
  sched(visa, 'Streaming', -1500, '2026-11-12', 'monthly');
  return { d, checking, savings, visa };
}

describe('cash-flow forecast', () => {
  it('projects one account and finds when it runs short', () => {
    const { d, checking } = setup();
    const f = forecast(d, '2026-11-04', 30, [checking]);
    expect(f.start).toBe(100000);
    const on = (date: string) => f.days.find((x) => x.date === date)!.balance;
    expect(on('2026-11-09')).toBe(100000);
    expect(on('2026-11-10')).toBe(-20000);
    expect(on('2026-11-15')).toBe(60000);
    expect(on('2026-11-20')).toBe(50000);
    expect(f.lowest.date).toBe('2026-11-10');
    expect(f.short!.day.date).toBe('2026-11-10');
    expect(f.short!.cause!.scheduled.payee).toBe('Rent');
    // With a $500 cushion it's short on the same day; with -$300 allowed it isn't.
    expect(forecast(d, '2026-11-04', 30, [checking], 50000).short!.day.date).toBe('2026-11-10');
    expect(forecast(d, '2026-11-04', 30, [checking], -30000).short).toBeNull();
  });

  it('all cash: transfers between cash accounts net out, cards are left out', () => {
    const { d } = setup();
    const ids = cashAccountIds(d);
    expect(ids).toHaveLength(2);
    const f = forecast(d, '2026-11-04', 30, ids);
    expect(f.start).toBe(150000);
    expect(f.days.find((x) => x.date === '2026-11-20')!.items).toHaveLength(0);
    expect(f.days.at(-1)!.balance).toBe(150000 - 120000 + 80000);
  });

  it('money in before money out on the same day', () => {
    let { d, checking } = setup();
    d = saveScheduled(d, { accountId: checking, payee: 'Bonus', categoryId: READY_TO_ASSIGN, memo: '', amount: 30000, frequency: 'once', startDate: '2026-11-10' });
    const f = forecast(d, '2026-11-04', 10, [checking]);
    expect(f.days.at(-1)!.balance).toBe(10000);
    expect(f.short).toBeNull();
  });
});
