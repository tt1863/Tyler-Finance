import { describe, expect, it } from 'vitest';
import { addAccount, addCategory, addGroup, emptyData, saveTransaction } from './ops';
import { toCsv } from './download';
import { linesTable, spendingBreakdown, spendingTrend } from './reports';
import { READY_TO_ASSIGN } from './types';

function setup() {
  let d = addGroup(emptyData(), 'Bills');
  d = addGroup(d, 'Fun');
  const [bills, fun] = d.groups.filter((g) => !g.system).map((g) => g.id);
  d = addCategory(d, bills, 'Rent');
  d = addCategory(d, fun, 'Games');
  d = addAccount(d, { name: 'Checking', type: 'checking', onBudget: true, balance: 500000, date: '2026-08-01' });
  d = addAccount(d, { name: 'Visa', type: 'credit', onBudget: true, balance: 0, date: '2026-08-01' });
  const rent = d.categories.find((c) => c.name === 'Rent')!.id;
  const games = d.categories.find((c) => c.name === 'Games')!.id;
  const checking = d.accounts.find((a) => a.name === 'Checking')!.id;
  const visa = d.accounts.find((a) => a.name === 'Visa')!.id;
  const tx = (accountId: string, date: string, categoryId: string | null, amount: number, transferAccountId?: string) =>
    (d = saveTransaction(d, { accountId, date, payee: 'P', categoryId, memo: '', amount, cleared: 'cleared', transferAccountId }));
  tx(checking, '2026-09-01', rent, -100000);
  tx(checking, '2026-10-01', rent, -100000);
  tx(visa, '2026-10-05', games, -6000);
  tx(visa, '2026-10-06', games, 1000); // refund
  tx(checking, '2026-10-15', READY_TO_ASSIGN, 300000); // income
  tx(checking, '2026-10-20', null, -5000, visa); // card payment
  return { d, bills, fun, rent, games };
}

describe('spending trend', () => {
  it('sums spending per month across cash and credit, ignoring income and payments', () => {
    const { d } = setup();
    const t = spendingTrend(d, ['2026-08', '2026-09', '2026-10'], { kind: 'all' });
    expect(t.values).toEqual([0, 100000, 105000]);
    expect(t.total).toBe(205000);
    expect(t.average).toBe(68333);
    expect(t.lines.map((l) => l.date)).toEqual(['2026-10-06', '2026-10-05', '2026-10-01', '2026-09-01']);
  });

  it('filters to a group or a category', () => {
    const { d, fun, rent } = setup();
    expect(spendingTrend(d, ['2026-09', '2026-10'], { kind: 'group', id: fun }).values).toEqual([0, 5000]);
    expect(spendingTrend(d, ['2026-09', '2026-10'], { kind: 'category', id: rent }).values).toEqual([100000, 100000]);
  });
});

describe('spending breakdown and export', () => {
  it('groups spending with the transactions behind each number', () => {
    const { d } = setup();
    const rows = spendingBreakdown(d, ['2026-10'], false);
    expect(rows.map((r) => [r.name, r.value, r.lines.length])).toEqual([
      ['Rent', 100000, 1],
      ['Games', 5000, 2],
    ]);
    const groups = spendingBreakdown(d, ['2026-09', '2026-10'], true);
    expect(groups.map((r) => [r.name, r.value])).toEqual([
      ['Bills', 200000],
      ['Fun', 5000],
    ]);
  });

  it('exports transactions as CSV', () => {
    const { d } = setup();
    const lines = spendingBreakdown(d, ['2026-10'], false).find((r) => r.name === 'Games')!.lines;
    expect(toCsv(linesTable(d, lines))).toBe(
      'Date,Account,Payee,Category Group,Category,Memo,Spent\n' +
        '2026-10-06,Visa,P,Fun,Games,,-10.00\n' +
        '2026-10-05,Visa,P,Fun,Games,,60.00\n',
    );
    expect(toCsv([['a, b', 'say "hi"']])).toBe('"a, b","say ""hi"""\n');
  });
});
