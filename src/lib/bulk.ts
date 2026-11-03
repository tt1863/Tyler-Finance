import type { BudgetData, Cleared, Transaction } from './types';

/** Result of a bulk change: the new data and how many were changed or skipped. */
export interface BulkResult {
  data: BudgetData;
  changed: number;
  skipped: number;
}

function apply(data: BudgetData, ids: string[], change: (t: Transaction) => Transaction | null): BulkResult {
  const set = new Set(ids);
  let changed = 0;
  let skipped = 0;
  const transactions = data.transactions.map((t) => {
    if (!set.has(t.id)) return t;
    const next = change(t);
    if (next === null) {
      skipped++;
      return t;
    }
    if (next !== t) changed++;
    return next;
  });
  return { data: changed ? { ...data, transactions } : data, changed, skipped };
}

/**
 * Set one category on many transactions. Split transactions and transfers
 * between budget accounts (which have no category) are skipped.
 */
export function bulkSetCategory(data: BudgetData, ids: string[], categoryId: string | null): BulkResult {
  const onBudget = new Map(data.accounts.map((a) => [a.id, a.onBudget]));
  return apply(data, ids, (t) => {
    if (t.splits?.length) return null;
    if (t.transferAccountId && onBudget.get(t.transferAccountId) === onBudget.get(t.accountId)) return null;
    if (!onBudget.get(t.accountId)) return null;
    return t.categoryId === categoryId ? t : { ...t, categoryId };
  });
}

/** Mark many transactions cleared or uncleared (reconciled ones stay as they are). */
export function bulkSetCleared(data: BudgetData, ids: string[], cleared: Exclude<Cleared, 'reconciled'>): BulkResult {
  return apply(data, ids, (t) => (t.cleared === 'reconciled' ? null : t.cleared === cleared ? t : { ...t, cleared }));
}

/**
 * Move many transactions to another account. Transfers are skipped (move
 * them by editing one side), as are reconciled transactions.
 */
export function bulkMove(data: BudgetData, ids: string[], accountId: string): BulkResult {
  if (!data.accounts.some((a) => a.id === accountId)) return { data, changed: 0, skipped: ids.length };
  return apply(data, ids, (t) => {
    if (t.transferAccountId || t.cleared === 'reconciled') return null;
    return t.accountId === accountId ? t : { ...t, accountId };
  });
}

/** Total of the given transactions (inflows positive). */
export function totalOf(data: BudgetData, ids: Set<string>): number {
  let total = 0;
  for (const t of data.transactions) if (ids.has(t.id)) total += t.amount;
  return total;
}
