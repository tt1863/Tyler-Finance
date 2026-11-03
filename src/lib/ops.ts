import { categoryMonth, computeBudget, underfundedAmount } from './budget';
import { today } from './dates';
import { uid } from './id';
import type {
  Split,
  Account,
  AccountType,
  BudgetData,
  Category,
  Cents,
  Cleared,
  MonthKey,
  Transaction,
} from './types';
import { READY_TO_ASSIGN } from './types';

export const CC_GROUP_NAME = 'Credit Card Payments';

export function emptyData(): BudgetData {
  return {
    version: 1,
    accounts: [],
    groups: [],
    categories: [],
    transactions: [],
    scheduled: [],
    assigned: {},
    payeeCategory: {},
    currency: 'USD',
  };
}

/** Fill in fields added after a budget was first saved. */
export function normalize(data: BudgetData): BudgetData {
  return { ...emptyData(), ...data, scheduled: data.scheduled ?? [] };
}

/** A starter set of categories similar to YNAB's defaults. */
export function starterData(): BudgetData {
  const data = emptyData();
  const groups: Record<string, string[]> = {
    Bills: ['Rent/Mortgage', 'Electric', 'Water', 'Internet', 'Phone', 'Insurance'],
    Needs: ['Groceries', 'Transportation', 'Medical'],
    Wants: ['Dining Out', 'Entertainment', 'Shopping', 'Vacation'],
    Savings: ['Emergency Fund', 'Car Replacement'],
  };
  for (const [name, cats] of Object.entries(groups)) {
    const g = { id: uid(), name, hidden: false };
    data.groups.push(g);
    for (const c of cats) data.categories.push({ id: uid(), groupId: g.id, name: c, hidden: false });
  }
  return data;
}

export const isCashType = (t: AccountType) => t === 'checking' || t === 'savings' || t === 'cash';
export const isDebtType = (t: AccountType) => t === 'credit' || t === 'loan' || t === 'liability';

function ensureCcGroup(data: BudgetData): string {
  let g = data.groups.find((x) => x.system);
  if (!g) {
    g = { id: uid(), name: CC_GROUP_NAME, hidden: false, system: true };
    data.groups.unshift(g);
  }
  return g.id;
}

export function addAccount(
  data: BudgetData,
  input: { name: string; type: AccountType; onBudget: boolean; balance: Cents; date?: string },
): BudgetData {
  const d = structuredClone(data);
  const account: Account = {
    id: uid(),
    name: input.name.trim(),
    type: input.type,
    onBudget: input.onBudget,
    closed: false,
  };
  d.accounts.push(account);
  if (account.type === 'credit' && account.onBudget) {
    d.categories.push({
      id: uid(),
      groupId: ensureCcGroup(d),
      name: account.name,
      hidden: false,
      ccAccountId: account.id,
    });
  }
  // Cash in a budget account becomes money to assign. Credit card debt and
  // tracking balances don't touch the budget.
  const toBudget = account.onBudget && account.type !== 'credit';
  d.transactions.push({
    id: uid(),
    accountId: account.id,
    date: input.date ?? today(),
    payee: 'Starting Balance',
    categoryId: toBudget ? READY_TO_ASSIGN : null,
    memo: '',
    amount: input.balance,
    cleared: 'cleared',
  });
  return d;
}

export function updateAccount(data: BudgetData, id: string, patch: Partial<Account>): BudgetData {
  const d = structuredClone(data);
  const a = d.accounts.find((x) => x.id === id);
  if (!a) return data;
  Object.assign(a, patch);
  const payCat = d.categories.find((c) => c.ccAccountId === id);
  if (payCat && patch.name) payCat.name = patch.name;
  if (payCat && patch.closed !== undefined) payCat.hidden = patch.closed;
  return d;
}

