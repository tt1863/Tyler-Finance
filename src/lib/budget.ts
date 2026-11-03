import { currentMonth, monthDiff, monthOf, monthRange } from './dates';
import type { BudgetData, Category, Cents, MonthKey, Target, Transaction } from './types';
import { READY_TO_ASSIGN } from './types';

export interface CategoryMonth {
  /** Positive balance rolled over from last month. */
  carryIn: Cents;
  assigned: Cents;
  activity: Cents;
  available: Cents;
  /**
   * Part of a negative Available that came from credit card spending the
   * category couldn't cover (YNAB's yellow "credit overspending"). It became
   * card debt, so it doesn't come out of next month's Ready to Assign.
   */
  creditOverspent: Cents;
}

export interface MonthSummary {
  month: MonthKey;
  categories: Record<string, CategoryMonth>;
  /** Income (Ready to Assign inflows) dated this month. */
  income: Cents;
  assigned: Cents;
  activity: Cents;
  available: Cents;
  /** Cash overspending from last month, taken out of Ready to Assign this month. */
  overspentLastMonth: Cents;
  /** Amount assigned in months after this one. */
  assignedInFuture: Cents;
  readyToAssign: Cents;
}

/** The category/amount pairs a transaction contributes: its splits, or itself. */
export function categoryParts(t: Transaction): { categoryId: string | null; amount: Cents }[] {
  return t.splits?.length ? t.splits : [{ categoryId: t.categoryId, amount: t.amount }];
}

const EMPTY: CategoryMonth = { carryIn: 0, assigned: 0, activity: 0, available: 0, creditOverspent: 0 };

/** One category's share of a transaction, in date order within its month. */
interface CategoryEntry {
  order: string;
  amount: Cents;
  /** Set for spending on a credit card: that card's payment category. */
  payCat?: string;
}

/**
 * Category activity per month, plus what's needed for credit cards.
 *
 * Credit cards work like YNAB: spending on a card moves the part the category
 * can cover into the card's payment category (worked out month by month in
 * computeBudget, since it depends on what's available). Refunds, income and
 * payments on the card move money in or out of the payment category directly.
 */
export function computeActivity(data: BudgetData) {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const paymentCategory = new Map<string, string>();
  for (const c of data.categories) if (c.ccAccountId) paymentCategory.set(c.ccAccountId, c.id);

  const activity: Record<MonthKey, Record<string, Cents>> = {};
  const income: Record<MonthKey, Cents> = {};
  const entries: Record<MonthKey, Record<string, CategoryEntry[]>> = {};
  const add = (m: MonthKey, cat: string, amt: Cents) => {
    const row = (activity[m] ??= {});
    row[cat] = (row[cat] ?? 0) + amt;
  };

  for (const t of data.transactions) {
    const account = accounts.get(t.accountId);
    if (!account?.onBudget) continue;
    const m = monthOf(t.date);
    const payCat = account.type === 'credit' ? paymentCategory.get(account.id) : undefined;
    const order = `${t.date}|${t.id}`;
    for (const part of categoryParts(t)) {
      if (part.categoryId === READY_TO_ASSIGN) income[m] = (income[m] ?? 0) + part.amount;
      else if (part.categoryId) {
        add(m, part.categoryId, part.amount);
        const spendOnCard = payCat && part.amount < 0 && part.categoryId !== payCat;
        ((entries[m] ??= {})[part.categoryId] ??= []).push({ order, amount: part.amount, payCat: spendOnCard ? payCat : undefined });
      }
    }

    if (payCat) {
      const otherOnBudget = t.transferAccountId ? accounts.get(t.transferAccountId)?.onBudget === true : false;
      // Card spending is handled in computeBudget. Everything else that touches
      // the budget (refunds, income, payments, transfers) moves money in or out
      // of the payment category in full. Uncategorized entries like starting
      // debt don't move money.
      for (const part of categoryParts(t)) {
        const spending = part.amount < 0 && part.categoryId !== null && part.categoryId !== payCat;
        if (spending) continue;
        if (part.categoryId !== null || otherOnBudget) add(m, payCat, -part.amount);
      }
    }
  }
  for (const row of Object.values(entries)) for (const list of Object.values(row)) list.sort((a, b) => (a.order < b.order ? -1 : 1));
  return { activity, income, entries, paymentCategoryIds: new Set(paymentCategory.values()) };
}

