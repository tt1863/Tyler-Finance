import { categoryParts } from './budget';
import { flagMatches } from './flags';
import type { BudgetData, Cents, DateStr, FlagColor, Transaction } from './types';

export interface TxFilter {
  text: string;
  categoryId: string | null;
  flag: FlagColor | 'any' | null;
  from: DateStr | '';
  to: DateStr | '';
  /** Amount range in cents, compared by size (ignoring inflow/outflow). */
  min: Cents | null;
  max: Cents | null;
  cleared: 'all' | 'cleared' | 'uncleared';
}

export const EMPTY_FILTER: TxFilter = { text: '', categoryId: null, flag: null, from: '', to: '', min: null, max: null, cleared: 'all' };

export const isFiltering = (f: TxFilter) =>
  f.text.trim() !== '' || f.categoryId !== null || f.flag !== null || f.from !== '' || f.to !== '' || f.min !== null || f.max !== null || f.cleared !== 'all';

/** Does a transaction match the filter? `label` gives its category label for text search. */
export function matches(data: BudgetData, t: Transaction, f: TxFilter, label: (t: Transaction) => string): boolean {
  if (f.categoryId && !categoryParts(t).some((p) => p.categoryId === f.categoryId)) return false;
  if (f.flag === 'any' ? !t.flag : f.flag && t.flag !== f.flag) return false;
  if (f.from && t.date < f.from) return false;
  if (f.to && t.date > f.to) return false;
  const size = Math.abs(t.amount);
  if (f.min !== null && size < f.min) return false;
  if (f.max !== null && size > f.max) return false;
  if (f.cleared === 'cleared' && t.cleared === 'uncleared') return false;
  if (f.cleared === 'uncleared' && t.cleared !== 'uncleared') return false;
  const q = f.text.trim().toLowerCase();
  if (q) {
    const hit =
      t.payee.toLowerCase().includes(q) ||
      t.memo.toLowerCase().includes(q) ||
      label(t).toLowerCase().includes(q) ||
      !!t.splits?.some((p) => p.memo.toLowerCase().includes(q)) ||
      flagMatches(data, t.flag, q) ||
      (t.amount / 100).toFixed(2).includes(q);
    if (!hit) return false;
  }
  return true;
}

/** Outflow, inflow and net of a list of transactions. */
export function totals(list: Transaction[]) {
  let outflow = 0;
  let inflow = 0;
  for (const t of list) {
    if (t.amount < 0) outflow += -t.amount;
    else inflow += t.amount;
  }
  return { outflow, inflow, net: inflow - outflow, count: list.length };
}