export function deleteAccount(data: BudgetData, id: string): BudgetData {
  let d = structuredClone(data);
  const removed = new Set(
    d.transactions.filter((t) => t.accountId === id || t.transferAccountId === id).map((t) => t.id),
  );
  d.transactions = d.transactions.filter((t) => !removed.has(t.id));
  d.accounts = d.accounts.filter((a) => a.id !== id);
  d.scheduled = d.scheduled.filter((s) => s.accountId !== id && s.transferAccountId !== id);
  const payCat = d.categories.find((c) => c.ccAccountId === id);
  if (payCat) d = removeCategoryRefs(d, payCat.id, null);
  return d;
}

export interface TransactionDraft {
  id?: string;
  accountId: string;
  date: string;
  payee: string;
  categoryId: string | null;
  memo: string;
  amount: Cents;
  cleared: Cleared;
  /** When set, this is a transfer to/from that account. */
  transferAccountId?: string;
  /** Split across categories. Ignored for transfers. */
  splits?: Split[];
}

/**
 * Create or replace a transaction. Transfers are stored as two linked
 * transactions, one in each account.
 */
export function saveTransaction(data: BudgetData, draft: TransactionDraft): BudgetData {
  let d = structuredClone(data);
  const existing = draft.id ? d.transactions.find((t) => t.id === draft.id) : undefined;
  // Editing one side of a transfer rebuilds the other side; keep its own
  // details (cleared state, bank link) rather than resetting them.
  const oldPair = existing?.transferTxId ? d.transactions.find((t) => t.id === existing.transferTxId) : undefined;
  if (existing) d = removeTx(d, existing.id);

  const accounts = new Map(d.accounts.map((a) => [a.id, a]));
  const id = draft.id ?? uid();
  const tx: Transaction = {
    id,
    accountId: draft.accountId,
    date: draft.date,
    payee: draft.payee.trim(),
    categoryId: draft.categoryId,
    memo: draft.memo.trim(),
    amount: draft.amount,
    cleared: draft.cleared,
  };

  if (draft.transferAccountId && draft.transferAccountId !== draft.accountId) {
    const from = accounts.get(draft.accountId);
    const to = accounts.get(draft.transferAccountId);
    const pairId = existing?.transferTxId ?? uid();
    // Transfers between two budget accounts don't need a category. Transfers
    // between budget and tracking accounts are spending/income on the budget side.
    const bothOnBudget = from?.onBudget === to?.onBudget;
    tx.transferAccountId = draft.transferAccountId;
    tx.transferTxId = pairId;
    tx.payee = `Transfer : ${to?.name ?? ''}`;
    if (bothOnBudget || !from?.onBudget) tx.categoryId = null;
    const { splits: _oldSplits, ...keep } = oldPair ?? ({} as Partial<Transaction>);
    const pair: Transaction = {
      ...keep,
      id: pairId,
      accountId: draft.transferAccountId,
      date: draft.date,
      payee: `Transfer : ${from?.name ?? ''}`,
      categoryId: !bothOnBudget && to?.onBudget ? draft.categoryId : null,
      memo: tx.memo,
      amount: -draft.amount,
      cleared: oldPair?.cleared ?? 'uncleared',
      transferAccountId: draft.accountId,
      transferTxId: id,
    };
    d.transactions.push(tx, pair);
  } else {
    if (draft.splits && draft.splits.length > 1) {
      tx.splits = draft.splits.map((s) => ({ ...s, memo: s.memo.trim() }));
      tx.categoryId = null;
    }
    d.transactions.push(tx);
    if (tx.payee && tx.categoryId && tx.categoryId !== READY_TO_ASSIGN) {
      d.payeeCategory[tx.payee] = tx.categoryId;
    }
  }
  return d;
}

function removeTx(d: BudgetData, id: string): BudgetData {
  const t = d.transactions.find((x) => x.id === id);
  const ids = new Set([id]);
  if (t?.transferTxId) ids.add(t.transferTxId);
  d.transactions = d.transactions.filter((x) => !ids.has(x.id));
  return d;
}

export function deleteTransactions(data: BudgetData, ids: string[]): BudgetData {
  let d = structuredClone(data);
  for (const id of ids) d = removeTx(d, id);
  return d;
}

