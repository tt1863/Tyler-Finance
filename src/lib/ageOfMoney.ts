import type { BudgetData, DateStr, Transaction } from './types';

/**
 * Age of Money: how many days cash sat between arriving and being spent.
 *
 * Money that arrives in budget cash accounts (income, refunds) goes into a
 * queue. Each cash outflow (spending, card payments, moving money to a
 * tracking account) takes money from the front of the queue, first in, first
 * out. The outflow's age is the amount-weighted number of days that money
 * waited. Age of Money is the average age of the last 10 outflows.
 *
 * Transfers between budget cash accounts and starting balances are left out.
 * Outflows with no recorded income left to cover them aren't counted.
 */

export const OUTFLOWS_NEEDED = 10;

export interface AgedOutflow {
  date: DateStr;
  days: number;
}

const dayNumber = (d: DateStr) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd) / 86400000;
};

export function agedOutflows(data: BudgetData): AgedOutflow[] {
  const cash = new Set(data.accounts.filter((a) => a.onBudget && a.type !== 'credit').map((a) => a.id));
  const internal = (t: Transaction) => !!t.transferAccountId && cash.has(t.transferAccountId);
  const txs = data.transactions
    .filter((t) => cash.has(t.accountId) && t.amount !== 0 && !internal(t) && t.payee !== 'Starting Balance')
    // Money that arrives on a day is available to spend that day.
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : b.amount - a.amount));

  const queue: { day: number; left: number }[] = [];
  let head = 0;
  const out: AgedOutflow[] = [];
  for (const t of txs) {
    const day = dayNumber(t.date);
    if (t.amount > 0) {
      queue.push({ day, left: t.amount });
      continue;
    }
    let need = -t.amount;
    let covered = 0;
    let weighted = 0;
    while (need > 0 && head < queue.length) {
      const b = queue[head];
      const take = Math.min(need, b.left);
      weighted += take * (day - b.day);
      covered += take;
      b.left -= take;
      need -= take;
      if (b.left === 0) head++;
    }
    if (covered > 0) out.push({ date: t.date, days: weighted / covered });
  }
  return out;
}

/** Age of Money in days as of `date` (default: all data), or null until there are 10 outflows. */
export function ageOfMoney(outflows: AgedOutflow[], date?: DateStr): number | null {
  const upTo = date ? outflows.filter((o) => o.date <= date) : outflows;
  if (upTo.length < OUTFLOWS_NEEDED) return null;
  const last = upTo.slice(-OUTFLOWS_NEEDED);
  return Math.round(last.reduce((s, o) => s + o.days, 0) / last.length);
}
