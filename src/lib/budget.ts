import { currentMonth, monthDiff, monthOf, monthRange } from './dates';
import type { BudgetData, Category, Cents, MonthKey, Target } from './types';
import { READY_TO_ASSIGN } from './types';

export interface CategoryMonth {
  /** Positive balance rolled over from last month. */
  carryIn: Cents;
  assigned: Cents;
  activity: Cents;
  available: Cents;
}

export interface MonthSummary {
  month: MonthKey;
  categories: Record<string, CategoryMonth>;
  /** Income (Ready to Assign inflows) dated this month. */
  income: Cents;
  assigned: Cents;
  activity: Cents;
  available: Cents;
  /** Overspending from last month, taken out of Ready to Assign this month. */
  overspentLastMonth: Cents;
  /** Amount assigned in months after this one. */
  assignedInFuture: Cents;
  readyToAssign: Cents;
}

const EMPTY: CategoryMonth = { carryIn: 0, assigned: 0, activity: 0, available: 0 };

/**
 * Category activity per month. Credit card handling mirrors YNAB: spending on a
 * card with a category moves that money into the card's payment category, and
 * payments to the card take it back out.
 */
export function computeActivity(data: BudgetData) {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const paymentCategory = new Map<string, string>();
  for (const c of data.categories) if (c.ccAccountId) paymentCategory.set(c.ccAccountId, c.id);

  const activity: Record<MonthKey, Record<string, Cents>> = {};
  const income: Record<MonthKey, Cents> = {};
  const add = (m: MonthKey, cat: string, amt: Cents) => {
    const row = (activity[m] ??= {});
    row[cat] = (row[cat] ?? 0) + amt;
  };

  for (const t of data.transactions) {
    const account = accounts.get(t.accountId);
    if (!account?.onBudget) continue;
    const m = monthOf(t.date);
    if (t.categoryId === READY_TO_ASSIGN) income[m] = (income[m] ?? 0) + t.amount;
    else if (t.categoryId) add(m, t.categoryId, t.amount);

    const payCat = account.type === 'credit' ? paymentCategory.get(account.id) : undefined;
    if (payCat) {
      const otherOnBudget = t.transferAccountId
        ? accounts.get(t.transferAccountId)?.onBudget === true
        : false;
      // Uncategorized, non-transfer entries (like starting debt) don't move money.
      if (t.categoryId !== null || otherOnBudget) add(m, payCat, -t.amount);
    }
  }
  return { activity, income };
}

/** Compute every month from the first month with data through `through` (at least). */
export function computeBudget(data: BudgetData, through: MonthKey): Map<MonthKey, MonthSummary> {
  const { activity, income } = computeActivity(data);
  const months = new Set<MonthKey>([through, ...Object.keys(activity), ...Object.keys(income)]);
  for (const [m, row] of Object.entries(data.assigned)) {
    if (Object.values(row).some((v) => v !== 0)) months.add(m);
  }
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1] > through ? sorted[sorted.length - 1] : through;

  const now = currentMonth();
  const assignedTotalByMonth: Record<MonthKey, Cents> = {};
  let assignedAll = 0;
  for (const [m, row] of Object.entries(data.assigned)) {
    const sum = Object.values(row).reduce((a, b) => a + b, 0);
    assignedTotalByMonth[m] = sum;
    assignedAll += sum;
  }

  const catIds = new Set(data.categories.map((c) => c.id));
  for (const row of Object.values(activity)) for (const id of Object.keys(row)) catIds.add(id);
  for (const row of Object.values(data.assigned)) for (const id of Object.keys(row)) catIds.add(id);

  const result = new Map<MonthKey, MonthSummary>();
  let prev: Record<string, CategoryMonth> = {};
  let cumIncome = 0;
  let cumAssigned = 0;
  let cumOverspent = 0;
  let overspentLast = 0;

  for (const m of monthRange(first, last)) {
    const cats: Record<string, CategoryMonth> = {};
    let totalAssigned = 0;
    let totalActivity = 0;
    let totalAvailable = 0;
    let overspent = 0;
    for (const id of catIds) {
      const carryIn = Math.max(0, prev[id]?.available ?? 0);
      const assigned = data.assigned[m]?.[id] ?? 0;
      const act = activity[m]?.[id] ?? 0;
      const available = carryIn + assigned + act;
      cats[id] = { carryIn, assigned, activity: act, available };
      totalAssigned += assigned;
      totalActivity += act;
      totalAvailable += available;
      if (available < 0) overspent += -available;
    }
    cumIncome += income[m] ?? 0;
    cumAssigned += assignedTotalByMonth[m] ?? 0;
    cumOverspent += overspentLast;
    const assignedInFuture = assignedAll - cumAssigned;
    // Past months show a snapshot; current and future months also account for
    // money already assigned to later months.
    const readyToAssign =
      cumIncome - cumAssigned - cumOverspent - (m >= now ? assignedInFuture : 0);

    result.set(m, {
      month: m,
      categories: cats,
      income: income[m] ?? 0,
      assigned: totalAssigned,
      activity: totalActivity,
      available: totalAvailable,
      overspentLastMonth: overspentLast,
      assignedInFuture,
      readyToAssign,
    });
    prev = cats;
    overspentLast = overspent;
  }
  return result;
}