export function setCleared(data: BudgetData, id: string, cleared: Cleared): BudgetData {
  return {
    ...data,
    transactions: data.transactions.map((t) => (t.id === id ? { ...t, cleared } : t)),
  };
}

export function setAssigned(
  data: BudgetData,
  month: MonthKey,
  categoryId: string,
  amount: Cents,
): BudgetData {
  const row = { ...(data.assigned[month] ?? {}) };
  if (amount === 0) delete row[categoryId];
  else row[categoryId] = amount;
  return { ...data, assigned: { ...data.assigned, [month]: row } };
}

/** Move money between categories (or Ready to Assign) by adjusting assigned amounts. */
export function moveMoney(
  data: BudgetData,
  month: MonthKey,
  fromId: string,
  toId: string,
  amount: Cents,
): BudgetData {
  let d = data;
  const get = (id: string) => d.assigned[month]?.[id] ?? 0;
  if (fromId !== READY_TO_ASSIGN) d = setAssigned(d, month, fromId, get(fromId) - amount);
  if (toId !== READY_TO_ASSIGN) d = setAssigned(d, month, toId, get(toId) + amount);
  return d;
}

/** Assign enough to every category to meet its target and cover overspending. */
export function assignUnderfunded(data: BudgetData, month: MonthKey, onlyIds?: string[]): BudgetData {
  const summary = computeBudget(data, month).get(month);
  let d = data;
  for (const c of data.categories) {
    if (c.hidden || (onlyIds && !onlyIds.includes(c.id))) continue;
    const cm = categoryMonth(summary, c.id);
    const add = underfundedAmount(c, cm, month, data);
    if (add > 0) d = setAssigned(d, month, c.id, cm.assigned + add);
  }
  return d;
}

/** Copy last month's assigned amounts into this month (only for empty categories). */
export function assignLastMonth(data: BudgetData, month: MonthKey, prevMonth: MonthKey): BudgetData {
  let d = data;
  for (const [id, amt] of Object.entries(data.assigned[prevMonth] ?? {})) {
    if (!data.assigned[month]?.[id]) d = setAssigned(d, month, id, amt);
  }
  return d;
}

export function addGroup(data: BudgetData, name: string): BudgetData {
  return { ...data, groups: [...data.groups, { id: uid(), name: name.trim(), hidden: false }] };
}

export function updateGroup(
  data: BudgetData,
  id: string,
  patch: { name?: string; hidden?: boolean },
): BudgetData {
  return { ...data, groups: data.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) };
}

export function deleteGroup(data: BudgetData, id: string, reassignTo: string | null): BudgetData {
  let d = structuredClone(data);
  for (const c of d.categories.filter((x) => x.groupId === id)) d = removeCategoryRefs(d, c.id, reassignTo);
  d.groups = d.groups.filter((g) => g.id !== id);
  return d;
}

export function addCategory(data: BudgetData, groupId: string, name: string): BudgetData {
  const c: Category = { id: uid(), groupId, name: name.trim(), hidden: false };
  return { ...data, categories: [...data.categories, c] };
}

