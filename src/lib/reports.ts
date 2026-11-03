import { categoryParts } from './budget';
import { monthOf } from './dates';
import type { BudgetData, Cents, DateStr, MonthKey } from './types';
import { READY_TO_ASSIGN } from './types';

/** One category's share of a transaction in a budget account. Positive = spent. */
export interface SpendingLine {
  txId: string;
  accountId: string;
  date: DateStr;
  month: MonthKey;
  payee: string;
  memo: string;
  categoryId: string;
  spent: Cents;
}

/**
 * Category spending in budget accounts (cash and credit). Income, transfers
 * and credit card payments aren't spending. Refunds count as negative spending.
 */
export function spendingLines(data: BudgetData): SpendingLine[] {
  const onBudget = new Set(data.accounts.filter((a) => a.onBudget).map((a) => a.id));
  const payment = new Set(data.categories.filter((c) => c.ccAccountId).map((c) => c.id));
  const out: SpendingLine[] = [];
  for (const t of data.transactions) {
    if (!onBudget.has(t.accountId)) continue;
    for (const part of categoryParts(t)) {
      if (!part.categoryId || part.categoryId === READY_TO_ASSIGN || payment.has(part.categoryId)) continue;
      out.push({
        txId: t.id,
        accountId: t.accountId,
        date: t.date,
        month: monthOf(t.date),
        payee: t.payee,
        memo: t.memo,
        categoryId: part.categoryId,
        spent: -part.amount,
      });
    }
  }
  return out;
}

/** What a report includes: everything, one category group, or one category. */
export type ReportScope = { kind: 'all' } | { kind: 'group'; id: string } | { kind: 'category'; id: string };

export function inScope(data: BudgetData, scope: ReportScope): (categoryId: string) => boolean {
  if (scope.kind === 'all') return () => true;
  if (scope.kind === 'category') return (id) => id === scope.id;
  const ids = new Set(data.categories.filter((c) => c.groupId === scope.id).map((c) => c.id));
  return (id) => ids.has(id);
}

/** Spending per month for the given months, plus the monthly average. */
export function spendingTrend(data: BudgetData, months: MonthKey[], scope: ReportScope) {
  const keep = inScope(data, scope);
  const wanted = new Set(months);
  const totals = new Map<MonthKey, Cents>(months.map((m) => [m, 0]));
  const lines: SpendingLine[] = [];
  for (const l of spendingLines(data)) {
    if (!wanted.has(l.month) || !keep(l.categoryId)) continue;
    totals.set(l.month, totals.get(l.month)! + l.spent);
    lines.push(l);
  }
  const values = months.map((m) => totals.get(m)!);
  const total = values.reduce((a, b) => a + b, 0);
  lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { values, total, average: months.length ? Math.round(total / months.length) : 0, lines };
}
