import type { BudgetData, DateStr } from './types';

export interface PayeeInfo {
  name: string;
  count: number;
  lastUsed: DateStr | null;
  /** Category filled in automatically for this payee, if any. */
  categoryId: string | null;
  scheduled: number;
}

/** Every payee used on transactions or schedules, or remembered with a category. Transfers are not payees. */
export function listPayees(data: BudgetData): PayeeInfo[] {
  const map = new Map<string, PayeeInfo>();
  const get = (name: string) => {
    let p = map.get(name);
    if (!p) map.set(name, (p = { name, count: 0, lastUsed: null, categoryId: data.payeeCategory[name] ?? null, scheduled: 0 }));
    return p;
  };
  for (const t of data.transactions) {
    if (t.transferAccountId || !t.payee.trim() || t.payee === 'Starting Balance') continue;
    const p = get(t.payee);
    p.count++;
    if (!p.lastUsed || t.date > p.lastUsed) p.lastUsed = t.date;
  }
  for (const s of data.scheduled) if (!s.transferAccountId && s.payee.trim()) get(s.payee).scheduled++;
  for (const name of Object.keys(data.payeeCategory)) get(name);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Rename a payee everywhere (transactions and schedules). Renaming to a payee
 * that already exists merges them; the existing payee's remembered category
 * wins, otherwise this one's carries over.
 */
export function renamePayee(data: BudgetData, from: string, to: string): BudgetData {
  const name = to.trim();
  if (!name || name === from) return data;
  // Match an existing payee regardless of capitals, so "amazon" merges into "Amazon".
  const existing = listPayees(data).find((p) => p.name !== from && p.name.toLowerCase() === name.toLowerCase());
  const target = existing?.name ?? name;
  const payeeCategory = { ...data.payeeCategory };
  const carried = payeeCategory[from];
  delete payeeCategory[from];
  if (!payeeCategory[target] && carried) payeeCategory[target] = carried;
  return {
    ...data,
    payeeCategory,
    transactions: data.transactions.map((t) => (t.payee === from && !t.transferAccountId ? { ...t, payee: target } : t)),
    scheduled: data.scheduled.map((s) => (s.payee === from && !s.transferAccountId ? { ...s, payee: target } : s)),
  };
}

/** Set or clear the category filled in automatically for a payee. */
export function setPayeeCategory(data: BudgetData, name: string, categoryId: string | null): BudgetData {
  const payeeCategory = { ...data.payeeCategory };
  if (categoryId) payeeCategory[name] = categoryId;
  else delete payeeCategory[name];
  return { ...data, payeeCategory };
}

/** Forget a payee that no transaction or schedule uses any more. */
export function forgetPayee(data: BudgetData, name: string): BudgetData {
  const info = listPayees(data).find((p) => p.name === name);
  if (info && (info.count || info.scheduled)) return data;
  return setPayeeCategory(data, name, null);
}
