import { describe, expect, it } from 'vitest';
import { accountBalances } from './budget';
import { addAccount, addCategory, addGroup, deleteAccount, emptyData, normalize } from './ops';
import { enterNow, nextDate, occurrence, processDue, saveScheduled, skipNext, upcoming } from './scheduled';
import type { BudgetData } from './types';

function setup() {
  let d = addGroup(emptyData(), 'Bills');
  d = addCategory(d, d.groups[0].id, 'Rent');
  d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 500000, date: '2026-01-01' });
  d = addAccount(d, { name: 'Savings', type: 'savings', onBudget: true, balance: 0, date: '2026-01-01' });
  return { d, rent: d.categories[0].id, checking: d.accounts[0].id, savings: d.accounts[1].id };
}

const rentSchedule = (d: BudgetData, checking: string, rent: string, extra = {}) =>
  saveScheduled(d, {
    accountId: checking,
    payee: 'Landlord',
    categoryId: rent,
    memo: '',
    amount: -150000,
    frequency: 'monthly',
    startDate: '2026-01-31',
    ...extra,
  });

describe('occurrence dates', () => {
  it('monthly clamps to month end without drifting', () => {
    expect([0, 1, 2, 3].map((n) => occurrence('2026-01-31', 'monthly', n))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });
  it('weekly, biweekly and yearly', () => {
    expect(occurrence('2026-12-25', 'weekly', 1)).toBe('2027-01-01');
    expect(occurrence('2026-01-02', 'biweekly', 2)).toBe('2026-01-30');
    expect(occurrence('2028-02-29', 'yearly', 1)).toBe('2029-02-28');
  });
});

describe('scheduled transactions', () => {
  it('enters everything due and nothing in the future', () => {
    let { d, checking, rent } = setup();
    d = rentSchedule(d, checking, rent);
    const r = processDue(d, '2026-03-15');
    expect(r.entered).toBe(2);
    expect(r.data.transactions.filter((t) => t.payee === 'Landlord').map((t) => t.date)).toEqual(['2026-01-31', '2026-02-28']);
    expect(nextDate(r.data.scheduled[0])).toBe('2026-03-31');
    // Running again the same day enters nothing new.
    expect(processDue(r.data, '2026-03-15').entered).toBe(0);
  });

  it('one-time schedules disappear after being entered', () => {
    let { d, checking, rent } = setup();
    d = rentSchedule(d, checking, rent, { frequency: 'once', startDate: '2026-02-01' });
    const r = processDue(d, '2026-02-01');
    expect(r.entered).toBe(1);
    expect(r.data.scheduled).toHaveLength(0);
  });

  it('stops at the end date', () => {
    let { d, checking, rent } = setup();
    d = rentSchedule(d, checking, rent, { startDate: '2026-01-01', endDate: '2026-03-01' });
    const r = processDue(d, '2026-12-31');
    expect(r.entered).toBe(3);
    expect(r.data.scheduled).toHaveLength(0);
  });

  it('scheduled transfers create both sides', () => {
    let { d, checking, savings } = setup();
    d = saveScheduled(d, {
      accountId: checking,
      payee: 'Transfer : Savings',
      categoryId: null,
      memo: '',
      amount: -20000,
      frequency: 'biweekly',
      startDate: '2026-01-02',
      transferAccountId: savings,
    });
    const r = processDue(d, '2026-01-20');
    expect(accountBalances(r.data)[savings].working).toBe(40000);
  });

  it('skip and enter now advance the schedule', () => {
    let { d, checking, rent } = setup();
    d = rentSchedule(d, checking, rent);
    d = skipNext(d, d.scheduled[0].id);
    expect(nextDate(d.scheduled[0])).toBe('2026-02-28');
    d = enterNow(d, d.scheduled[0].id, '2026-02-20');
    expect(d.transactions.find((t) => t.payee === 'Landlord')?.date).toBe('2026-02-20');
    expect(nextDate(d.scheduled[0])).toBe('2026-03-31');
  });

  it('lists upcoming occurrences in a date range', () => {
    let { d, checking, rent } = setup();
    d = rentSchedule(d, checking, rent);
    expect(upcoming(d, '2026-01-01', '2026-04-30').map((u) => u.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('deleting an account removes its schedules; old saves get an empty list', () => {
    let { d, checking, rent } = setup();
    d = rentSchedule(d, checking, rent);
    expect(deleteAccount(d, checking).scheduled).toHaveLength(0);
    const old = { ...d } as Partial<BudgetData>;
    delete old.scheduled;
    expect(normalize(old as BudgetData).scheduled).toEqual([]);
  });
});
