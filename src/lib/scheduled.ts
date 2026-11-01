import { addDays, addMonthsToDate } from './dates';
import { uid } from './id';
import { saveTransaction } from './ops';
import type { BudgetData, DateStr, Frequency, Scheduled } from './types';

export const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'semiannually', label: 'Every 6 months' },
  { value: 'yearly', label: 'Every year' },
];

export const frequencyLabel = (f: Frequency) => FREQUENCIES.find((x) => x.value === f)?.label ?? f;

/** Date of the nth occurrence (0 = start date). */
export function occurrence(start: DateStr, frequency: Frequency, n: number): DateStr {
  switch (frequency) {
    case 'once':
      return start;
    case 'weekly':
      return addDays(start, 7 * n);
    case 'biweekly':
      return addDays(start, 14 * n);
    case 'monthly':
      return addMonthsToDate(start, n);
    case 'quarterly':
      return addMonthsToDate(start, 3 * n);
    case 'semiannually':
      return addMonthsToDate(start, 6 * n);
    case 'yearly':
      return addMonthsToDate(start, 12 * n);
  }
}

/** Next date this schedule will be entered, or null if it has finished. */
export function nextDate(s: Scheduled): DateStr | null {
  if (s.frequency === 'once' && s.count > 0) return null;
  const d = occurrence(s.startDate, s.frequency, s.count);
  if (s.endDate && d > s.endDate) return null;
  return d;
}

/** Upcoming occurrences of all schedules between two dates (inclusive). */
export function upcoming(data: BudgetData, from: DateStr, to: DateStr) {
  const out: { scheduled: Scheduled; date: DateStr }[] = [];
  for (const s of data.scheduled) {
    for (let n = s.count; n < s.count + 400; n++) {
      if (s.frequency === 'once' && n > 0) break;
      const d = occurrence(s.startDate, s.frequency, n);
      if (d > to || (s.endDate && d > s.endDate)) break;
      if (d >= from) out.push({ scheduled: s, date: d });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type ScheduledDraft = Omit<Scheduled, 'id' | 'count'> & { id?: string };

export function saveScheduled(data: BudgetData, draft: ScheduledDraft): BudgetData {
  const existing = draft.id ? data.scheduled.find((s) => s.id === draft.id) : undefined;
  const s: Scheduled = {
    ...draft,
    id: draft.id ?? uid(),
    // Changing the start date or frequency restarts the count from the new start.
    count:
      existing && existing.startDate === draft.startDate && existing.frequency === draft.frequency ? existing.count : 0,
  };
  return {
    ...data,
    scheduled: existing ? data.scheduled.map((x) => (x.id === s.id ? s : x)) : [...data.scheduled, s],
  };
}

export function deleteScheduled(data: BudgetData, id: string): BudgetData {
  return { ...data, scheduled: data.scheduled.filter((s) => s.id !== id) };
}

/** Advance past the next occurrence; finished schedules are removed. */
function advance(data: BudgetData, id: string): BudgetData {
  const scheduled = data.scheduled
    .map((s) => (s.id === id ? { ...s, count: s.count + 1 } : s))
    .filter((s) => s.id !== id || nextDate(s) !== null);
  return { ...data, scheduled };
}

function enter(data: BudgetData, s: Scheduled, date: DateStr): BudgetData {
  return saveTransaction(data, {
    accountId: s.accountId,
    date,
    payee: s.payee,
    categoryId: s.categoryId,
    memo: s.memo,
    amount: s.amount,
    cleared: 'uncleared',
    transferAccountId: s.transferAccountId,
    splits: s.splits,
  });
}

export function skipNext(data: BudgetData, id: string): BudgetData {
  return advance(data, id);
}

/** Enter the next occurrence right away, dated `date` (usually today). */
export function enterNow(data: BudgetData, id: string, date: DateStr): BudgetData {
  const s = data.scheduled.find((x) => x.id === id);
  if (!s || !nextDate(s)) return data;
  return advance(enter(data, s, date), id);
}

/** Enter every occurrence that's due on or before `today`. */
export function processDue(data: BudgetData, today: DateStr): { data: BudgetData; entered: number } {
  let d = data;
  let entered = 0;
  for (const original of data.scheduled) {
    let s: Scheduled | undefined = original;
    let next = nextDate(s);
    // Cap catch-up so a schedule left for years can't freeze the app.
    for (let guard = 0; s && next && next <= today && guard < 1000; guard++) {
      if (!d.accounts.some((a) => a.id === s!.accountId)) break;
      d = advance(enter(d, s, next), s.id);
      entered++;
      s = d.scheduled.find((x) => x.id === original.id);
      next = s ? nextDate(s) : null;
    }
  }
  return { data: d, entered };
}
