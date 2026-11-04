import { accountBalances } from './budget';
import { addDays } from './dates';
import { upcoming } from './scheduled';
import type { BudgetData, Cents, DateStr, Scheduled } from './types';

/** One scheduled occurrence's effect on the forecast accounts. */
export interface ForecastItem {
  scheduled: Scheduled;
  date: DateStr;
  /** Change to the combined balance of the forecast accounts. */
  change: Cents;
}

export interface ForecastDay {
  date: DateStr;
  balance: Cents;
  items: ForecastItem[];
}

export interface Forecast {
  start: Cents;
  days: ForecastDay[];
  lowest: ForecastDay;
  /** First day the balance goes under the minimum, if it does. */
  short: { day: ForecastDay; cause: ForecastItem | null } | null;
}

/** Budget accounts that hold cash (not credit cards); the default forecast set. */
export const cashAccountIds = (data: BudgetData) =>
  data.accounts.filter((a) => a.onBudget && !a.closed && a.type !== 'credit').map((a) => a.id);

/** How a scheduled transaction changes the combined balance of `ids`. */
export function changeFor(s: Scheduled, ids: Set<string>): Cents {
  let c = 0;
  if (ids.has(s.accountId)) c += s.amount;
  if (s.transferAccountId && ids.has(s.transferAccountId)) c -= s.amount;
  return c;
}

/**
 * Projected daily balance of the given accounts for the next `length` days,
 * from today's working balance plus scheduled transactions. (Anything due
 * today has already been entered.)
 */
export function forecast(data: BudgetData, today: DateStr, length: number, accountIds: string[], minimum = 0): Forecast {
  const ids = new Set(accountIds);
  const balances = accountBalances(data);
  const start = accountIds.reduce((s, id) => s + (balances[id]?.working ?? 0), 0);
  const end = addDays(today, length);
  const byDate = new Map<DateStr, ForecastItem[]>();
  for (const o of upcoming(data, addDays(today, 1), end)) {
    const change = changeFor(o.scheduled, ids);
    if (change === 0) continue;
    const list = byDate.get(o.date) ?? [];
    list.push({ scheduled: o.scheduled, date: o.date, change });
    byDate.set(o.date, list);
  }

  const days: ForecastDay[] = [{ date: today, balance: start, items: [] }];
  let balance = start;
  let short: Forecast['short'] = start < minimum ? { day: days[0], cause: null } : null;
  for (let i = 1; i <= length; i++) {
    const date = addDays(today, i);
    // Money in before money out on the same day.
    const items = (byDate.get(date) ?? []).sort((a, b) => b.change - a.change);
    for (const it of items) {
      balance += it.change;
      if (!short && balance < minimum) short = { day: { date, balance: 0, items }, cause: it };
    }
    const day = { date, balance, items };
    if (short && short.day.date === date) short.day = day;
    days.push(day);
  }
  const lowest = days.reduce((lo, d) => (d.balance < lo.balance ? d : lo), days[0]);
  return { start, days, lowest, short };
}