/** Compute every month from the first month with data through `through` (at least). */
export function computeBudget(data: BudgetData, through: MonthKey): Map<MonthKey, MonthSummary> {
  const { activity, income, entries, paymentCategoryIds } = computeActivity(data);
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
  // Payment categories last: card spending in other categories feeds them.
  const ordered = [...catIds].sort((a, b) => Number(paymentCategoryIds.has(a)) - Number(paymentCategoryIds.has(b)));

  const result = new Map<MonthKey, MonthSummary>();
  let prev: Record<string, CategoryMonth> = {};
  let cumIncome = 0;
  let cumAssigned = 0;
  let cumOverspent = 0;
  let overspentLast = 0;

  for (const m of monthRange(first, last)) {
    const cats: Record<string, CategoryMonth> = {};
    const moved: Record<string, Cents> = {};
    let totalAssigned = 0;
    let totalActivity = 0;
    let totalAvailable = 0;
    let overspent = 0;
    for (const id of ordered) {
      const carryIn = Math.max(0, prev[id]?.available ?? 0);
      const assigned = data.assigned[m]?.[id] ?? 0;
      let act = activity[m]?.[id] ?? 0;
      if (paymentCategoryIds.has(id)) act += moved[id] ?? 0;

      // Walk the month's transactions in date order: each card purchase moves
      // as much as the category has available to the card's payment category;
      // the rest is credit overspending (new card debt).
      let running = carryIn + assigned;
      let unfundedCard = 0;
      for (const e of entries[m]?.[id] ?? []) {
        if (e.payCat) {
          const funded = Math.min(-e.amount, Math.max(0, running));
          moved[e.payCat] = (moved[e.payCat] ?? 0) + funded;
          unfundedCard += -e.amount - funded;
        }
        running += e.amount;
      }

      const available = carryIn + assigned + act;
      const creditOverspent = available < 0 ? Math.min(unfundedCard, -available) : 0;
      cats[id] = { carryIn, assigned, activity: act, available, creditOverspent };
      totalAssigned += assigned;
      totalActivity += act;
      totalAvailable += available;
      // Only cash overspending comes out of next month's Ready to Assign.
      if (available < 0) overspent += -available - creditOverspent;
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

/** Sum of a category's assigned amounts from `from` up to (not including) `to`. */
export function assignedBetween(data: BudgetData, categoryId: string, from: MonthKey, to: MonthKey): Cents {
  let sum = 0;
  for (const [m, row] of Object.entries(data.assigned)) if (m >= from && m < to) sum += row[categoryId] ?? 0;
  return sum;
}

/** How many times a weekday (0 = Sunday) falls in a month. */
export function weekdaysInMonth(month: MonthKey, weekday: number): number {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  let count = 0;
  for (let d = 0; d < days; d++) if ((first + d) % 7 === weekday) count++;
  return count;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (mmdd: string) => `${MONTHS[Number(mmdd.slice(0, 2)) - 1]} ${Number(mmdd.slice(3, 5))}`;

/** The next yearly due month on or after `month` for a "MM-DD" date. */
function nextYearlyDue(month: MonthKey, mmdd: string): MonthKey {
  const year = Number(month.slice(0, 4));
  const thisYear = `${year}-${mmdd.slice(0, 2)}`;
  return thisYear >= month ? thisYear : `${year + 1}-${mmdd.slice(0, 2)}`;
}

/**
 * What a target asks for this month. `priorAssigned(from)` gives what was
 * assigned to the category from a month up to this one; "set aside" targets
 * that span several months use it so last month's assigning counts. Without
 * it they fall back to the money left over.
 */
export function targetStatus(
  target: Target,
  cm: CategoryMonth,
  month: MonthKey,
  priorAssigned?: (from: MonthKey) => Cents,
): TargetStatus {
  const behavior = target.behavior ?? 'setAside';
  // Spread what's still needed over the months left until a due month.
  const spread = (dueMonth: MonthKey, cycleStart: MonthKey) => {
    const monthsLeft = Math.max(1, monthDiff(month, dueMonth) + 1);
    const have = behavior === 'refill' || !priorAssigned ? cm.carryIn : priorAssigned(cycleStart);
    return Math.ceil(Math.max(0, target.amount - have) / monthsLeft);
  };
  let needed = 0;
  let description = '';
  switch (target.type) {
    case 'weekly': {
      const weeks = weekdaysInMonth(month, target.weekday ?? 1);
      const total = target.amount * weeks;
      needed = behavior === 'refill' ? Math.max(0, total - cm.carryIn) : total;
      description = `${behavior === 'refill' ? 'Refill up to' : 'Set aside'} each week (${weeks} ${WEEKDAYS[target.weekday ?? 1]}s this month)`;
      break;
    }
    case 'monthly':
      needed = behavior === 'refill' ? Math.max(0, target.amount - cm.carryIn) : target.amount;
      description = behavior === 'refill' ? 'Refill up to each month' : 'Set aside each month';
      break;
    case 'refill':
      needed = Math.max(0, target.amount - cm.carryIn);
      description = 'Refill up to each month';
      break;
    case 'yearly': {
      const mmdd = target.due ?? '12-31';
      const dueMonth = nextYearlyDue(month, mmdd);
      needed = spread(dueMonth, addMonthsKey(dueMonth, -11));
      description = `${behavior === 'refill' ? 'Refill up to' : 'Set aside'} by ${shortDate(mmdd)} each year`;
      break;
    }
    case 'custom': {
      const due = target.due ?? `${month}-01`;
      const repeat = target.repeat ?? 'none';
      if (repeat === 'monthly') {
        needed = behavior === 'refill' ? Math.max(0, target.amount - cm.carryIn) : target.amount;
      } else if (repeat === 'yearly') {
        const dueMonth = nextYearlyDue(month < due.slice(0, 7) ? due.slice(0, 7) : month, due.slice(5));
        needed = spread(dueMonth, addMonthsKey(dueMonth, -11));
      } else {
        const dueMonth = due.slice(0, 7);
        needed = month > dueMonth ? 0 : spread(dueMonth, target.start ?? month);
      }
      const when = repeat === 'none' ? `by ${shortDate(due.slice(5))}, ${due.slice(0, 4)}` : `by ${shortDate(due.slice(5))}, repeating ${repeat}`;
      description = `${behavior === 'refill' ? 'Fill up to' : 'Set aside'} ${when}`;
      break;
    }
    case 'byDate': {
      const due = target.month ?? month;
      const monthsLeft = Math.max(1, monthDiff(month, due) + 1);
      const remaining = Math.max(0, target.amount - cm.carryIn);
      needed = Math.ceil(remaining / monthsLeft);
      description = `Have a balance by ${due}`;
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

function addMonthsKey(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Target status with the category's assigning history filled in. */
export function categoryTargetStatus(data: BudgetData, category: Category, cm: CategoryMonth, month: MonthKey): TargetStatus | null {
  if (!category.target) return null;
  return targetStatus(category.target, cm, month, (from) => assignedBetween(data, category.id, from, month));
}

/** What "Assign underfunded" would add for a category: target shortfall or overspending. */
export function underfundedAmount(category: Category, cm: CategoryMonth, month: MonthKey, data?: BudgetData): Cents {
  const ts = data ? categoryTargetStatus(data, category, cm, month) : category.target ? targetStatus(category.target, cm, month) : null;
  const fromTarget = ts ? ts.underfunded : 0;
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