export function updateCategory(data: BudgetData, id: string, patch: Partial<Category>): BudgetData {
  return {
    ...data,
    categories: data.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
}

/**
 * Snooze a category's target for one month (or wake it with null). Like YNAB,
 * not available for credit card payment categories.
 */
export function snoozeTarget(data: BudgetData, categoryId: string, month: MonthKey | null): BudgetData {
  const c = data.categories.find((x) => x.id === categoryId);
  if (!c?.target || c.ccAccountId) return data;
  const { snoozed: _old, ...rest } = c.target;
  return updateCategory(data, categoryId, { target: month ? { ...rest, snoozed: month } : rest });
}

/** Delete a category, moving its transactions and assigned money to another category. */
export function deleteCategory(data: BudgetData, id: string, reassignTo: string | null): BudgetData {
  return removeCategoryRefs(structuredClone(data), id, reassignTo);
}

function removeCategoryRefs(d: BudgetData, id: string, reassignTo: string | null): BudgetData {
  for (const t of [...d.transactions, ...d.scheduled]) {
    if (t.categoryId === id) t.categoryId = reassignTo;
    for (const s of t.splits ?? []) if (s.categoryId === id) s.categoryId = reassignTo;
  }
  for (const row of Object.values(d.assigned)) {
    if (row[id] !== undefined) {
      if (reassignTo && reassignTo !== READY_TO_ASSIGN) row[reassignTo] = (row[reassignTo] ?? 0) + row[id];
      delete row[id];
    }
  }
  for (const [p, c] of Object.entries(d.payeeCategory)) if (c === id) delete d.payeeCategory[p];
  d.categories = d.categories.filter((c) => c.id !== id);
  return d;
}

/** Move a category or group up/down in display order. */
export function reorder<T extends { id: string }>(list: T[], id: string, dir: -1 | 1, sameAs?: (a: T, b: T) => boolean): T[] {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return list;
  let j = i + dir;
  while (j >= 0 && j < list.length && sameAs && !sameAs(list[i], list[j])) j += dir;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/**
 * Reconcile an account against the bank balance. Marks cleared transactions as
 * reconciled and adds an adjustment if the balances differ.
 */
export function reconcile(data: BudgetData, accountId: string, bankBalance: Cents): BudgetData {
  const d = structuredClone(data);
  const account = d.accounts.find((a) => a.id === accountId);
  if (!account) return data;
  let cleared = 0;
  for (const t of d.transactions) {
    if (t.accountId === accountId && t.cleared !== 'uncleared') cleared += t.amount;
  }
  const diff = bankBalance - cleared;
  if (diff !== 0) {
    d.transactions.push({
      id: uid(),
      accountId,
      date: today(),
      payee: 'Reconciliation Balance Adjustment',
      categoryId: account.onBudget ? READY_TO_ASSIGN : null,
      memo: 'Entered automatically when reconciling',
      amount: diff,
      cleared: 'cleared',
    });
  }
  for (const t of d.transactions) {
    if (t.accountId === accountId && t.cleared === 'cleared') t.cleared = 'reconciled';
  }
  return d;
}

export interface ImportRow {
  date: string;
  payee: string;
  memo: string;
  amount: Cents;
}

/** Import bank transactions, skipping likely duplicates and auto-filling categories by payee. */
export function importTransactions(
  data: BudgetData,
  accountId: string,
  rows: ImportRow[],
): { data: BudgetData; added: number; skipped: number } {
  const d = structuredClone(data);
  const key = (date: string, amount: number, payee: string) =>
    `${date}|${amount}|${payee.toLowerCase()}`;
  const seen = new Map<string, number>();
  for (const t of d.transactions) {
    if (t.accountId !== accountId) continue;
    const k = key(t.date, t.amount, t.payee);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let added = 0;
  let skipped = 0;
  for (const r of rows) {
    const k = key(r.date, r.amount, r.payee);
    const count = seen.get(k) ?? 0;
    if (count > 0) {
      seen.set(k, count - 1);
      skipped++;
      continue;
    }
    d.transactions.push({
      id: uid(),
      accountId,
      date: r.date,
      payee: r.payee,
      categoryId: d.payeeCategory[r.payee] ?? null,
      memo: r.memo,
      amount: r.amount,
      cleared: 'cleared',
    });
    added++;
  }
  return { data: d, added, skipped };
}

/** Transactions in budget accounts that still need a category. */
export function needsCategory(data: BudgetData): Transaction[] {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  return data.transactions.filter((t) => {
    const a = accounts.get(t.accountId);
    if (!a?.onBudget) return false;
    if (t.splits?.length) return t.splits.some((s) => s.categoryId === null);
    if (t.categoryId !== null) return false;
    if (t.transferAccountId) return accounts.get(t.transferAccountId)?.onBudget === false;
    // Starting debt on a credit card is intentionally uncategorized.
    if (a.type === 'credit' && t.payee === 'Starting Balance') return false;
    return true;
  });
}
