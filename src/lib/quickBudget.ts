import { assignedBetween, categoryMonth, computeBudget, targetStatus, type MonthSummary } from './budget';
import { addMonths } from './dates';
import { setAssigned } from './ops';
import type { BudgetData, Category, Cents, MonthKey } from './types';

export type QuickKey =
  | 'underfunded'
  | 'lastAssigned'
  | 'lastSpent'
  | 'avgAssigned'
  | 'avgSpent'
  | 'reduceOverfunding'
  | 'resetAvailable'
  | 'resetAssigned';

export const QUICK_OPTIONS: { key: QuickKey; label: string; help: string }[] = [
  { key: 'underfunded', label: 'Underfunded', help: 'Assign what targets need and cover overspending' },
  { key: 'lastAssigned', label: 'Assigned last month', help: 'Same as last month' },
  { key: 'lastSpent', label: 'Spent last month', help: 'What you spent last month' },
  { key: 'avgAssigned', label: 'Average assigned', help: 'Average of the last 3 months' },
  { key: 'avgSpent', label: 'Average spent', help: 'Average of the last 3 months' },
  { key: 'reduceOverfunding', label: 'Reduce overfunding', help: 'Assign only what the target needs' },
  { key: 'resetAvailable', label: 'Reset available to $0', help: 'Return extra money to Ready to Assign' },
  { key: 'resetAssigned', label: 'Reset assigned to $0', help: 'Clear this month' },
];

const spent = (s: MonthSummary | undefined, id: string) => Math.max(0, -categoryMonth(s, id).activity);

/**
 * What "assigned" would become for one category with a quick-budget option,
 * or null when the option doesn't apply (e.g. no target).
 */
export function quickAmount(
  key: QuickKey,
  category: Category,
  month: MonthKey,
  months: Map<MonthKey, MonthSummary>,
  data?: BudgetData,
): Cents | null {
  const prior = data ? (from: MonthKey) => assignedBetween(data, category.id, from, month) : undefined;
  const now = categoryMonth(months.get(month), category.id);
  const prev = [1, 2, 3].map((n) => months.get(addMonths(month, -n)));
  const avg = (f: (s: MonthSummary | undefined) => number) => Math.round(prev.reduce((t, s) => t + f(s), 0) / 3);
  switch (key) {
    case 'underfunded': {
      const fromTarget = category.target ? targetStatus(category.target, now, month, prior).underfunded : 0;
      const fromOverspend = now.available < 0 ? -now.available : 0;
      const add = Math.max(fromTarget, fromOverspend);
      return add > 0 ? now.assigned + add : null;
    }
    case 'lastAssigned':
      return categoryMonth(prev[0], category.id).assigned;
    case 'lastSpent':
      return spent(prev[0], category.id);
    case 'avgAssigned':
      return avg((s) => categoryMonth(s, category.id).assigned);
    case 'avgSpent':
      return avg((s) => spent(s, category.id));
    case 'reduceOverfunding': {
      if (!category.target) return null;
      const t = targetStatus(category.target, now, month, prior);
      // For "balance" targets, overfunded means more available than the goal.
      const extra = category.target.type === 'balance' ? Math.max(0, now.available - category.target.amount) : Math.max(0, now.assigned - t.needed);
      return extra > 0 ? now.assigned - Math.min(extra, Math.max(0, now.assigned)) : null;
    }
    case 'resetAvailable':
      return now.available > 0 ? now.assigned - now.available : null;
    case 'resetAssigned':
      return 0;
  }
}

/**
 * Categories a month-wide option applies to: visible ones, and credit card
 * payment categories only for "Underfunded" (resetting or averaging them could
 * take away money set aside for the card bill).
 */
const monthWide = (data: BudgetData, key: QuickKey) =>
  data.categories.filter((c) => !c.hidden && (!c.ccAccountId || key === 'underfunded'));

/** Apply a quick-budget option to one category, or to every visible category. */
export function applyQuickBudget(data: BudgetData, month: MonthKey, key: QuickKey, categoryId?: string): BudgetData {
  const months = computeBudget(data, month);
  const targets = categoryId ? data.categories.filter((c) => c.id === categoryId) : monthWide(data, key);
  let d = data;
  for (const c of targets) {
    const amount = quickAmount(key, c, month, months, data);
    if (amount === null) continue;
    if (amount !== categoryMonth(months.get(month), c.id).assigned) d = setAssigned(d, month, c.id, amount);
  }
  return d;
}

/** For the month-wide menu: how much assigning would change in total for each option. */
export function quickTotals(data: BudgetData, month: MonthKey): Record<QuickKey, { change: Cents; categories: number }> {
  const months = computeBudget(data, month);
  const out = {} as Record<QuickKey, { change: Cents; categories: number }>;
  for (const { key } of QUICK_OPTIONS) {
    let change = 0;
    let categories = 0;
    for (const c of monthWide(data, key)) {
      const amount = quickAmount(key, c, month, months, data);
      if (amount === null) continue;
      const diff = amount - categoryMonth(months.get(month), c.id).assigned;
      if (diff !== 0) {
        change += diff;
        categories++;
      }
    }
    out[key] = { change, categories };
  }
  return out;
}
