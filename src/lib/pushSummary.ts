import type { PushSummary } from '../../supabase/functions/_shared/digest';
import { computeBudget } from './budget';
import { addDays, monthOf } from './dates';
import { needsCategory } from './ops';
import { spendingLines } from './reports';
import { upcoming } from './scheduled';
import type { BudgetData, DateStr } from './types';

/**
 * The small summary uploaded for push notifications: what the server needs
 * to know to send a daily heads-up, worked out here with the budget math.
 */
export function buildSummary(data: BudgetData, today: DateStr): PushSummary {
  const month = monthOf(today);
  const s = computeBudget(data, month).get(month)!;
  const names = new Map(data.categories.map((c) => [c.id, c.name]));
  const accounts = new Map(data.accounts.map((a) => [a.id, a.name]));
  const weekAgo = addDays(today, -7);
  return {
    currency: data.currency,
    bills: upcoming(data, today, addDays(today, 14)).map(({ scheduled: x, date }) => ({
      date,
      payee: x.payee || (x.transferAccountId ? `Transfer to ${accounts.get(x.transferAccountId) ?? ''}` : ''),
      amount: x.amount,
    })),
    overspent: Object.entries(s.categories)
      .filter(([id, c]) => c.available < 0 && names.has(id))
      .map(([id, c]) => ({ key: `${month}:${id}`, name: names.get(id)!, amount: c.available })),
    needsCategory: needsCategory(data).length,
    readyToAssign: s.readyToAssign,
    weekSpent: Math.max(
      0,
      spendingLines(data)
        .filter((l) => l.date > weekAgo && l.date <= today)
        .reduce((t, l) => t + l.spent, 0),
    ),
  };
}