export function categoryMonth(summary: MonthSummary | undefined, id: string): CategoryMonth {
  return summary?.categories[id] ?? EMPTY;
}

export interface TargetStatus {
  /** Total that should be assigned this month to stay on track. */
  needed: Cents;
  /** How much more to assign this month. */
  underfunded: Cents;
  /** 0..1 progress for this month. */
  progress: number;
  description: string;
}

export function targetStatus(target: Target, cm: CategoryMonth, month: MonthKey): TargetStatus {
  let needed = 0;
  let description = '';
  switch (target.type) {
    case 'monthly':
      needed = target.amount;
      description = 'Assign each month';
      break;
    case 'refill':
      needed = Math.max(0, target.amount - cm.carryIn);
      description = 'Refill up to each month';
      break;
    case 'byDate': {
      const due = target.month ?? month;
      const monthsLeft = Math.max(1, monthDiff(month, due) + 1);
      const remaining = Math.max(0, target.amount - cm.carryIn);
      needed = Math.ceil(remaining / monthsLeft);
      description = `Have by ${due}`;
      break;
    }
    case 'balance':
      needed = Math.max(0, target.amount - cm.carryIn - cm.activity);
      description = 'Have a balance of';
      break;
  }
  const underfunded = Math.max(0, needed - cm.assigned);
  const progress =
    target.type === 'balance'
      ? target.amount > 0
        ? Math.min(1, Math.max(0, cm.available) / target.amount)
        : 1
      : needed > 0
        ? Math.min(1, Math.max(0, cm.assigned) / needed)
        : 1;
  return { needed, underfunded, progress, description };
}

/** What "Assign underfunded" would add for a category: target shortfall or overspending. */
export function underfundedAmount(category: Category, cm: CategoryMonth, month: MonthKey): Cents {
  const fromTarget = category.target ? targetStatus(category.target, cm, month).underfunded : 0;
  const fromOverspend = cm.available < 0 ? -cm.available : 0;
  return Math.max(fromTarget, fromOverspend);
}

/** Account balances (cleared / uncleared / working). */
export function accountBalances(data: BudgetData) {
  const out: Record<string, { cleared: Cents; uncleared: Cents; working: Cents }> = {};
  for (const a of data.accounts) out[a.id] = { cleared: 0, uncleared: 0, working: 0 };
  for (const t of data.transactions) {
    const b = out[t.accountId];
    if (!b) continue;
    if (t.cleared === 'uncleared') b.uncleared += t.amount;
    else b.cleared += t.amount;
    b.working += t.amount;
  }
  return out;
}

/** Net worth at the end of each month. */
export function netWorthByMonth(data: BudgetData, from: MonthKey, to: MonthKey) {
  const byMonth: Record<MonthKey, Cents> = {};
  for (const t of data.transactions) {
    const m = monthOf(t.date);
    byMonth[m] = (byMonth[m] ?? 0) + t.amount;
  }
  let running = 0;
  for (const [m, v] of Object.entries(byMonth)) if (m < from) running += v;
  return monthRange(from, to).map((m) => {
    running += byMonth[m] ?? 0;
    return { month: m, value: running };
  });
}

