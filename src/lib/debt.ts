import type { Cents } from './types';

export interface DebtInput {
  id: string;
  name: string;
  /** Amount owed (positive cents). */
  balance: Cents;
  /** Interest rate per year, in percent (e.g. 24.99). */
  apr: number;
  /** Minimum monthly payment (cents). */
  minPayment: Cents;
}

export type Strategy = 'avalanche' | 'snowball';

export interface DebtResult {
  id: string;
  /** Months until paid off (1 = next month), or null if it never pays off. */
  months: number | null;
  interest: Cents;
}

export interface PayoffPlan {
  /** Months until every debt is paid, or null if some never pay off. */
  months: number | null;
  totalInterest: Cents;
  debts: DebtResult[];
  /** Total owed at the end of each month (index 0 = today). */
  balances: Cents[];
}

const MAX_MONTHS = 600;

/**
 * Simulate paying off debts month by month. Each month interest is added,
 * every debt gets its minimum, and the extra amount (plus minimums freed up by
 * debts already paid off) goes to the focus debt: highest interest first
 * (avalanche) or smallest balance first (snowball).
 */
export function planPayoff(debts: DebtInput[], extra: Cents, strategy: Strategy): PayoffPlan {
  const state = debts.map((d) => ({ ...d, left: d.balance, interest: 0, paidOffAt: d.balance <= 0 ? 0 : (null as number | null) }));
  const budget = debts.reduce((s, d) => s + d.minPayment, 0) + Math.max(0, extra);
  const balances: Cents[] = [state.reduce((s, d) => s + Math.max(0, d.left), 0)];

  for (let month = 1; month <= MAX_MONTHS && state.some((d) => d.left > 0); month++) {
    for (const d of state) {
      if (d.left <= 0) continue;
      const interest = Math.round((d.left * d.apr) / 100 / 12);
      d.left += interest;
      d.interest += interest;
    }
    let pool = budget;
    // Minimums first.
    for (const d of state) {
      if (d.left <= 0) continue;
      const pay = Math.min(d.minPayment, d.left, pool);
      d.left -= pay;
      pool -= pay;
    }
    // Everything left over goes to the focus debt, then the next one.
    const order = state
      .filter((d) => d.left > 0)
      .sort((a, b) => (strategy === 'avalanche' ? b.apr - a.apr || a.left - b.left : a.left - b.left || b.apr - a.apr));
    for (const d of order) {
      if (pool <= 0) break;
      const pay = Math.min(d.left, pool);
      d.left -= pay;
      pool -= pay;
    }
    for (const d of state) if (d.left <= 0 && d.paidOffAt === null) d.paidOffAt = month;
    balances.push(state.reduce((s, d) => s + Math.max(0, d.left), 0));
    // Stop early if balances are growing: payments don't cover the interest.
    if (month >= 24 && balances[month] >= balances[month - 12]) break;
  }

  const done = state.every((d) => d.paidOffAt !== null);
  return {
    months: done ? Math.max(0, ...state.map((d) => d.paidOffAt!)) : null,
    totalInterest: state.reduce((s, d) => s + d.interest, 0),
    debts: state.map((d) => ({ id: d.id, months: d.paidOffAt, interest: d.interest })),
    balances,
  };
}

/** Monthly interest on a debt today (cents). */
export const monthlyInterest = (d: DebtInput) => Math.round((d.balance * d.apr) / 100 / 12);
